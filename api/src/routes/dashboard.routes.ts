import os from "os";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { getTableColumns, hasTable, invalidateColumnCache } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getBackupAlert } from "../services/backup.service.js";
import { getWhatsAppStatus } from "../services/whatsapp.service.js";
import { AccountingService } from "../services/accounting.service.js";
import { config } from "../config.js";
import { radacctSessionOctetsExpr } from "../lib/radacct-octets.js";
import type { RowDataPacket } from "mysql2";

function isMissingColumnError(e: unknown): boolean {
  const x = e as { code?: string; errno?: number };
  return x.code === "ER_BAD_FIELD_ERROR" || x.errno === 1054;
}

async function buildHostSnapshot() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem > freeMem ? totalMem - freeMem : 0;
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    uptime_seconds: Math.floor(os.uptime()),
    load_avg_1m: os.loadavg()[0] ?? 0,
    cpu_count: os.cpus().length,
    memory_total_bytes: totalMem,
    memory_used_bytes: usedMem,
    memory_used_percent: totalMem > 0 ? Math.round((usedMem / totalMem) * 1000) / 10 : 0,
  };
}

const accounting = new AccountingService(pool);

async function dmaResolveTotalBandwidthBytes(): Promise<string | number> {
  if (await hasTable(pool, "rm_cumulate")) {
    try {
      const col = await getTableColumns(pool, "rm_cumulate");
      if (col.has("dlbytes") && col.has("ulbytes")) {
        const [bw] = await pool.query<RowDataPacket[]>(
          `SELECT COALESCE(SUM(COALESCE(dlbytes,0) + COALESCE(ulbytes,0)), 0) AS b FROM rm_cumulate`
        );
        const n = Number(bw[0]?.b ?? 0);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch (e) {
      console.warn("dashboard dma bandwidth rm_cumulate", e);
    }
  }
  if (await hasTable(pool, "rm_dailyacct")) {
    try {
      const [bw] = await pool.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(COALESCE(dlbytes,0) + COALESCE(ulbytes,0)), 0) AS b FROM rm_dailyacct`
      );
      const n = Number(bw[0]?.b ?? 0);
      if (Number.isFinite(n) && n > 0) return n;
    } catch (e) {
      console.warn("dashboard dma bandwidth rm_dailyacct", e);
    }
  }
  if (await hasTable(pool, "radacct")) {
    try {
      const expr = await radacctSessionOctetsExpr(pool);
      const [bw] = await pool.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(session_bytes), 0) AS b
         FROM (
           SELECT MAX(${expr}) AS session_bytes
           FROM radacct
           WHERE TRIM(username) <> ''
           GROUP BY radacctid
         ) t`
      );
      return Number(bw[0]?.b ?? 0);
    } catch (e) {
      console.warn("dashboard dma bandwidth radacct", e);
    }
  }
  return 0;
}

async function dmaResolveTrackedSessionCount(tenantId: string): Promise<number> {
  try {
    // Keep this card aligned with the "online now" freshness rules
    // so stale restored rows are not shown as active sessions.
    return await accounting.countActiveSessions(tenantId);
  } catch (e) {
    console.warn("dashboard dma tracked sessions", e);
    return 0;
  }
}

