import os from "os";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { getTableColumns, hasTable, invalidateColumnCache } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getBackupAlert } from "../services/backup.service.js";
import { getWhatsAppStatus } from "../services/whatsapp.service.js";
import type { RowDataPacket } from "mysql2";

function isMissingColumnError(e: unknown): boolean {
  const x = e as { code?: string; errno?: number };
  return x.code === "ER_BAD_FIELD_ERROR" || x.errno === 1054;
}

const router = Router();
router.use(requireAuth);
router.use(requireRole("admin", "manager", "accountant", "viewer"));

router.get("/summary", async (req, res) => {
  const t = req.auth!.tenantId;
  let active_subscribers = 0;
  let expired_subscribers = 0;
  let online_users = 0;
  let total_bandwidth_bytes: string | number = 0;
  let nas = { total: 0, online: 0, offline: 0 };
  let backup = {
    last_status: "none" as "running" | "success" | "failed" | "none",
    last_success_at: null as string | null,
    last_failed_at: null as string | null,
    last_error: null as string | null,
    has_recent_failure: false,
    rclone_enabled: false,
    rclone_connected: false,
    rclone_last_error: null as string | null,
    daily_backup_uploaded: false,
    daily_backup_at: null as string | null,
  };
  let whatsapp = {
    enabled: false,
    configured: false,
    connected: false,
    reminder_days: 5,
    auto_send_new: true,
    last_error: null as string | null,
    last_check_at: null as string | null,
  };

  try {
    if (await hasTable(pool, "subscribers")) {
      try {
        const [activeRow] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS c FROM subscribers WHERE tenant_id = ? AND status = 'active'`,
          [t]
        );
        active_subscribers = Number(activeRow[0]?.c ?? 0);
      } catch (e) {
        if (!isMissingColumnError(e)) console.warn("dashboard summary active_subscribers", e);
        try {
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS c FROM subscribers WHERE tenant_id = ?`,
            [t]
          );
          active_subscribers = Number(rows[0]?.c ?? 0);
        } catch {
          active_subscribers = 0;
        }
      }
      try {
        const [expiredRow] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS c FROM subscribers WHERE tenant_id = ? AND expiration_date < NOW()`,
          [t]
        );
        expired_subscribers = Number(expiredRow[0]?.c ?? 0);
      } catch (e) {
        if (!isMissingColumnError(e)) console.warn("dashboard summary expired_subscribers", e);
        expired_subscribers = 0;
      }
    }

    if (await hasTable(pool, "radacct") && (await hasTable(pool, "subscribers"))) {
      try {
        const [o] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(DISTINCT r.username) AS c
           FROM radacct r
           INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
           WHERE r.acctstoptime IS NULL AND r.username <> ''`,
          [t]
        );
        online_users = Number(o[0]?.c ?? 0);
      } catch (e) {
        if (!isMissingColumnError(e)) console.warn("dashboard summary online_users", e);
        online_users = 0;
      }
    } else if (await hasTable(pool, "radacct")) {
      try {
        const [o] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(DISTINCT username) AS c FROM radacct WHERE acctstoptime IS NULL AND username <> ''`
        );
        online_users = Number(o[0]?.c ?? 0);
      } catch (e) {
        if (!isMissingColumnError(e)) console.warn("dashboard summary online_users", e);
        online_users = 0;
      }
    }

    if (await hasTable(pool, "user_usage_live")) {
      try {
        const [bw] = await pool.query<RowDataPacket[]>(
          `SELECT COALESCE(SUM(total_bytes),0) AS b FROM user_usage_live WHERE tenant_id = ?`,
          [t]
        );
        total_bandwidth_bytes = bw[0]?.b ?? 0;
      } catch (e) {
        console.warn("dashboard summary user_usage_live", e);
        total_bandwidth_bytes = 0;
      }
    }

    if (await hasTable(pool, "nas_servers")) {
      const nasCol = await getTableColumns(pool, "nas_servers");
      try {
        if (nasCol.has("status")) {
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total FROM nas_servers WHERE tenant_id = ? AND status = 'active'`,
            [t]
          );
          nas = { ...nas, total: Number(rows[0]?.total ?? 0) };
        } else {
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total FROM nas_servers WHERE tenant_id = ?`,
            [t]
          );
          nas = { ...nas, total: Number(rows[0]?.total ?? 0) };
        }
      } catch (e) {
        if (!isMissingColumnError(e)) console.warn("dashboard summary nas total", e);
        try {
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total FROM nas_servers WHERE tenant_id = ?`,
            [t]
          );
          nas = { ...nas, total: Number(rows[0]?.total ?? 0) };
        } catch {
          nas = { ...nas, total: 0 };
        }
      }
      if (nasCol.has("online_status")) {
        try {
          const whereNas = nasCol.has("status")
            ? `tenant_id = ? AND status = 'active'`
            : `tenant_id = ?`;
          const [st] = await pool.query<RowDataPacket[]>(
            `SELECT
               SUM(CASE WHEN online_status = 'online' THEN 1 ELSE 0 END) AS online,
               SUM(CASE WHEN online_status = 'offline' THEN 1 ELSE 0 END) AS offline
             FROM nas_servers WHERE ${whereNas}`,
            [t]
          );
          nas = {
            total: nas.total,
            online: Number(st[0]?.online ?? 0),
            offline: Number(st[0]?.offline ?? 0),
          };
        } catch (e) {
          if (!isMissingColumnError(e)) console.warn("dashboard summary nas online/offline", e);
          invalidateColumnCache();
        }
      }
    }

    try {
      backup = await getBackupAlert(t);
    } catch (e) {
      console.warn("dashboard summary backup alert", e);
    }
    try {
      whatsapp = await getWhatsAppStatus(t);
    } catch (e) {
      console.warn("dashboard summary whatsapp status", e);
    }

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem > freeMem ? totalMem - freeMem : 0;
    const host = {
      hostname: os.hostname(),
      platform: os.platform(),
      uptime_seconds: Math.floor(os.uptime()),
      load_avg_1m: os.loadavg()[0] ?? 0,
      cpu_count: os.cpus().length,
      memory_total_bytes: totalMem,
      memory_used_bytes: usedMem,
      memory_used_percent: totalMem > 0 ? Math.round((usedMem / totalMem) * 1000) / 10 : 0,
    };

    res.json({
      active_subscribers,
      expired_subscribers,
      online_users,
      total_bandwidth_bytes,
      nas,
      backup,
      whatsapp,
      host,
    });
  } catch (e) {
    console.error("dashboard /summary fatal", e);
    res.json({
      active_subscribers: 0,
      expired_subscribers: 0,
      online_users: 0,
      total_bandwidth_bytes: 0,
      nas: { total: 0, online: 0, offline: 0 },
      backup: {
        last_status: "none",
        last_success_at: null,
        last_failed_at: null,
        last_error: null,
        has_recent_failure: false,
        rclone_enabled: false,
        rclone_connected: false,
        rclone_last_error: null,
        daily_backup_uploaded: false,
        daily_backup_at: null,
      },
      whatsapp: {
        enabled: false,
        configured: false,
        connected: false,
        reminder_days: 5,
        auto_send_new: true,
        last_error: null,
        last_check_at: null,
      },
      host: {
        hostname: "—",
        platform: "—",
        uptime_seconds: 0,
        load_avg_1m: 0,
        cpu_count: 0,
        memory_total_bytes: 0,
        memory_used_bytes: 0,
        memory_used_percent: 0,
      },
    });
  }
});

