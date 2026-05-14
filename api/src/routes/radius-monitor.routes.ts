import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { hasEnterpriseStaffPermission } from "../lib/enterprise-staff-permissions.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function gate(key: Parameters<typeof hasEnterpriseStaffPermission>[1]) {
  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (!hasEnterpriseStaffPermission(req, key)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}

router.get("/overview", gate("view_radius_monitor"), async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    const [snap] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM radius_metrics_snapshots WHERE tenant_id = ? ORDER BY bucket_start DESC LIMIT 1`,
      [t]
    );
    res.json({ latest: snap[0] ?? null });
  } catch (e) {
    next(e);
  }
});

router.get("/live", gate("view_radius_monitor"), async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM radius_metrics_snapshots WHERE tenant_id = ? ORDER BY bucket_start DESC LIMIT 60`,
      [t]
    );
    res.json({ buckets: rows });
  } catch (e) {
    next(e);
  }
});

router.get("/nas", gate("view_radius_monitor"), async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT n.id, n.name, n.ip, n.session_count, n.online_status
       FROM nas_devices n WHERE n.tenant_id = ? ORDER BY n.session_count DESC`,
      [t]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.get("/auth-events", gate("view_radius_monitor"), async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM radius_auth_events WHERE tenant_id = ? ORDER BY event_time DESC LIMIT 200`,
      [t]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.get("/acct-events", gate("view_radius_monitor"), async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM radius_acct_events WHERE tenant_id = ? ORDER BY event_time DESC LIMIT 200`,
      [t]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.get("/coa-events", gate("view_radius_monitor"), async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM radius_coa_events WHERE tenant_id = ? ORDER BY event_time DESC LIMIT 200`,
      [t]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.get("/alerts", gate("view_radius_monitor"), async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM radius_monitor_alerts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`,
      [t]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.post("/alerts/:id/ack", gate("view_radius_monitor"), async (req, res, next) => {
  try {
    await pool.execute(
      `UPDATE radius_monitor_alerts SET status = 'ack', acknowledged_at = NOW(3), acknowledged_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [req.auth!.sub, req.params.id, req.auth!.tenantId]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get("/rules", gate("view_radius_monitor"), async (req, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM radius_monitor_rules WHERE tenant_id = ?`,
      [req.auth!.tenantId]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.post("/rules", gate("manage_radius_monitor_rules"), async (req, res, next) => {
  try {
    const parsed = z.object({ name: z.string().min(1), config_json: z.record(z.unknown()) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO radius_monitor_rules (id, tenant_id, name, config_json) VALUES (?,?,?,CAST(? AS JSON))`,
      [id, req.auth!.tenantId, parsed.data.name, JSON.stringify(parsed.data.config_json)]
    );
    res.status(201).json({ id });
  } catch (e) {
    next(e);
  }
});

router.put("/rules/:id", gate("manage_radius_monitor_rules"), async (req, res, next) => {
  try {
    const parsed = z.object({ name: z.string().optional(), config_json: z.record(z.unknown()).optional(), enabled: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const sets: string[] = [];
    const args: unknown[] = [];
    if (parsed.data.name) {
      sets.push("name = ?");
      args.push(parsed.data.name);
    }
    if (parsed.data.config_json) {
      sets.push("config_json = CAST(? AS JSON)");
      args.push(JSON.stringify(parsed.data.config_json));
    }
    if (parsed.data.enabled != null) {
      sets.push("enabled = ?");
      args.push(parsed.data.enabled ? 1 : 0);
    }
    if (!sets.length) {
      res.status(400).json({ error: "empty_update" });
      return;
    }
    args.push(req.params.id, req.auth!.tenantId);
    await pool.execute(`UPDATE radius_monitor_rules SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`, args as never);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete("/rules/:id", gate("manage_radius_monitor_rules"), async (req, res, next) => {
  try {
    await pool.execute(`DELETE FROM radius_monitor_rules WHERE id = ? AND tenant_id = ?`, [req.params.id, req.auth!.tenantId]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