/** DMA_MODE: read only Radius Manager tables (rm_*, rad*, nas). */
async function buildDmaDashboardSummary(tenantId: string) {
  let total_rm_users = 0;
  let active_subscribers = 0;
  let expired_subscribers = 0;
  let online_users = 0;
  let total_bandwidth_bytes: string | number = 0;
  let dma_conntrack_rows = 0;
  let nas = { total: 0, online: 0, offline: 0 };

  if (await hasTable(pool, "rm_users")) {
    try {
      const [tu] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM rm_users WHERE TRIM(username) <> ''`
      );
      total_rm_users = Number(tu[0]?.c ?? 0);
      const [ac] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM rm_users
         WHERE TRIM(username) <> '' AND COALESCE(enableuser, 0) = 1`
      );
      active_subscribers = Number(ac[0]?.c ?? 0);
      const [ex] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM rm_users
         WHERE TRIM(username) <> '' AND expiration IS NOT NULL AND expiration < NOW()`
      );
      expired_subscribers = Number(ex[0]?.c ?? 0);
    } catch (e) {
      if (!isMissingColumnError(e)) console.warn("dashboard dma rm_users", e);
    }
  }

  try {
    online_users = await accounting.countActiveUsernames(tenantId);
  } catch (e) {
    if (!isMissingColumnError(e)) console.warn("dashboard dma online_users", e);
  }

  total_bandwidth_bytes = await dmaResolveTotalBandwidthBytes();
  dma_conntrack_rows = await dmaResolveTrackedSessionCount(tenantId);

  if (await hasTable(pool, "nas")) {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM nas`);
      const n = Number(rows[0]?.total ?? 0);
      nas = { total: n, online: 0, offline: n };
    } catch (e) {
      if (!isMissingColumnError(e)) console.warn("dashboard dma nas", e);
    }
  }

  let backup: {
    last_status: "running" | "success" | "failed" | "none";
    last_success_at: string | null;
    last_failed_at: string | null;
    last_error: string | null;
    has_recent_failure: boolean;
    rclone_enabled: boolean;
    rclone_connected: boolean;
    rclone_last_error: string | null;
    daily_backup_uploaded: boolean;
    daily_backup_at: string | null;
  } = {
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
    backup = await getBackupAlert(tenantId);
  } catch (e) {
    console.warn("dashboard dma backup", e);
  }
  try {
    whatsapp = await getWhatsAppStatus(tenantId);
  } catch (e) {
    console.warn("dashboard dma whatsapp", e);
  }

  const host = await buildHostSnapshot();

  return {
    dma_mode: true,
    total_rm_users,
    dma_conntrack_rows,
    active_subscribers,
    expired_subscribers,
    online_users,
    total_bandwidth_bytes,
    nas,
    backup,
    whatsapp,
    host,
  };
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
    if (config.dmaMode) {
      res.json(await buildDmaDashboardSummary(t));
      return;
    }

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
    } else if (await hasTable(pool, "rm_users")) {
      try {
        const [activeRow] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS c FROM rm_users WHERE TRIM(username) <> '' AND COALESCE(enableuser, 0) = 1`
        );
        active_subscribers = Number(activeRow[0]?.c ?? 0);
        const [expiredRow] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS c FROM rm_users
           WHERE TRIM(username) <> '' AND expiration IS NOT NULL AND expiration < NOW()`
        );
        expired_subscribers = Number(expiredRow[0]?.c ?? 0);
      } catch (e) {
        if (!isMissingColumnError(e)) console.warn("dashboard summary rm_users counts", e);
      }
    }

    /** After SQL restore, `subscribers` may be empty while DMA tables are full — show rm_users counts. */
    if ((await hasTable(pool, "subscribers")) && (await hasTable(pool, "rm_users"))) {
      try {
        const [totSub] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS c FROM subscribers WHERE tenant_id = ?`,
          [t]
        );
        if (Number(totSub[0]?.c ?? 0) === 0) {
          const [a] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS c FROM rm_users WHERE TRIM(username) <> '' AND COALESCE(enableuser, 0) = 1`
          );
          active_subscribers = Number(a[0]?.c ?? 0);
          const [ex] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS c FROM rm_users
             WHERE TRIM(username) <> '' AND expiration IS NOT NULL AND expiration < NOW()`
          );
          expired_subscribers = Number(ex[0]?.c ?? 0);
        }
      } catch (e) {
        if (!isMissingColumnError(e)) console.warn("dashboard summary dma_rm_users_fallback", e);
      }
    }

    try {
      online_users = await accounting.countActiveUsernames(t);
    } catch (e) {
      if (!isMissingColumnError(e)) console.warn("dashboard summary online_users", e);
      online_users = 0;
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
    } else if (await hasTable(pool, "nas")) {
      try {
        const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM nas`);
        nas = { total: Number(rows[0]?.total ?? 0), online: 0, offline: Number(rows[0]?.total ?? 0) };
      } catch (e) {
        if (!isMissingColumnError(e)) console.warn("dashboard summary nas table", e);
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

    const host = await buildHostSnapshot();

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
  if (config.dmaMode) {
    if (await hasTable(pool, "rm_users")) {
      try {
        const col = await getTableColumns(pool, "rm_users");
        if (col.has("createdon")) {
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT DATE_FORMAT(createdon, '%Y-%m') AS period, COUNT(*) AS total
             FROM rm_users WHERE TRIM(username) <> ''
             GROUP BY DATE_FORMAT(createdon, '%Y-%m') ORDER BY period DESC LIMIT 24`
          );
          res.json({ items: rows.reverse() });
          return;
        }
      } catch (e) {
        console.warn("dashboard charts/subscribers dma rm_users", e);
      }
    }
    res.json({ items: [] });
    return;
  }
  if (await hasTable(pool, "subscribers")) {
    try {
      const [cnt] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM subscribers WHERE tenant_id = ?`,
        [t]
      );
      if (Number(cnt[0]?.c ?? 0) > 0) {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT DATE_FORMAT(created_at, '%Y-%m') AS period, COUNT(*) AS total
           FROM subscribers WHERE tenant_id = ?
           GROUP BY period ORDER BY period DESC LIMIT 24`,
          [t]
        );
        res.json({ items: rows.reverse() });
        return;
      }
    } catch (e) {
      console.warn("dashboard charts/subscribers subscribers", e);
    }
  }
  if (await hasTable(pool, "rm_users")) {
    try {
      const col = await getTableColumns(pool, "rm_users");
      if (col.has("createdon")) {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT DATE_FORMAT(createdon, '%Y-%m') AS period, COUNT(*) AS total
           FROM rm_users WHERE TRIM(username) <> ''
           GROUP BY DATE_FORMAT(createdon, '%Y-%m') ORDER BY period DESC LIMIT 24`
        );
        res.json({ items: rows.reverse() });
        return;
      }
    } catch (e) {
      console.warn("dashboard charts/subscribers rm_users", e);
    }
  }
  res.json({ items: [] });
});

