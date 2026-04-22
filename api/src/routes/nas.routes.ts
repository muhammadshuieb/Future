import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { getTableColumns, hasTable } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { denyAccountant, denyViewerWrites } from "../middleware/capabilities.js";
import { decryptSecret, encryptSecret } from "../services/crypto.service.js";
import { CoaService } from "../services/coa.service.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const coa = new CoaService(pool);

router.use(requireAuth);

async function upsertLegacyNas(input: {
  legacyId?: number | null;
  ip: string;
  name: string;
  type?: string | null;
  secret: string;
}): Promise<number | null> {
  if (!(await hasTable(pool, "nas"))) return null;
  const type = (input.type || "other").trim() || "other";
  const shortName = input.name.trim() || input.ip;
  if (input.legacyId && Number.isFinite(input.legacyId)) {
    await pool.execute(
      `UPDATE nas
       SET nasname = ?, shortname = ?, type = ?, secret = ?, description = COALESCE(description, '')
       WHERE id = ?`,
      [input.ip, shortName, type, input.secret, input.legacyId]
    );
    return input.legacyId;
  }
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM nas WHERE nasname = ? LIMIT 1`,
    [input.ip]
  );
  if (existing[0]?.id) {
    await pool.execute(
      `UPDATE nas
       SET shortname = ?, type = ?, secret = ?, description = COALESCE(description, '')
       WHERE id = ?`,
      [shortName, type, input.secret, Number(existing[0].id)]
    );
    return Number(existing[0].id);
  }
  const [ins] = await pool.execute(
    `INSERT INTO nas (nasname, shortname, type, secret, description)
     VALUES (?, ?, ?, ?, '')`,
    [input.ip, shortName, type, input.secret]
  );
  return Number((ins as { insertId?: number }).insertId ?? 0) || null;
}

router.get("/", requireRole("admin", "manager", "accountant", "viewer"), async (req: Request, res: Response) => {
  try {
    let modern: RowDataPacket[] = [];
    if (await hasTable(pool, "nas_servers")) {
      const col = await getTableColumns(pool, "nas_servers");
      const want = [
        "id",
        "legacy_nas_id",
        "name",
        "ip",
        "type",
        "mikrotik_api_enabled",
        "mikrotik_api_user",
        "status",
        "coa_port",
        "online_status",
        "last_ping_ok",
        "last_radius_ok",
        "last_check_at",
        "session_count",
        "created_at",
      ];
      const sel = want.filter((c) => col.has(c.toLowerCase()));
      if (sel.length > 0 && col.has("tenant_id")) {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT ${sel.join(", ")} FROM nas_servers WHERE tenant_id = ?`,
          [req.auth!.tenantId]
        );
        modern = rows.map((r: RowDataPacket) => {
          const row = { ...r } as Record<string, unknown>;
          if (!col.has("online_status")) row.online_status = "unknown";
          if (!col.has("session_count")) row.session_count = 0;
          if (!col.has("coa_port")) row.coa_port = 3799;
          if (!col.has("last_ping_ok")) row.last_ping_ok = null;
          if (!col.has("last_radius_ok")) row.last_radius_ok = null;
          if (!col.has("last_check_at")) row.last_check_at = null;
          if (!col.has("legacy_nas_id")) row.legacy_nas_id = null;
          return row as RowDataPacket;
        });
      }
    }
    let legacy: RowDataPacket[] = [];
    if (await hasTable(pool, "nas")) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, nasname AS ip, shortname AS name, type, secret, description FROM nas`
      );
      legacy = rows;
    }
    res.json({ nas_servers: modern, nas_legacy: legacy });
  } catch (e) {
    console.error("nas GET", e);
    res.status(500).json({
      error: "db_error",
      detail: e instanceof Error ? e.message : String(e),
      nas_servers: [],
      nas_legacy: [],
    });
  }
});

const nasBody = z.object({
  name: z.string().min(1),
  ip: z.string().min(1),
  secret: z.string().min(1),
  type: z.string().optional(),
  password: z.string().optional(),
  mikrotik_api_enabled: z.boolean().optional(),
  mikrotik_api_user: z.string().optional(),
  mikrotik_api_password: z.string().optional(),
  legacy_nas_id: z.number().int().nullable().optional(),
});

router.post("/", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req: Request, res: Response) => {
  const parsed = nasBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const id = randomUUID();
  try {
    const enc = encryptSecret(parsed.data.secret);
    const col = await getTableColumns(pool, "nas_servers");
    const fields: string[] = [];
    const vals: (string | number | Uint8Array | null)[] = [];
    const push = (f: string, v: string | number | Uint8Array | null) => {
      if (col.has(f)) {
        fields.push(f);
        vals.push(v);
      }
    };
    push("id", id);
    push("tenant_id", req.auth!.tenantId);
    push("legacy_nas_id", parsed.data.legacy_nas_id ?? null);
    push("name", parsed.data.name);
    push("ip", parsed.data.ip);
    push("secret_encrypted", enc);
    push("type", parsed.data.type ?? "mikrotik");
    push("mikrotik_api_enabled", parsed.data.mikrotik_api_enabled ? 1 : 0);
    push("mikrotik_api_user", parsed.data.mikrotik_api_user?.trim() || null);
    if (parsed.data.password && parsed.data.password.trim()) {
      push("password_encrypted", encryptSecret(parsed.data.password.trim()));
    }
    if (parsed.data.mikrotik_api_password && parsed.data.mikrotik_api_password.trim()) {
      push("mikrotik_api_password_encrypted", encryptSecret(parsed.data.mikrotik_api_password.trim()));
    }
    push("status", "active");
    if (col.has("coa_port")) {
      fields.push("coa_port");
      vals.push(3799);
    }
    if (col.has("online_status")) {
      fields.push("online_status");
      vals.push("unknown");
    }
    if (col.has("session_count")) {
      fields.push("session_count");
      vals.push(0);
    }
    if (fields.length === 0) {
      res.status(500).json({ error: "nas_servers_schema", detail: "no insertable columns" });
      return;
    }
    await pool.execute(
      `INSERT INTO nas_servers (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`,
      vals
    );
    // FreeRADIUS authorizes NAS clients from legacy `nas` table.
    const legacyId = await upsertLegacyNas({
      legacyId: parsed.data.legacy_nas_id ?? null,
      ip: parsed.data.ip,
      name: parsed.data.name,
      type: parsed.data.type ?? "mikrotik",
      secret: parsed.data.secret,
    });
    if (legacyId && col.has("legacy_nas_id")) {
      await pool.execute(`UPDATE nas_servers SET legacy_nas_id = ? WHERE id = ? AND tenant_id = ?`, [
        legacyId,
        id,
        req.auth!.tenantId,
      ]);
    }
    res.status(201).json({ id });
  } catch (e) {
    console.error("nas POST", e);
    res.status(500).json({
      error: "db_error",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

const nasPatch = nasBody.partial();

router.patch(
  "/:id",
  requireRole("admin", "manager"),
  denyViewerWrites,
  denyAccountant,
  async (req: Request, res: Response) => {
    const parsed = nasPatch.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const tenant = req.auth!.tenantId;
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, ip, type, secret_encrypted, legacy_nas_id
       FROM nas_servers
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [req.params.id, tenant]
    );
    if (!existing[0]) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const b = parsed.data;
    const col = await getTableColumns(pool, "nas_servers");
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (b.name !== undefined) {
      sets.push("name = ?");
      vals.push(b.name);
    }
    if (b.ip !== undefined) {
      sets.push("ip = ?");
      vals.push(b.ip);
    }
    if (b.type !== undefined) {
      sets.push("type = ?");
      vals.push(b.type);
    }
    if (b.mikrotik_api_enabled !== undefined && col.has("mikrotik_api_enabled")) {
      sets.push("mikrotik_api_enabled = ?");
      vals.push(b.mikrotik_api_enabled ? 1 : 0);
    }
    if (b.mikrotik_api_user !== undefined && col.has("mikrotik_api_user")) {
      sets.push("mikrotik_api_user = ?");
      vals.push(b.mikrotik_api_user?.trim() || null);
    }
    if (b.legacy_nas_id !== undefined) {
      sets.push("legacy_nas_id = ?");
      vals.push(b.legacy_nas_id);
    }
    if (b.secret !== undefined && b.secret.length > 0) {
      sets.push("secret_encrypted = ?");
      vals.push(encryptSecret(b.secret));
    }
    if (b.password !== undefined && b.password.length > 0 && col.has("password_encrypted")) {
      sets.push("password_encrypted = ?");
      vals.push(encryptSecret(b.password));
    }
    if (
      b.mikrotik_api_password !== undefined &&
      b.mikrotik_api_password.length > 0 &&
      col.has("mikrotik_api_password_encrypted")
    ) {
      sets.push("mikrotik_api_password_encrypted = ?");
      vals.push(encryptSecret(b.mikrotik_api_password));
    }
    if (!sets.length) {
      res.json({ ok: true });
      return;
    }
    try {
      await pool.query(`UPDATE nas_servers SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`, [
        ...vals,
        req.params.id,
        tenant,
      ]);
      const currentName = String(existing[0].name ?? "");
      const currentIp = String(existing[0].ip ?? "");
      const currentType = String(existing[0].type ?? "mikrotik");
      let currentSecret = "";
      try {
        currentSecret = decryptSecret(Buffer.from(existing[0].secret_encrypted as Uint8Array));
      } catch {
        currentSecret = "";
      }
      const syncedLegacyId = await upsertLegacyNas({
        legacyId: b.legacy_nas_id ?? (existing[0].legacy_nas_id != null ? Number(existing[0].legacy_nas_id) : null),
        ip: b.ip ?? currentIp,
        name: b.name ?? currentName,
        type: b.type ?? currentType,
        secret: b.secret && b.secret.length > 0 ? b.secret : currentSecret,
      });
      if (syncedLegacyId && col.has("legacy_nas_id")) {
        await pool.execute(`UPDATE nas_servers SET legacy_nas_id = ? WHERE id = ? AND tenant_id = ?`, [
          syncedLegacyId,
          req.params.id,
          tenant,
        ]);
      }
      res.json({ ok: true });
    } catch (e) {
      console.error("nas PATCH", e);
      res.status(500).json({
        error: "db_error",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
);

router.post("/:id/coa-test", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req: Request, res: Response) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ip FROM nas_servers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [req.params.id, req.auth!.tenantId]
  );
  if (!rows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const testUser = "coa-probe-disconnect-invalid-user";
  const r = await coa.disconnectUserForTenant(testUser, rows[0].ip as string, req.auth!.tenantId);
  res.json({ result: r });
});

router.get("/:id/secret", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req: Request, res: Response) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT secret_encrypted
     FROM nas_servers
     WHERE id = ? AND tenant_id = ?
     LIMIT 1`,
    [req.params.id, req.auth!.tenantId]
  );
  const row = rows[0];
  if (!row?.secret_encrypted) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    const secret = decryptSecret(Buffer.from(row.secret_encrypted as Uint8Array));
    res.json({ secret });
  } catch {
    res.status(500).json({ error: "secret_decrypt_failed" });
  }
});

export default router;
