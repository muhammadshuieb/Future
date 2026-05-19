import { randomUUID } from "crypto";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { denyAccountant, denyViewerWrites } from "../middleware/capabilities.js";
import { RadiusSyncService } from "../services/radius-sync.service.js";
import {
  nasRowHasMikrotikApi,
  probeMikrotikRouterOsApi,
  resolveMikrotikApiHost,
  resolveMikrotikApiPort,
  listMikrotikInterfaces,
} from "../services/mikrotik-api-probe.js";
import { getTableColumns } from "../db/schemaGuards.js";

const router = Router();
const radiusSync = new RadiusSyncService(pool);

router.use(requireAuth);

const nasBody = z.object({
  name: z.string().min(1),
  ip: z.string().min(1),
  secret: z.string().min(1),
  type: z.string().optional(),
  coa_port: z.number().int().min(1).max(65535).optional(),
  mikrotik_api_enabled: z.boolean().optional(),
  mikrotik_api_user: z.string().nullable().optional(),
  mikrotik_api_password: z.string().nullable().optional(),
  mikrotik_api_port: z.number().int().min(1).max(65535).nullable().optional(),
  traffic_monitor_interface: z.string().max(64).nullable().optional(),
  wireguard_tunnel_ip: z.string().max(64).nullable().optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

const nasListColumns = `id, name, ip, type, status, coa_port, mikrotik_api_enabled, mikrotik_api_user,
            mikrotik_api_port, traffic_monitor_interface,
            online_status, last_ping_ok, last_radius_ok, last_check_at, session_count,
            wireguard_tunnel_ip, created_at, updated_at`;

router.get("/", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${nasListColumns}
     FROM nas_devices
     WHERE tenant_id = ?
     ORDER BY name`,
    [req.auth!.tenantId]
  );
  res.json({ nas_servers: rows, nas_devices: rows });
});

router.get("/:id", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${nasListColumns}
     FROM nas_devices
     WHERE id = ? AND tenant_id = ?
     LIMIT 1`,
    [req.params.id, req.auth!.tenantId]
  );
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ nas: row, nas_device: row });
});

router.post("/", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res) => {
  const parsed = nasBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const id = randomUUID();
  const body = parsed.data;
  await pool.execute(
    `INSERT INTO nas_devices
      (id, tenant_id, name, ip, type, secret, coa_port, mikrotik_api_enabled,
       mikrotik_api_user, mikrotik_api_password, mikrotik_api_port, traffic_monitor_interface,
       wireguard_tunnel_ip, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      req.auth!.tenantId,
      body.name,
      body.ip,
      body.type ?? "mikrotik",
      body.secret,
      body.coa_port ?? 3799,
      body.mikrotik_api_enabled ? 1 : 0,
      body.mikrotik_api_user?.trim() || null,
      body.mikrotik_api_password?.trim() || null,
      body.mikrotik_api_port ?? 8728,
      body.traffic_monitor_interface?.trim() || null,
      body.wireguard_tunnel_ip?.trim() || null,
      body.status ?? "active",
    ]
  );
  await radiusSync.syncNasDevice(id, req.auth!.tenantId);
  res.status(201).json({ id });
});

router.patch("/:id", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res) => {
  const parsed = nasBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const body = parsed.data;
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (body.name !== undefined) set("name", body.name);
  if (body.ip !== undefined) set("ip", body.ip);
  if (body.secret !== undefined) set("secret", body.secret);
  if (body.type !== undefined) set("type", body.type);
  if (body.coa_port !== undefined) set("coa_port", body.coa_port);
  if (body.mikrotik_api_enabled !== undefined) set("mikrotik_api_enabled", body.mikrotik_api_enabled ? 1 : 0);
  if (body.mikrotik_api_user !== undefined) set("mikrotik_api_user", body.mikrotik_api_user?.trim() || null);
  if (body.mikrotik_api_password !== undefined) set("mikrotik_api_password", body.mikrotik_api_password?.trim() || null);
  if (body.mikrotik_api_port !== undefined) set("mikrotik_api_port", body.mikrotik_api_port ?? 8728);
  if (body.traffic_monitor_interface !== undefined) {
    set("traffic_monitor_interface", body.traffic_monitor_interface?.trim() || null);
  }
  if (body.wireguard_tunnel_ip !== undefined) set("wireguard_tunnel_ip", body.wireguard_tunnel_ip?.trim() || null);
  if (body.status !== undefined) set("status", body.status);
  if (!sets.length) {
    res.json({ ok: true });
    return;
  }
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM nas_devices WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [req.params.id, req.auth!.tenantId]
  );
  if (!existing[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await pool.execute(
    `UPDATE nas_devices SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
    [...values, req.params.id, req.auth!.tenantId] as Array<string | number | null>
  );
  await radiusSync.syncNasDevice(req.params.id, req.auth!.tenantId);
  res.json({ ok: true });
});