router.get("/nas-sessions", async (req, res) => {
  const t = req.auth!.tenantId;
  if (config.dmaMode) {
    if (await hasTable(pool, "rm_conntrack")) {
      try {
        const col = await getTableColumns(pool, "rm_conntrack");
        const nasKey = (["nasipaddress", "nasip", "nas"] as const).find((k) => col.has(k));
        if (nasKey) {
          const q = `SELECT \`${nasKey}\` AS ip, COUNT(*) AS session_count
             FROM rm_conntrack GROUP BY \`${nasKey}\` ORDER BY session_count DESC LIMIT 64`;
          const [rows] = await pool.query<RowDataPacket[]>(q);
          res.json({
            items: (rows as RowDataPacket[]).map((r, i) => ({
              id: i,
              name: String(r.ip ?? ""),
              ip: r.ip,
              online_status: "online",
              session_count: Number(r.session_count ?? 0),
              last_check_at: null,
            })),
          });
          return;
        }
      } catch (e) {
        console.warn("dashboard nas-sessions dma rm_conntrack", e);
        invalidateColumnCache();
      }
    }
    if (await hasTable(pool, "radacct")) {
      try {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT nasipaddress AS ip, COUNT(*) AS session_count
           FROM radacct WHERE acctstoptime IS NULL AND nasipaddress <> ''
           GROUP BY nasipaddress ORDER BY session_count DESC LIMIT 64`
        );
        res.json({
          items: (rows as RowDataPacket[]).map((r, i) => ({
            id: i,
            name: String(r.ip ?? ""),
            ip: r.ip,
            online_status: "online",
            session_count: Number(r.session_count ?? 0),
            last_check_at: null,
          })),
        });
        return;
      } catch (e) {
        console.warn("dashboard nas-sessions dma radacct", e);
      }
    }
    res.json({ items: [] });
    return;
  }
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
