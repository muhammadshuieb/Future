import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { routePolicy } from "../middleware/policy.js";
import { hasTable } from "../db/schemaGuards.js";
import { log } from "../services/logger.service.js";

const router = Router();
router.use(requireAuth);

const ALLOWED_LEVELS = new Set(["error", "warn", "info", "debug"]);
const MAX_LIMIT = 1000;

router.get(
  "/",
  routePolicy({ allow: ["admin", "manager"] }),
  async (req, res) => {
    if (!(await hasTable(pool, "server_logs"))) {
      res.json({ items: [], totals: { error: 0, warn: 0, info: 0, debug: 0 } });
      return;
    }
    const level = typeof req.query.level === "string" ? req.query.level : "";
    const source = typeof req.query.source === "string" ? req.query.source.trim() : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const since = typeof req.query.since === "string" ? req.query.since : "";
    const rawLimit = Number(req.query.limit ?? 250);
    const limit = Math.max(10, Math.min(Number.isFinite(rawLimit) ? rawLimit : 250, MAX_LIMIT));

    const where: string[] = [];
    const params: unknown[] = [];
    if (level && ALLOWED_LEVELS.has(level)) {
      where.push("level = ?");
      params.push(level);
    }
    if (source) {
      where.push("source = ?");
      params.push(source);
    }
    if (q) {
      where.push("(message LIKE ? OR stack LIKE ? OR category LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (since) {
      const d = new Date(since);
      if (!Number.isNaN(d.getTime())) {
        where.push("created_at >= ?");
        params.push(d.toISOString().slice(0, 19).replace("T", " "));
      }
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, created_at, level, source, category, message, stack, meta
       FROM server_logs
       ${whereSql}
       ORDER BY id DESC
       LIMIT ${limit}`,
      params
    );

    const [sources] = await pool.query<RowDataPacket[]>(
      `SELECT source, COUNT(*) AS n
       FROM server_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY source
       ORDER BY n DESC
       LIMIT 20`
    );

    const [totalsRows] = await pool.query<RowDataPacket[]>(
      `SELECT level, COUNT(*) AS n
       FROM server_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
       GROUP BY level`
    );
    const totals: Record<string, number> = { error: 0, warn: 0, info: 0, debug: 0 };
    for (const row of totalsRows) {
      totals[String(row.level)] = Number(row.n ?? 0);
    }

    res.json({
      items: rows.map((row) => ({
        id: Number(row.id),
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        level: String(row.level),
        source: String(row.source),
        category: row.category ? String(row.category) : null,
        message: String(row.message ?? ""),
        stack: row.stack ? String(row.stack) : null,
        meta: row.meta ?? null,
      })),
      totals,
      sources: sources.map((s) => ({ source: String(s.source), count: Number(s.n ?? 0) })),
    });
  }
);

router.delete(
  "/",
  routePolicy({ allow: ["admin"] }),
  async (req, res) => {
    if (!(await hasTable(pool, "server_logs"))) {
      res.json({ ok: true, deleted: 0 });
      return;
    }
    const scope = typeof req.query.scope === "string" ? req.query.scope : "all";
    if (scope === "older_than_7_days") {
      const [result] = await pool.execute(
        `DELETE FROM server_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
      );
      res.json({ ok: true, deleted: (result as { affectedRows?: number }).affectedRows ?? 0 });
      return;
    }
    const [result] = await pool.execute(`TRUNCATE TABLE server_logs`);
    log.info("server_logs truncated", { by: req.auth?.email }, "admin");
    res.json({ ok: true, deleted: (result as { affectedRows?: number }).affectedRows ?? 0 });
  }
);

export default router;
