import os from "os";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { getTableColumns, hasColumn, hasTable, invalidateColumnCache } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getBackupAlert } from "../services/backup.service.js";
import { getWhatsAppStatus } from "../services/whatsapp.service.js";
import { AccountingService } from "../services/accounting.service.js";
import { listRouterHealthSnapshots } from "../services/infrastructure/router-health-collector.service.js";
import { getServerHealthSnapshot } from "../services/infrastructure/server-health-collector.service.js";
import { listActiveAlerts } from "../services/infrastructure/infrastructure-alert-engine.service.js";
import type { RowDataPacket } from "mysql2";

function isMissingColumnError(e: unknown): boolean {
  const x = e as { code?: string; errno?: number };
  return x.code === "ER_BAD_FIELD_ERROR" || x.errno === 1054;
}

export type OperationalAlert = {
  severity: "critical" | "warning" | "info";
  code: string;
  meta?: { nas_offline?: number };
};

function freeradiusFreshMinutes(): number {
  const m = Number.parseInt(process.env.FREERADIUS_FRESH_MINUTES ?? "25", 10);
  return Number.isFinite(m) && m >= 3 && m <= 24 * 60 ? m : 25;
}

function freeradiusStaleHours(): number {
  const h = Number.parseInt(process.env.FREERADIUS_STALE_HOURS ?? "24", 10);
  return Number.isFinite(h) && h >= 1 && h <= 168 ? h : 24;
}

