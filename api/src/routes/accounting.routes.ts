import { Router } from "express";
import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { AccountingService } from "../services/accounting.service.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const acct = new AccountingService(pool);

router.use(requireAuth);

router.get("/usage/:username", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const row = await acct.getUsageForUser(req.auth!.tenantId, req.params.username);
  res.json({ username: req.params.username, usage: row });
});

router.get("/sessions", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const u = typeof req.query.username === "string" ? req.query.username : undefined;
  const sessions = await acct.listOnlineSessions(u);
  const count = await acct.countActiveSessions(u);
  res.json({ count, sessions });
});

router.get("/summary", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const tenant = req.auth!.tenantId;
  let active_sessions = 0;
  if (await hasTable(pool, "radacct")) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS active_sessions FROM radacct WHERE acctstoptime IS NULL`
    );
    active_sessions = Number(rows[0]?.active_sessions ?? 0);
  }
  const [bytes] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(total_bytes),0) AS tracked_bytes FROM user_usage_live WHERE tenant_id = ?`,
    [tenant]
  );
  res.json({
    active_sessions,
    tracked_bytes_total: bytes[0]?.tracked_bytes ?? 0,
  });
});

export default router;
