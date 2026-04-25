import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { getTableColumns } from "../db/schemaGuards.js";
import type { JwtPayload, Role } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { parseManagerPermissions, parsePermissionsObject } from "../lib/manager-permissions.js";
import type { RowDataPacket } from "mysql2";
import { loginRateLimiter } from "../middleware/rate-limit.js";
import { tryLoginViaRmManagers } from "../services/rm-legacy-staff.service.js";

const router = Router();

const loginBody = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

router.post("/login", loginRateLimiter, async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const { email, password } = parsed.data;
  const staffCols = await getTableColumns(pool, "staff_users");
  const selectCols = ["id", "tenant_id", "email", "password_hash", "role", "active"];
  if (staffCols.has("name")) selectCols.push("name");
  if (staffCols.has("permissions_json")) selectCols.push("permissions_json");
  if (staffCols.has("wallet_balance")) selectCols.push("wallet_balance");
  const values: Array<string | number | boolean | null> = [email];
  let whereClause = "email = ?";
  if (staffCols.has("name")) {
    whereClause = "(email = ? OR name = ?)";
    values.push(email);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${selectCols.join(", ")} FROM staff_users WHERE ${whereClause} LIMIT 1`,
    values
  );
  let row = rows[0] as RowDataPacket | undefined;
  if (row?.active) {
    const ok = await bcrypt.compare(password, row.password_hash as string);
    if (ok) {
      // fall through to JWT
    } else {
      row = undefined;
    }
  } else {
    row = undefined;
  }
  if (!row) {
    const fromRm = await tryLoginViaRmManagers(pool, config.defaultTenantId, email, password);
    if (fromRm) row = fromRm;
  }
  if (!row?.active) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const [rolePermRows] = await pool.query<RowDataPacket[]>(
    `SELECT permissions_json
     FROM staff_role_permissions
     WHERE tenant_id = ? AND role = ?
     LIMIT 1`,
    [row.tenant_id as string, row.role as string]
  );
  const roleTemplate = parsePermissionsObject(rolePermRows[0]?.permissions_json);
  const userOverrides = parsePermissionsObject(row.permissions_json);
  const mergedPermissions = parseManagerPermissions({ ...roleTemplate, ...userOverrides });

  const payload: JwtPayload = {
    sub: row.id as string,
    name: row.name != null ? String(row.name) : undefined,
    email: row.email as string,
    role: row.role as Role,
    tenantId: row.tenant_id as string,
    permissions: mergedPermissions,
    walletBalance: Number(row.wallet_balance ?? 0),
  };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: "12h" });
  res.json({
    token,
    user: {
      id: payload.sub,
      name: payload.name ?? null,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId,
      permissions: payload.permissions ?? {},
      walletBalance: payload.walletBalance ?? 0,
    },
  });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.auth });
});

export default router;