async function buildFreeradiusSnapshot(tenantId: string): Promise<{
  status: "ok" | "degraded" | "stale" | "unknown";
  open_sessions: number;
  last_accounting_at: string | null;
}> {
  if (!(await hasTable(pool, "radacct")) || !(await hasTable(pool, "subscribers"))) {
    return { status: "unknown", open_sessions: 0, last_accounting_at: null };
  }
  const hasAcctUpd = await hasColumn(pool, "radacct", "acctupdatetime");
  const maxTsExpr = hasAcctUpd ? "MAX(COALESCE(r.acctupdatetime, r.acctstarttime))" : "MAX(r.acctstarttime)";
  try {
    const [openRow] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c
       FROM radacct r
       INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
       WHERE r.acctstoptime IS NULL AND r.username <> ''`,
      [tenantId]
    );
    const open_sessions = Number(openRow[0]?.c ?? 0);
    const [lastRow] = await pool.query<RowDataPacket[]>(
      `SELECT ${maxTsExpr} AS last_ts
       FROM radacct r
       INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?`,
      [tenantId]
    );
    const raw = lastRow[0]?.last_ts as Date | string | null | undefined;
    const lastDt = raw == null ? null : raw instanceof Date ? raw : new Date(String(raw));
    const lastIso = lastDt && !Number.isNaN(lastDt.getTime()) ? lastDt.toISOString() : null;

    const freshMs = freeradiusFreshMinutes() * 60_000;
    const staleMs = freeradiusStaleHours() * 60 * 60_000;

    if (open_sessions > 0) {
      return { status: "ok", open_sessions, last_accounting_at: lastIso };
    }
    if (!lastIso) {
      return { status: "degraded", open_sessions: 0, last_accounting_at: null };
    }
    const age = Date.now() - new Date(lastIso).getTime();
    if (age <= freshMs) return { status: "ok", open_sessions: 0, last_accounting_at: lastIso };
    if (age <= staleMs) return { status: "degraded", open_sessions: 0, last_accounting_at: lastIso };
    return { status: "stale", open_sessions: 0, last_accounting_at: lastIso };
  } catch (e) {
    if (!isMissingColumnError(e)) console.warn("dashboard freeradius snapshot", e);
    return { status: "unknown", open_sessions: 0, last_accounting_at: null };
  }
}

function buildOperationalAlerts(
  nas: { total: number; online: number; offline: number },
  backup: { has_recent_failure: boolean },
  whatsapp: { enabled: boolean; connected: boolean; configured: boolean },
  freeradius: { status: string }
): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
  if (backup.has_recent_failure) alerts.push({ severity: "critical", code: "backup_failed" });
  if (whatsapp.enabled && !whatsapp.connected) {
    alerts.push({ severity: "warning", code: "whatsapp_unreachable" });
  }
  if (nas.total > 0 && nas.offline > 0) {
    alerts.push({ severity: "warning", code: "nas_offline", meta: { nas_offline: nas.offline } });
  }
  if (freeradius.status === "stale") {
    alerts.push({ severity: "warning", code: "radius_stale" });
  }
  return alerts;
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

const router = Router();
router.use(requireAuth);
router.use(requireRole("admin", "manager", "accountant", "viewer"));

router.get("/summary", async (req, res) => {
  const t = req.auth!.tenantId;
  let total_subscribers = 0;
  let active_subscribers = 0;
  let expired_subscribers = 0;
  let disabled_subscribers = 0;
  let online_users = 0;
  let total_bandwidth_bytes: string | number = 0;
  let bandwidth_today_bytes: string | number = 0;
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
    daily_backup_success: false,
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
        const [agg] = await pool.query<RowDataPacket[]>(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN LOWER(COALESCE(status, '')) = 'active' THEN 1 ELSE 0 END) AS active_cnt,
             SUM(CASE WHEN expiration_date IS NOT NULL AND expiration_date < NOW() THEN 1 ELSE 0 END) AS expired_cnt,
             SUM(
               CASE
                 WHEN LOWER(COALESCE(status, ''))
                   IN ('disabled', 'suspended', 'inactive', 'blocked')
                 THEN 1 ELSE 0
               END
             ) AS disabled_cnt
           FROM subscribers WHERE tenant_id = ?`,
          [t]
        );
        total_subscribers = Number(agg[0]?.total ?? 0);
        active_subscribers = Number(agg[0]?.active_cnt ?? 0);
        expired_subscribers = Number(agg[0]?.expired_cnt ?? 0);
        disabled_subscribers = Number(agg[0]?.disabled_cnt ?? 0);
      } catch (e) {
        if (!isMissingColumnError(e)) {
          console.warn("dashboard summary subscriber aggregates", e);
        }
        try {
          const [activeRow] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS c FROM subscribers WHERE tenant_id = ? AND status = 'active'`,
            [t]
          );
          active_subscribers = Number(activeRow[0]?.c ?? 0);
        } catch (e2) {
          if (!isMissingColumnError(e2)) console.warn("dashboard summary active_subscribers", e2);
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
          const [tot] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS c FROM subscribers WHERE tenant_id = ?`,
            [t]
          );
          total_subscribers = Number(tot[0]?.c ?? 0);
        } catch {
          total_subscribers = 0;
        }
        try {
          const [expiredRow] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS c FROM subscribers WHERE tenant_id = ? AND expiration_date < NOW()`,
            [t]
          );
          expired_subscribers = Number(expiredRow[0]?.c ?? 0);
        } catch (e3) {
          if (!isMissingColumnError(e3)) console.warn("dashboard summary expired_subscribers", e3);
          expired_subscribers = 0;
        }
        try {
          const [dis] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS c FROM subscribers WHERE tenant_id = ?
             AND LOWER(COALESCE(status, '')) IN ('disabled','suspended','inactive','blocked')`,
            [t]
          );
          disabled_subscribers = Number(dis[0]?.c ?? 0);
        } catch {
          disabled_subscribers = 0;
        }
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

    if (await hasTable(pool, "radacct") && (await hasTable(pool, "subscribers"))) {
      try {
        bandwidth_today_bytes = await accounting.getTenantBandwidthTodayBytes(t);
      } catch (e) {
        console.warn("dashboard summary bandwidth today (radacct)", e);
        bandwidth_today_bytes = 0;
      }
    } else if (await hasTable(pool, "user_usage_daily")) {
      try {
        const [bwDay] = await pool.query<RowDataPacket[]>(
          `SELECT COALESCE(SUM(total_bytes),0) AS b FROM user_usage_daily WHERE tenant_id = ? AND day = CURDATE()`,
          [t]
        );
        bandwidth_today_bytes = bwDay[0]?.b ?? 0;
      } catch (e) {
        console.warn("dashboard summary user_usage_daily today", e);
        bandwidth_today_bytes = 0;
      }
    }

    if (await hasTable(pool, "nas_devices")) {
      const nasCol = await getTableColumns(pool, "nas_devices");
      try {
        if (nasCol.has("status")) {
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total FROM nas_devices WHERE tenant_id = ? AND status = 'active'`,
            [t]
          );
          nas = { ...nas, total: Number(rows[0]?.total ?? 0) };
        } else {
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total FROM nas_devices WHERE tenant_id = ?`,
            [t]
          );
          nas = { ...nas, total: Number(rows[0]?.total ?? 0) };
        }
      } catch (e) {
        if (!isMissingColumnError(e)) console.warn("dashboard summary nas total", e);
        nas = { ...nas, total: 0 };
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
             FROM nas_devices WHERE ${whereNas}`,
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

    const freeradius = await buildFreeradiusSnapshot(t);
    const alerts = buildOperationalAlerts(nas, backup, whatsapp, freeradius);
    const host = await buildHostSnapshot();

    let monitoring = {
      routers_offline: 0,
      critical_alerts: 0,
      warning_alerts: 0,
      high_cpu_routers: 0,
      temperature_warnings: 0,
      low_voltage_routers: 0,
      latest_alerts: [] as RowDataPacket[],
      server_health_status: "unknown" as string,
    };
    try {
      const routers = await listRouterHealthSnapshots(pool, t);
      const infraAlerts = await listActiveAlerts(pool, t, 8);
      const server = await getServerHealthSnapshot(pool, t);
      const firing = infraAlerts.filter((a) => String(a.status) === "firing");
      monitoring = {
        routers_offline: routers.filter((r) => r.health_status === "offline" || !r.last_sync_ok).length,
        critical_alerts: firing.filter((a) => String(a.severity) === "critical").length,
        warning_alerts: firing.filter((a) => String(a.severity) === "warning").length,
        high_cpu_routers: routers.filter((r) => r.cpu_percent != null && r.cpu_percent >= 80).length,
        temperature_warnings: routers.filter(
          (r) => r.board_temperature_c != null && r.board_temperature_c >= 65
        ).length,
        low_voltage_routers: routers.filter(
          (r) => r.voltage_supported && r.voltage_v != null && r.voltage_v < 12
        ).length,
        latest_alerts: infraAlerts,
        server_health_status: server?.health_status ?? "unknown",
      };
    } catch (e) {
      console.warn("dashboard monitoring snapshot", e);
    }

    res.json({
      total_subscribers,
      active_subscribers,
      expired_subscribers,
      disabled_subscribers,
      online_users,
      total_bandwidth_bytes,
      bandwidth_today_bytes,
      nas,
      freeradius,
      alerts,
      backup,
      whatsapp,
      host,
      monitoring,
    });
  } catch (e) {
    console.error("dashboard /summary fatal", e);
    res.json({
      total_subscribers: 0,
      active_subscribers: 0,
      expired_subscribers: 0,
      disabled_subscribers: 0,
      online_users: 0,
      total_bandwidth_bytes: 0,
      bandwidth_today_bytes: 0,
      nas: { total: 0, online: 0, offline: 0 },
      freeradius: { status: "unknown", open_sessions: 0, last_accounting_at: null },
      alerts: [],
      backup: {
        last_status: "none",
        last_success_at: null,
        last_failed_at: null,
        last_error: null,
        has_recent_failure: false,
        rclone_enabled: false,
        rclone_connected: false,
        rclone_last_error: null,
        daily_backup_success: false,
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
      monitoring: {
        routers_offline: 0,
        critical_alerts: 0,
        warning_alerts: 0,
        high_cpu_routers: 0,
        temperature_warnings: 0,
        low_voltage_routers: 0,
        latest_alerts: [],
        server_health_status: "unknown",
      },
      host: {
        hostname: "unknown",
        platform: "unknown",
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
  if (await hasTable(pool, "subscribers")) {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(created_at, '%Y-%m') AS period, COUNT(*) AS total
         FROM subscribers WHERE tenant_id = ?
         GROUP BY period ORDER BY period DESC LIMIT 24`,
        [t]
      );
      res.json({ items: rows.reverse() });
      return;
    } catch (e) {
      console.warn("dashboard charts/subscribers", e);
    }
  }
  res.json({ items: [] });
});

router.get("/nas-sessions", async (req, res) => {
  const t = req.auth!.tenantId;
  if (await hasTable(pool, "nas_devices")) {
    try {
      const col = await getTableColumns(pool, "nas_devices");
      const want = ["id", "name", "ip", "online_status", "session_count", "last_check_at"];
      const sel = want.filter((c) => col.has(c.toLowerCase()));
      if (sel.length === 0) {
        res.json({ items: [] });
        return;
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${sel.join(", ")} FROM nas_devices WHERE tenant_id = ? ORDER BY name`,
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
      return;
    } catch (e) {
      console.warn("dashboard nas-sessions nas_devices", e);
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
      console.warn("dashboard nas-sessions radacct", e);
    }
  }
  res.json({ items: [] });
});

export default router;
