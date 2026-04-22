import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { randomUUID } from "crypto";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { requireSubscriberAuth } from "../middleware/subscriber-auth.js";
import type { SubscriberJwtPayload } from "../middleware/subscriber-auth.js";
import { encryptSecret } from "../services/crypto.service.js";
import { RadiusService } from "../services/radius.service.js";
import { hasTable } from "../db/schemaGuards.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const radius = new RadiusService(pool);

const loginBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const tenantId = config.defaultTenantId;
  const { username, password } = parsed.data;
  const [subs] = await pool.query<RowDataPacket[]>(
    `SELECT id, username, status FROM subscribers WHERE tenant_id = ? AND username = ? LIMIT 1`,
    [tenantId, username]
  );
  if (!subs[0]) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const [pwRows] = await pool.query<RowDataPacket[]>(
    `SELECT value FROM radcheck WHERE username = ? AND attribute = 'Cleartext-Password' LIMIT 1`,
    [username]
  );
  const stored = pwRows[0]?.value != null ? String(pwRows[0].value) : null;
  if (!stored || stored !== password) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const payload: SubscriberJwtPayload = {
    kind: "subscriber",
    sub: subs[0].id as string,
    tenantId,
    username: subs[0].username as string,
  };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: "24h" });
  res.json({ token, user: { id: payload.sub, username: payload.username } });
});

router.get("/me", requireSubscriberAuth, async (req, res) => {
  const sid = req.subscriber!.sub;
  const tenantId = req.subscriber!.tenantId;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.username, s.status, s.expiration_date, s.start_date, s.used_bytes,
            p.name AS package_name, p.mikrotik_rate_limit, p.quota_total_bytes,
            u.total_bytes AS usage_live_bytes
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id
     LEFT JOIN user_usage_live u ON u.tenant_id = s.tenant_id AND u.username = s.username
     WHERE s.id = ? AND s.tenant_id = ? LIMIT 1`,
    [sid, tenantId]
  );
  if (!rows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  let framedIp: string | null = null;
  if (await hasTable(pool, "radacct")) {
    const [sess] = await pool.query<RowDataPacket[]>(
      `SELECT framedipaddress FROM radacct
       WHERE username = ? AND acctstoptime IS NULL
       ORDER BY acctstarttime DESC LIMIT 1`,
      [rows[0].username as string]
    );
    framedIp = sess[0]?.framedipaddress != null ? String(sess[0].framedipaddress) : null;
  }
  const quota = BigInt(rows[0].quota_total_bytes as string | number | bigint ?? 0);
  const used = BigInt(
    (rows[0].usage_live_bytes ?? rows[0].used_bytes ?? 0) as string | number | bigint
  );
  const remaining =
    quota > 0n ? (used >= quota ? 0n : quota - used) : null;
  res.json({
    subscriber: rows[0],
    current_ip: framedIp,
    usage_bytes: used.toString(),
    quota_bytes: quota.toString(),
    remaining_bytes: remaining != null ? remaining.toString() : null,
  });
});

const changePwBody = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(1),
});

router.post("/change-password", requireSubscriberAuth, async (req, res) => {
  const parsed = changePwBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const { current_password, new_password } = parsed.data;
  const username = req.subscriber!.username;
  const sid = req.subscriber!.sub;
  const tenantId = req.subscriber!.tenantId;
  const [pwRows] = await pool.query<RowDataPacket[]>(
    `SELECT value FROM radcheck WHERE username = ? AND attribute = 'Cleartext-Password' LIMIT 1`,
    [username]
  );
  const stored = pwRows[0]?.value != null ? String(pwRows[0].value) : null;
  if (!stored || stored !== current_password) {
    res.status(400).json({ error: "wrong_password" });
    return;
  }
  const enc = encryptSecret(new_password);
  await pool.execute(`UPDATE subscribers SET radius_password_encrypted = ? WHERE id = ? AND tenant_id = ?`, [
    enc,
    sid,
    tenantId,
  ]);
  const [sub] = await pool.query<RowDataPacket[]>(
    `SELECT package_id, status, ip_address, mac_address, pool FROM subscribers WHERE id = ? AND tenant_id = ?`,
    [sid, tenantId]
  );
  if (sub[0]?.package_id && sub[0].status === "active") {
    const pkg = await radius.getPackage(tenantId, sub[0].package_id as string);
    if (pkg) {
      await radius.createRadiusUser({
        username,
        password: new_password,
        package: pkg,
        framedIp: sub[0].ip_address as string | null,
        macLock: sub[0].mac_address as string | null,
        framedPool: sub[0].pool as string | null,
      });
    }
  } else {
    await pool.execute(
      `UPDATE radcheck SET value = ? WHERE username = ? AND attribute = 'Cleartext-Password'`,
      [new_password, username]
    );
  }
  res.json({ ok: true });
});

export default router;
