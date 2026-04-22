import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { denyAccountant, denyViewerWrites } from "../middleware/capabilities.js";
import { AccountingService } from "../services/accounting.service.js";
import { requestHasManagerPermission } from "../lib/manager-permissions.js";
import { enqueueCoaDisconnect, waitForJobResult } from "../services/task-queue.service.js";
import type { DisconnectResult } from "../services/coa.service.js";

const router = Router();
const accounting = new AccountingService(pool);

router.use(requireAuth);

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.max(0, Math.trunc(value)));
  if (typeof value === "string" && value.trim()) {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function normalizeSeconds(value: unknown, startTime: unknown): number {
  const direct = Number(value ?? 0);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  const start = new Date(String(startTime ?? ""));
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
}

router.get("/", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const limitRaw = Number.parseInt(String(req.query.limit ?? "300"), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 300;
  try {
    const sessions = await accounting.listOnlineSessions(undefined, limit);
    if (sessions.length === 0) {
      res.json({ count: 0, sessions: [] });
      return;
    }

    let allowed = new Set<string>();
    if (await hasTable(pool, "subscribers")) {
      const usernames = Array.from(new Set(sessions.map((s) => String(s.username ?? "")).filter(Boolean)));
      if (usernames.length > 0) {
        const placeholders = usernames.map(() => "?").join(",");
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT username FROM subscribers WHERE tenant_id = ? AND username IN (${placeholders})`,
          [req.auth!.tenantId, ...usernames]
        );
        allowed = new Set(rows.map((r) => String(r.username ?? "")));
      }
    }

    const filtered = allowed.size > 0 ? sessions.filter((s) => allowed.has(String(s.username ?? ""))) : sessions;
    const mapped = filtered.map((s) => {
      const inOctets = toBigInt(s.acctinputoctets);
      const outOctets = toBigInt(s.acctoutputoctets);
      return {
        radacctid: String(s.radacctid ?? ""),
        username: String(s.username ?? ""),
        nasipaddress: String(s.nasipaddress ?? ""),
        framedipaddress: String(s.framedipaddress ?? ""),
        callingstationid: String(s.callingstationid ?? ""),
        acctstarttime: s.acctstarttime ? String(s.acctstarttime) : null,
        duration_seconds: normalizeSeconds(s.acctsessiontime, s.acctstarttime),
        session_bytes: (inOctets + outOctets).toString(),
      };
    });

    res.json({ count: mapped.length, sessions: mapped });
  } catch (e) {
    console.error("online users list", e);
    res.status(500).json({ error: "online_users_failed" });
  }
});

router.post(
  "/:radacctid/disconnect",
  requireRole("admin", "manager"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    if (req.auth!.role === "manager" && !requestHasManagerPermission(req, "disconnect_users")) {
      res.status(403).json({ error: "forbidden", detail: "missing_manager_permission" });
      return;
    }
    const radacctid = String(req.params.radacctid ?? "").trim();
    if (!radacctid) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT username, nasipaddress, acctsessionid
         FROM radacct
         WHERE radacctid = ? AND acctstoptime IS NULL
         LIMIT 1`,
        [radacctid]
      );
      const row = rows[0];
      if (!row) {
        res.status(404).json({ error: "session_not_found" });
        return;
      }

      if (await hasTable(pool, "subscribers")) {
        const [owned] = await pool.query<RowDataPacket[]>(
          `SELECT id
           FROM subscribers
           WHERE tenant_id = ? AND username = ?
           LIMIT 1`,
          [req.auth!.tenantId, String(row.username ?? "")]
        );
        if (!owned[0]) {
          res.status(404).json({ error: "session_not_found" });
          return;
        }
      }

      const job = await enqueueCoaDisconnect({
        tenantId: req.auth!.tenantId,
        username: String(row.username ?? ""),
        nasIp: String(row.nasipaddress ?? ""),
        acctSessionId: row.acctsessionid ? String(row.acctsessionid) : undefined,
      });
      const result = await waitForJobResult<DisconnectResult>(job, 8000);
      if (!result) {
        res.status(202).json({ ok: true, queued: true, job_id: String(job.id ?? "") });
        return;
      }
      res.json({ ok: result.ok, queued: false, result });
    } catch (e) {
      console.error("online users disconnect", e);
      res.status(500).json({ error: "online_user_disconnect_failed" });
    }
  }
);

export default router;
