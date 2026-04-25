import { Router } from "express";
import { pool } from "../db/pool.js";
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
  const tenant = req.auth!.tenantId;
  const sessions = await acct.listOnlineSessions(tenant, u);
  const count = await acct.countActiveSessions(tenant, u);
  res.json({ count, sessions });
});

router.get("/summary", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const tenant = req.auth!.tenantId;
  const active_sessions = await acct.countActiveSessions(tenant);
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
