import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
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
  // `email` field is treated as login identifier (managername) for backward compatibility with frontend payload.
  let row = (await tryLoginViaRmManagers(pool, config.defaultTenantId, email, password)) ?? undefined;
  if (!row?.active) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  let roleTemplate: Record<string, boolean> = {};
  try {
    const [rolePermRows] = await pool.query<RowDataPacket[]>(
      `SELECT permissions_json
       FROM staff_role_permissions
       WHERE tenant_id = ? AND role = ?
       LIMIT 1`,
      [row.tenant_id as string, row.role as string]
    );
    roleTemplate = parsePermissionsObject(rolePermRows[0]?.permissions_json);
  } catch (error) {
    const e = error as { code?: string; errno?: number };
    // Old Radius Manager dumps may not include this table yet.
    if (!(e?.code === "ER_NO_SUCH_TABLE" || e?.errno === 1146)) {
      throw error;
    }
  }
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