router.get("/charts/revenue", async (req, res) => {
  const t = req.auth!.tenantId;
  if (!(await hasTable(pool, "payments"))) {
    res.json({ items: [] });
    return;
  }
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(paid_at, '%Y-%m') AS period, SUM(amount) AS total
       FROM payments WHERE tenant_id = ?
       GROUP BY period ORDER BY period DESC LIMIT 24`,
      [t]
    );
    res.json({ items: rows.reverse() });
  } catch (e) {
    console.warn("dashboard charts/revenue", e);
    res.json({ items: [] });
  }
});

router.get("/charts/subscribers", async (req, res) => {
  const t = req.auth!.tenantId;
  if (!(await hasTable(pool, "subscribers"))) {
    res.json({ items: [] });
    return;
  }
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS period, COUNT(*) AS total
       FROM subscribers WHERE tenant_id = ?
       GROUP BY period ORDER BY period DESC LIMIT 24`,
      [t]
    );
    res.json({ items: rows.reverse() });
  } catch (e) {
    console.warn("dashboard charts/subscribers", e);
    res.json({ items: [] });
  }
});

router.get("/nas-sessions", async (req, res) => {
  const t = req.auth!.tenantId;
  if (!(await hasTable(pool, "nas_servers"))) {
    res.json({ items: [] });
    return;
  }
  try {
    const col = await getTableColumns(pool, "nas_servers");
    const want = ["id", "name", "ip", "online_status", "session_count", "last_check_at"];
    const sel = want.filter((c) => col.has(c.toLowerCase()));
    if (sel.length === 0) {
      res.json({ items: [] });
      return;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ${sel.join(", ")} FROM nas_servers WHERE tenant_id = ? ORDER BY name`,
      [t]
    );
    const items = (rows as RowDataPacket[]).map((r) => {
      const row = { ...r } as Record<string, unknown>;
      if (!col.has("online_status")) row.online_status = "unknown";
      if (!col.has("session_count")) row.session_count = 0;
      if (!col.has("last_check_at")) row.last_check_at = null;
      return row;
    });
    res.json({ items });
  } catch (e) {
    console.warn("dashboard nas-sessions", e);
    invalidateColumnCache();
    res.json({ items: [] });
  }
});

export default router;
