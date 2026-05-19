import { Router } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { RadiusSyncService } from "../services/radius-sync.service.js";
import {
  evaluateSubscriberAccessFromRow,
  loadSubscriberAccessRow,
} from "../lib/subscriber-access-guard.js";
import { loginRateLimiter } from "../middleware/rate-limit.js";
import { requireSubscriberAuth } from "../middleware/subscriber-auth.js";
import { AccountingService } from "../services/accounting.service.js";
import {
  findPortalLoginCandidates,
  getPortalMePayload,
  verifyPortalCredentials,
} from "../services/portal-subscriber.service.js";
import { sendSubscriberProfileUpdatedWhatsApp } from "../services/whatsapp.service.js";

const router = Router();
const radiusSync = new RadiusSyncService(pool);
const accounting = new AccountingService(pool);

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  phone: z.string().optional(),
});

router.post("/login", loginRateLimiter, async (req, res, next) => {
  try {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    if (parsed.data.phone && !parsed.data.username) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT s.id, s.tenant_id, s.username, c.password AS radius_password_plain
         FROM subscribers s
         JOIN subscriber_credentials c ON c.subscriber_id = s.id AND c.tenant_id = s.tenant_id
         WHERE s.phone = ? LIMIT 1`,
        [parsed.data.phone.trim()]
      );
      const row = rows[0] as import("../services/portal-subscriber.service.js").PortalSubscriberRow | undefined;
      if (!row) {
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }
      const tenantId = String(row.tenant_id ?? config.defaultTenantId);
      const access = await loadSubscriberAccessRow(pool, { tenantId, subscriberId: String(row.id) });
      const gate = access ? evaluateSubscriberAccessFromRow(access) : { ok: false as const, reason: "not_found" };
      if (!gate.ok) {
        res.status(403).json({ error: gate.reason });
        return;
      }
      const payload = {
        kind: "subscriber" as const,
        sub: String(row.id),
        tenantId,
        username: String(row.username),
      };
      const token = jwt.sign(payload, config.jwtSecret, {
        expiresIn: (process.env.PORTAL_JWT_EXPIRES_IN ?? "7d") as SignOptions["expiresIn"],
      });
      res.json({ token });
      return;
    }

    const candidates = await findPortalLoginCandidates(pool, parsed.data.username);
    if (candidates.length === 0) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    if (candidates.length > 1) {
      res.status(400).json({ error: "ambiguous_username" });
      return;
    }
    const row = candidates[0];
    const v = await verifyPortalCredentials(pool, row, parsed.data.password);
    if (!v.ok) {
      res.status(401).json({ error: v.reason });
      return;
    }
    const payload = {
      kind: "subscriber" as const,
      sub: String(row.id),
      tenantId: String(row.tenant_id),
      username: String(row.username),
    };
    const token = jwt.sign(payload, config.jwtSecret, {
      expiresIn: (process.env.PORTAL_JWT_EXPIRES_IN ?? "7d") as SignOptions["expiresIn"],
    });
    res.json({ token });
  } catch (e) {
    next(e);
  }
});

router.get("/me", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const me = await getPortalMePayload(pool, s.tenantId, s.sub, s.username);
    if (!me) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(me);
  } catch (e) {
    next(e);
  }
});

router.get("/me/traffic-report", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const q = z.object({ from: z.string().optional(), to: z.string().optional() }).safeParse(req.query);
    const report = await accounting.buildSubscriberTrafficReport(s.tenantId, s.username, {
      from: q.success ? q.data.from : undefined,
      to: q.success ? q.data.to : undefined,
    });
    res.json(report);
  } catch (e) {
    next(e);
  }
});

router.patch("/:username/password", async (req, res, next) => {
  try {
    const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, tenant_id FROM subscribers WHERE username = ? LIMIT 1`,
      [req.params.username]
    );
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    await pool.execute(
      `UPDATE subscriber_credentials SET password = ?, updated_at = CURRENT_TIMESTAMP
       WHERE subscriber_id = ? AND tenant_id = ?`,
      [parsed.data.password, String(row.id), String(row.tenant_id)]
    );
    const tenantId = String(row.tenant_id || config.defaultTenantId);
    const subscriberId = String(row.id);
    await radiusSync.syncSubscriber(subscriberId, tenantId);
    void sendSubscriberProfileUpdatedWhatsApp({
      tenantId,
      subscriberId,
      changeDetail: "تم تحديث كلمة المرور",
    }).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
