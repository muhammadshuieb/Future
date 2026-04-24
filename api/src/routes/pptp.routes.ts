import { randomUUID } from "crypto";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";
import { requireAuth } from "../middleware/auth.js";
import { routePolicy } from "../middleware/policy.js";
import { getSystemSettings, updateSystemSettings } from "../services/system-settings.service.js";
import { encryptSecret, tryDecryptSecret } from "../services/crypto.service.js";

const router = Router();
router.use(requireAuth);

const configSchema = z.object({
  pptp_vpn_enabled: z.boolean(),
  pptp_server_host: z.string().max(128),
  pptp_server_port: z.number().int().min(1).max(65535),
  pptp_server_username: z.string().max(128),
  pptp_server_password: z.string().max(128).optional(),
  pptp_local_network_cidr: z.string().max(64),
  pptp_client_pool_cidr: z.string().max(64),
});

const secretCreateSchema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(128),
  static_ip: z.string().trim().max(64).optional(),
  note: z.string().trim().max(255).optional(),
  is_active: z.boolean().optional(),
});

const secretUpdateSchema = z.object({
  username: z.string().trim().min(1).max(128).optional(),
  password: z.string().min(1).max(128).optional(),
  static_ip: z.string().trim().max(64).optional(),
  note: z.string().trim().max(255).optional(),
  is_active: z.boolean().optional(),
});

router.get("/config", routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }), async (req, res) => {
  try {
    const settings = await getSystemSettings(req.auth!.tenantId);
    res.json({
      config: {
        pptp_vpn_enabled: settings.pptp_vpn_enabled,
        pptp_server_host: settings.pptp_server_host,
        pptp_server_port: settings.pptp_server_port,
        pptp_server_username: settings.pptp_server_username,
        pptp_server_password_set: settings.pptp_server_password_set,
        pptp_local_network_cidr: settings.pptp_local_network_cidr,
        pptp_client_pool_cidr: settings.pptp_client_pool_cidr,
      },
    });
  } catch (e) {
    console.error("pptp config get", e);
    res.status(500).json({ error: "pptp_config_failed" });
  }
});

router.put("/config", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const cur = await getSystemSettings(req.auth!.tenantId);
    const next = await updateSystemSettings(req.auth!.tenantId, {
      ...cur,
      ...parsed.data,
      pptp_server_password: parsed.data.pptp_server_password,
    });
    res.json({
      config: {
        pptp_vpn_enabled: next.pptp_vpn_enabled,
        pptp_server_host: next.pptp_server_host,
        pptp_server_port: next.pptp_server_port,
        pptp_server_username: next.pptp_server_username,
        pptp_server_password_set: next.pptp_server_password_set,
        pptp_local_network_cidr: next.pptp_local_network_cidr,
        pptp_client_pool_cidr: next.pptp_client_pool_cidr,
      },
    });
  } catch (e) {
    console.error("pptp config put", e);
    res.status(500).json({ error: "pptp_config_save_failed" });
  }
});

router.get("/secrets", routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }), async (req, res) => {
  try {
    if (!(await hasTable(pool, "pptp_secrets"))) {
      res.json({ secrets: [] });
      return;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, username, password_encrypted, static_ip, is_active, note, updated_at
       FROM pptp_secrets
       WHERE tenant_id = ?
       ORDER BY username ASC`,
      [req.auth!.tenantId]
    );
    const secrets = rows.map((row) => ({
      id: String(row.id),
      username: String(row.username ?? ""),
      password: tryDecryptSecret(Buffer.from(row.password_encrypted as Buffer)) ?? "",
      static_ip: String(row.static_ip ?? ""),
      is_active: Boolean(Number(row.is_active ?? 0)),
      note: String(row.note ?? ""),
      updated_at: row.updated_at ?? null,
    }));
    res.json({ secrets });
  } catch (e) {
    console.error("pptp secrets get", e);
    res.status(500).json({ error: "pptp_secrets_failed" });
  }
});

router.post("/secrets", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  const parsed = secretCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    if (!(await hasTable(pool, "pptp_secrets"))) {
      res.status(503).json({ error: "pptp_secrets_table_missing" });
      return;
    }
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO pptp_secrets
       (id, tenant_id, username, password_encrypted, static_ip, is_active, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.auth!.tenantId,
        parsed.data.username,
        encryptSecret(parsed.data.password),
        parsed.data.static_ip?.trim() || null,
        parsed.data.is_active === false ? 0 : 1,
        parsed.data.note?.trim() || null,
      ]
    );
    res.json({ ok: true, id });
  } catch (e) {
    console.error("pptp secrets post", e);
    res.status(500).json({ error: "pptp_secret_create_failed" });
  }
});

router.patch("/secrets/:id", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  const parsed = secretUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    if (!(await hasTable(pool, "pptp_secrets"))) {
      res.status(503).json({ error: "pptp_secrets_table_missing" });
      return;
    }
    const sets: string[] = [];
    const vals: Array<string | number | Buffer | null> = [];
    if (parsed.data.username !== undefined) {
      sets.push("username = ?");
      vals.push(parsed.data.username);
    }
    if (parsed.data.password !== undefined) {
      sets.push("password_encrypted = ?");
      vals.push(encryptSecret(parsed.data.password));
    }
    if (parsed.data.static_ip !== undefined) {
      sets.push("static_ip = ?");
      vals.push(parsed.data.static_ip.trim() || null);
    }
    if (parsed.data.note !== undefined) {
      sets.push("note = ?");
      vals.push(parsed.data.note.trim() || null);
    }
    if (parsed.data.is_active !== undefined) {
      sets.push("is_active = ?");
      vals.push(parsed.data.is_active ? 1 : 0);
    }
    if (!sets.length) {
      res.status(400).json({ error: "nothing_to_update" });
      return;
    }
    await pool.execute(
      `UPDATE pptp_secrets
       SET ${sets.join(", ")}
       WHERE id = ? AND tenant_id = ?`,
      [...vals, String(req.params.id), req.auth!.tenantId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("pptp secrets patch", e);
    res.status(500).json({ error: "pptp_secret_update_failed" });
  }
});

router.delete("/secrets/:id", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  try {
    if (!(await hasTable(pool, "pptp_secrets"))) {
      res.json({ ok: true });
      return;
    }
    await pool.execute(`DELETE FROM pptp_secrets WHERE id = ? AND tenant_id = ?`, [
      String(req.params.id),
      req.auth!.tenantId,
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error("pptp secrets delete", e);
    res.status(500).json({ error: "pptp_secret_delete_failed" });
  }
});

router.get(
  "/active-connections",
  routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }),
  async (req, res) => {
    try {
      if (!(await hasTable(pool, "pptp_active_connections"))) {
        res.json({ connections: [] });
        return;
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, interface_name, client_ip, server_ip, vpn_ip, username, connected_since, last_seen_at
         FROM pptp_active_connections
         WHERE tenant_id = ?
         ORDER BY last_seen_at DESC, connected_since DESC`,
        [req.auth!.tenantId]
      );
      res.json({ connections: rows });
    } catch (e) {
      console.error("pptp active-connections get", e);
      res.status(500).json({ error: "pptp_active_connections_failed" });
    }
  }
);

export default router;
