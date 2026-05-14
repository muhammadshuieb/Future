import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { hasEnterpriseStaffPermission } from "../lib/enterprise-staff-permissions.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function requireQoeView(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  if (!hasEnterpriseStaffPermission(req, "view_qoe")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

function requireQoeRules(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  if (!hasEnterpriseStaffPermission(req, "manage_qoe_rules")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

router.get("/overview", requireQoeView, async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    const [worst] = await pool.query<RowDataPacket[]>(
      `SELECT m.subscriber_id, m.score, m.status, m.computed_at, s.username
       FROM subscriber_qoe_metrics m
       JOIN subscribers s ON s.id = m.subscriber_id AND s.tenant_id = m.tenant_id
       WHERE m.tenant_id = ?
       ORDER BY m.computed_at DESC
       LIMIT 200`,
      [t]
    );
    const bySub = new Map<string, RowDataPacket>();
    for (const r of worst) {
      const sid = String(r.subscriber_id);
      if (!bySub.has(sid)) bySub.set(sid, r);
    }
    res.json({ worst_subscribers: [...bySub.values()].slice(0, 20) });
  } catch (e) {
    next(e);
  }
});

router.get("/subscribers", requireQoeView, async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.username, m.score, m.status, m.computed_at
       FROM subscribers s
       LEFT JOIN subscriber_qoe_metrics m
         ON m.subscriber_id = s.id AND m.tenant_id = s.tenant_id
         AND m.computed_at = (
           SELECT MAX(z.computed_at) FROM subscriber_qoe_metrics z
           WHERE z.subscriber_id = s.id AND z.tenant_id = s.tenant_id
         )
       WHERE s.tenant_id = ?
       ORDER BY COALESCE(m.score, 100) ASC
       LIMIT 500`,
      [t]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.get("/subscribers/:id", requireQoeView, async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM subscriber_qoe_metrics WHERE tenant_id = ? AND subscriber_id = ? ORDER BY computed_at DESC LIMIT 50`,
      [t, req.params.id]
    );
    const [samples] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM subscriber_qoe_samples WHERE tenant_id = ? AND subscriber_id = ? ORDER BY sampled_at DESC LIMIT 100`,
      [t, req.params.id]
    );
    if (!rows.length && !samples.length) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ metrics: rows, samples });
  } catch (e) {
    next(e);
  }
});

router.get("/nas/:id", requireQoeView, async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM nas_qoe_scores WHERE tenant_id = ? AND nas_device_id = ? ORDER BY computed_at DESC LIMIT 50`,
      [t, req.params.id]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.get("/towers", requireQoeView, async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM tower_qoe_scores WHERE tenant_id = ? ORDER BY computed_at DESC LIMIT 200`,
      [t]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.get("/alerts", requireQoeView, async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM subscriber_qoe_alerts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`,
      [t]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.post("/alerts/:id/ack", requireQoeView, async (req, res, next) => {
  try {
    const t = req.auth!.tenantId;
    await pool.execute(
      `UPDATE subscriber_qoe_alerts SET status = 'ack', acknowledged_at = NOW(3), acknowledged_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [req.auth!.sub, req.params.id, t]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get("/rules", requireQoeView, async (req, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM qoe_rules WHERE tenant_id = ? ORDER BY name`,
      [req.auth!.tenantId]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.post("/rules", requireQoeRules, async (req, res, next) => {
  try {
    const parsed = z.object({ name: z.string().min(1), config_json: z.record(z.unknown()), enabled: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO qoe_rules (id, tenant_id, name, config_json, enabled) VALUES (?, ?, ?, CAST(? AS JSON), ?)`,
      [id, req.auth!.tenantId, parsed.data.name, JSON.stringify(parsed.data.config_json), parsed.data.enabled === false ? 0 : 1]
    );
    res.status(201).json({ id });
  } catch (e) {
    next(e);
  }
});

router.put("/rules/:id", requireQoeRules, async (req, res, next) => {
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
    await pool.execute(`UPDATE qoe_rules SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`, args as never);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete("/rules/:id", requireQoeRules, async (req, res, next) => {
  try {
    await pool.execute(`DELETE FROM qoe_rules WHERE id = ? AND tenant_id = ?`, [req.params.id, req.auth!.tenantId]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