router.delete("/:id", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ip FROM nas_devices WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [req.params.id, req.auth!.tenantId]
  );
  if (!rows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await pool.execute(`DELETE FROM nas_devices WHERE id = ? AND tenant_id = ?`, [req.params.id, req.auth!.tenantId]);
  await pool.execute(`DELETE FROM nas WHERE description = ? OR nasname = ?`, [
    req.params.id,
    String(rows[0].ip),
  ]);
  res.json({ ok: true });
});

router.post("/:id/test-mikrotik-api", requireRole("admin", "manager"), denyAccountant, async (req, res) => {
  const col = await getTableColumns(pool, "nas_devices");
  const portCol = col.has("mikrotik_api_port") ? ", mikrotik_api_port" : "";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, ip, wireguard_tunnel_ip, mikrotik_api_enabled, mikrotik_api_user, mikrotik_api_password${portCol}
     FROM nas_devices WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [req.params.id, req.auth!.tenantId]
  );
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!nasRowHasMikrotikApi(row)) {
    res.status(400).json({ error: "mikrotik_api_not_configured" });
    return;
  }
  const host = resolveMikrotikApiHost(row);
  if (!host) {
    res.status(400).json({ error: "invalid_api_host" });
    return;
  }
  const user = String(row.mikrotik_api_user ?? "").trim();
  const password = String(row.mikrotik_api_password ?? "");
  const port = resolveMikrotikApiPort(row);
  const result = await probeMikrotikRouterOsApi(host, user, password, port);
  res.json({
    ok: result.ok,
    host: result.host,
    port,
    message: result.message,
  });
});

router.get("/:id/mikrotik-interfaces", requireRole("admin", "manager"), denyAccountant, async (req, res) => {
  const col = await getTableColumns(pool, "nas_devices");
  const portCol = col.has("mikrotik_api_port") ? ", mikrotik_api_port" : "";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, ip, wireguard_tunnel_ip, mikrotik_api_enabled, mikrotik_api_user, mikrotik_api_password${portCol}
     FROM nas_devices WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [req.params.id, req.auth!.tenantId]
  );
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!nasRowHasMikrotikApi(row)) {
    res.status(400).json({ error: "mikrotik_api_not_configured" });
    return;
  }
  const host = resolveMikrotikApiHost(row);
  if (!host) {
    res.status(400).json({ error: "invalid_api_host" });
    return;
  }
  try {
    const interfaces = await listMikrotikInterfaces(
      host,
      String(row.mikrotik_api_user ?? "").trim(),
      String(row.mikrotik_api_password ?? ""),
      resolveMikrotikApiPort(row)
    );
    res.json({ interfaces });
  } catch (err) {
    res.status(400).json({
      error: "interfaces_fetch_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get("/:id/secret", requireRole("admin", "manager"), denyAccountant, async (req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT secret FROM nas_devices WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [req.params.id, req.auth!.tenantId]
  );
  if (!rows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ secret: String(rows[0].secret ?? ""), source: "project" });
});

export default router;
