import bcrypt from "bcryptjs";
import { Router } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";
import {
  defaultFinancePermissions,
  normalizeFinancePermissions,
  accountantFinanceDefaults,
} from "../lib/finance-permissions.js";
import {
  defaultManagerPermissions,
  normalizeManagerPermissions,
  parsePermissionsObject,
} from "../lib/manager-permissions.js";
import {
  defaultIspPermissionsAccountant,
  defaultIspPermissionsAllOn,
  defaultIspPermissionsManager,
  defaultIspPermissionsViewer,
  normalizeIspPermissions,
} from "../lib/isp-permissions.js";
import {
  defaultSpeedProfilePermissionsAllOn,
  normalizeSpeedProfilePermissions,
} from "../lib/speed-profile-permissions.js";
import {
  defaultMonitoringPermissionsAllOn,
  defaultMonitoringPermissionsManager,
  defaultMonitoringPermissionsViewer,
  normalizeMonitoringPermissions,
} from "../lib/monitoring-permissions.js";
import { loginRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth, type JwtPayload, type Role } from "../middleware/auth.js";

const router = Router();

const loginBody = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

/** Match `users.email` when the operator types `root` instead of the full bootstrap address. */
function staffTableEmailCandidates(loginRaw: string): string[] {
  const t = loginRaw.trim();
  if (!t) return [];
  const out = new Set<string>([t]);
  const lower = t.toLowerCase();
  const defaultStaff = (process.env.STAFF_BOOTSTRAP_EMAIL ?? "admin@futureradius.local").trim();
  if (lower === "root" && defaultStaff) out.add(defaultStaff);
  if (!t.includes("@")) {
    out.add(`${t}@futureradius.local`);
  }
  return [...out];
}

async function managerJwtPermissions(
  tenantId: string,
  userRow: RowDataPacket
): Promise<Record<string, boolean>> {
  const userOverride = parsePermissionsObject(userRow.permissions_json ?? {});
  const finance = normalizeFinancePermissions({ ...defaultFinancePermissions(), ...userOverride });
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT permissions_json FROM staff_role_permissions WHERE tenant_id = ? AND role = 'manager' LIMIT 1`,
    [tenantId]
  );
  const roleDefaults = normalizeManagerPermissions(rows[0]?.permissions_json ?? {});
  const manager = normalizeManagerPermissions({ ...roleDefaults, ...userOverride });
  const mergedForSpeed = { ...parsePermissionsObject(rows[0]?.permissions_json ?? {}), ...userOverride };
  const speed = {
    ...defaultSpeedProfilePermissionsAllOn(),
    ...normalizeSpeedProfilePermissions(mergedForSpeed),
  };
  return { ...finance, ...manager, ...speed };
}

async function viewerJwtPermissions(tenantId: string, userRow: RowDataPacket): Promise<Record<string, boolean>> {
  const userOverride = parsePermissionsObject(userRow.permissions_json ?? {});
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT permissions_json FROM staff_role_permissions WHERE tenant_id = ? AND role = 'viewer' LIMIT 1`,
    [tenantId]
  );
  const merged = { ...parsePermissionsObject(rows[0]?.permissions_json ?? {}), ...userOverride };
  return normalizeSpeedProfilePermissions(merged);
}

router.post("/login", loginRateLimiter, async (req, res, next) => {
  try {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const emailInput = parsed.data.email.trim();
    const password = parsed.data.password;

    if (!(await hasTable(pool, "users"))) {
      res.status(503).json({ error: "auth_schema_missing" });
      return;
    }

    const candidates = staffTableEmailCandidates(emailInput);
    const orEmail = candidates.map(() => "LOWER(TRIM(u.email)) = LOWER(?)").join(" OR ");
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.tenant_id, u.email, u.name, u.password_hash, u.status, u.permissions_json, u.wallet_balance,
              (
                SELECT r2.name
                FROM user_roles ur2
                JOIN roles r2 ON r2.id = ur2.role_id
                WHERE ur2.user_id = u.id
                ORDER BY CASE r2.name
                  WHEN 'admin' THEN 1
                  WHEN 'manager' THEN 2
                  WHEN 'accountant' THEN 3
                  WHEN 'viewer' THEN 4
                  ELSE 5 END
                LIMIT 1
              ) AS role
       FROM users u
       WHERE (${orEmail})
       LIMIT 1`,
      candidates
    );
    const user = rows[0] as RowDataPacket | undefined;

    if (user && String(user.status ?? "active") === "active") {
      const ph = String(user.password_hash ?? "");
      const ok = ph.length > 0 && (await bcrypt.compare(password, ph));
      if (ok) {
        const role = String(user.role ?? "viewer") as Role;
        let permissions: Record<string, boolean> = {};
        const userOverride = parsePermissionsObject(user.permissions_json ?? {});
        if (role === "admin") {
          permissions = {
            ...defaultFinancePermissions(),
            ...defaultManagerPermissions(),
            ...defaultSpeedProfilePermissionsAllOn(),
            ...defaultIspPermissionsAllOn(),
            ...defaultMonitoringPermissionsAllOn(),
            ...userOverride,
          };
        } else if (role === "manager") {
          permissions = {
            ...(await managerJwtPermissions(String(user.tenant_id), user)),
            ...normalizeIspPermissions(userOverride, defaultIspPermissionsManager()),
            ...normalizeMonitoringPermissions(userOverride, defaultMonitoringPermissionsManager()),
          };
        } else if (role === "viewer") {
          permissions = {
            ...(await viewerJwtPermissions(String(user.tenant_id), user)),
            ...normalizeIspPermissions(userOverride, defaultIspPermissionsViewer()),
            ...normalizeMonitoringPermissions(userOverride, defaultMonitoringPermissionsViewer()),
          };
        } else if (role === "accountant") {
          permissions = {
            ...normalizeFinancePermissions({
              ...accountantFinanceDefaults(),
              ...userOverride,
            }),
            ...normalizeIspPermissions(userOverride, defaultIspPermissionsAccountant()),
            ...normalizeMonitoringPermissions(userOverride, defaultMonitoringPermissionsViewer()),
          };
        }
        const walletBalance = Number(user.wallet_balance ?? 0);
        const payload: JwtPayload = {
          sub: String(user.id),
          name: String(user.name ?? ""),
          email: String(user.email),
          role,
          tenantId: String(user.tenant_id),
          permissions,
          walletBalance,
        };
        const token = jwt.sign(payload, config.jwtSecret, {
          expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"],
        });
        res.json({
          token,
          user: {
            id: payload.sub,
            name: payload.name,
            email: payload.email,
            role: payload.role,
            tenantId: payload.tenantId,
            permissions: payload.permissions,
            walletBalance: payload.walletBalance,
          },
        });
        return;
      }
    }

    res.status(401).json({ error: "invalid_credentials" });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.auth });
});

export default router;
