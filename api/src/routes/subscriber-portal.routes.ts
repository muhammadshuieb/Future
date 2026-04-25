import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { requireSubscriberAuth } from "../middleware/subscriber-auth.js";
import type { SubscriberJwtPayload } from "../middleware/subscriber-auth.js";
import { encryptSecret } from "../services/crypto.service.js";
import { RadiusService } from "../services/radius.service.js";
import { getSystemSettings } from "../services/system-settings.service.js";
import { hasTable } from "../db/schemaGuards.js";
import type { RowDataPacket } from "mysql2";
import { loginRateLimiter } from "../middleware/rate-limit.js";
import { importSubscribersFromDma } from "../dma/importSubscribersFromDma.js";
import { verifyLegacySubscriberPassword } from "../dma/legacyPassword.js";

const router = Router();
const radius = new RadiusService(pool);

function normalizePhoneDigits(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

function toSafeBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.max(0, Math.trunc(v)));
  if (typeof v === "string" && v.trim()) {
    try {
      return BigInt(v.trim());
    } catch {
      return 0n;
    }
  }
  return 0n;
}

router.get("/public-config", async (_req, res) => {
  try {
    const s = await getSystemSettings(config.defaultTenantId);
    res.json({
      accountant_phone: s.accountant_contact_phone,
      license_note: s.subscription_license_note,
    });
  } catch (e) {
    console.error("public-config", e);
    res.json({ accountant_phone: "", license_note: "" });
  }
});

const publicLookupBody = z.object({
  phone: z.string().min(4).max(32),
});

router.post("/public-lookup", async (req, res) => {
  const parsed = publicLookupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const tenantId = config.defaultTenantId;
  const digits = normalizePhoneDigits(parsed.data.phone);
  if (digits.length < 6) {
    res.status(400).json({ error: "phone_too_short" });
    return;
  }
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.username, s.status, s.start_date, s.expiration_date, s.used_bytes,
              s.first_name, s.last_name, s.nickname, s.phone,
              r.name AS region_name,
              p.name AS package_name, p.mikrotik_rate_limit, p.quota_total_bytes
       FROM subscribers s
       LEFT JOIN packages p ON p.id = s.package_id
       LEFT JOIN subscriber_regions r ON r.id = s.region_id
       WHERE s.tenant_id = ?
         AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(s.phone,''),' ',''),'-',''),'+',''),'(','') = ?
       LIMIT 2`,
      [tenantId, digits]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (rows.length > 1) {
      res.status(409).json({ error: "ambiguous_phone" });
      return;
    }
    const row = rows[0];
    const username = String(row.username ?? "");
    const quota = toSafeBigInt(row.quota_total_bytes);
    const used = toSafeBigInt(row.used_bytes);
    const remaining = quota > 0n ? (used >= quota ? 0n : quota - used) : null;

    let daily = { total_bytes: "0", download_bytes: "0", upload_bytes: "0" };
    let monthly = { total_bytes: "0", download_bytes: "0", upload_bytes: "0" };
    let yearly = { total_bytes: "0", download_bytes: "0", upload_bytes: "0" };
    let reports: {
      daily: { period: string; sessions_count: number; total_bytes: string }[];
      monthly: { period: string; sessions_count: number; total_bytes: string }[];
      yearly: { period: string; sessions_count: number; total_bytes: string }[];
    } = { daily: [], monthly: [], yearly: [] };
    if (await hasTable(pool, "radacct")) {
      const sumBytes = (field: "acctinputoctets" | "acctoutputoctets") => `SUM(COALESCE(${field},0))`;
      const [dRes, mRes, yRes, drRes, mrRes, yrRes] = await Promise.all([
        pool.query<RowDataPacket[]>(
          `SELECT ${sumBytes("acctinputoctets")} AS d, ${sumBytes("acctoutputoctets")} AS u
           FROM radacct WHERE username = ? AND DATE(acctstarttime) = CURDATE()`,
          [username]
        ),
        pool.query<RowDataPacket[]>(
          `SELECT ${sumBytes("acctinputoctets")} AS d, ${sumBytes("acctoutputoctets")} AS u
           FROM radacct
           WHERE username = ?
             AND YEAR(acctstarttime) = YEAR(CURDATE())
             AND MONTH(acctstarttime) = MONTH(CURDATE())`,
          [username]
        ),
        pool.query<RowDataPacket[]>(
          `SELECT ${sumBytes("acctinputoctets")} AS d, ${sumBytes("acctoutputoctets")} AS u
           FROM radacct WHERE username = ? AND YEAR(acctstarttime) = YEAR(CURDATE())`,
          [username]
        ),
        pool.query<RowDataPacket[]>(
          `SELECT DATE(acctstarttime) AS period,
                  COUNT(*) AS sessions_count,
                  SUM(COALESCE(acctinputoctets,0)+COALESCE(acctoutputoctets,0)) AS total_bytes
           FROM radacct
           WHERE username = ?
           GROUP BY DATE(acctstarttime)
           ORDER BY period DESC
           LIMIT 30`,
          [username]
        ),
        pool.query<RowDataPacket[]>(
          `SELECT DATE_FORMAT(acctstarttime, '%Y-%m') AS period,
                  COUNT(*) AS sessions_count,
                  SUM(COALESCE(acctinputoctets,0)+COALESCE(acctoutputoctets,0)) AS total_bytes
           FROM radacct
           WHERE username = ?
           GROUP BY DATE_FORMAT(acctstarttime, '%Y-%m')
           ORDER BY period DESC
           LIMIT 12`,
          [username]
        ),
        pool.query<RowDataPacket[]>(
          `SELECT DATE_FORMAT(acctstarttime, '%Y') AS period,
                  COUNT(*) AS sessions_count,
                  SUM(COALESCE(acctinputoctets,0)+COALESCE(acctoutputoctets,0)) AS total_bytes
           FROM radacct
           WHERE username = ?
           GROUP BY DATE_FORMAT(acctstarttime, '%Y')
           ORDER BY period DESC
           LIMIT 5`,
          [username]
        ),
      ]);
      const pack = (r: RowDataPacket | undefined) => {
        const down = toSafeBigInt(r?.d);
        const up = toSafeBigInt(r?.u);
        const total = down + up;
        return {
          download_bytes: down.toString(),
          upload_bytes: up.toString(),
          total_bytes: total.toString(),
        };
      };
      const dRows = dRes[0] as RowDataPacket[];
      const mRows = mRes[0] as RowDataPacket[];
      const yRows = yRes[0] as RowDataPacket[];
      daily = pack(dRows[0]);
      monthly = pack(mRows[0]);
      yearly = pack(yRows[0]);
      const mapRows = (rowsIn: RowDataPacket[]) =>
        rowsIn.map((r) => ({
          period: String(r.period ?? ""),
          sessions_count: Number(r.sessions_count ?? 0),
          total_bytes: toSafeBigInt(r.total_bytes).toString(),
        }));
      reports = {
        daily: mapRows((drRes[0] as RowDataPacket[]) ?? []),
        monthly: mapRows((mrRes[0] as RowDataPacket[]) ?? []),
        yearly: mapRows((yrRes[0] as RowDataPacket[]) ?? []),
      };
    }
    const settings = await getSystemSettings(tenantId);
    res.json({
      subscriber: {
        username,
        first_name: String(row.first_name ?? ""),
        last_name: String(row.last_name ?? ""),
        nickname: String(row.nickname ?? ""),
        phone: String(row.phone ?? ""),
        region_name: String(row.region_name ?? ""),
        status: String(row.status ?? ""),
        start_date: row.start_date,
        expiration_date: row.expiration_date,
        package_name: String(row.package_name ?? "—"),
        speed: String(row.mikrotik_rate_limit ?? "—"),
        quota_total_bytes: quota.toString(),
        used_bytes: used.toString(),
        remaining_bytes: remaining != null ? remaining.toString() : null,
        is_limited_quota: quota > 0n,
      },
      usage: { daily, monthly, yearly },
      usage_reports: reports,
      accountant_phone: settings.accountant_contact_phone,
      license_note: settings.subscription_license_note,
    });
  } catch (e) {
    console.error("public-lookup", e);
    res.status(500).json({ error: "public_lookup_failed" });
  }
});

const loginBody = z.object({
  username: z.string().min(1).max(64).optional(),
  phone: z.string().min(4).max(32).optional(),
  password: z.string().min(1).optional(),
});

router.post("/login", loginRateLimiter, async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const tenantId = config.defaultTenantId;
  const password = String(parsed.data.password ?? "");
  const usernameInput = String(parsed.data.username ?? "").trim();
  const phoneDigits = normalizePhoneDigits(parsed.data.phone ?? "");
  if (!usernameInput && !phoneDigits) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  async function loadSubscribersByLookup(): Promise<RowDataPacket[]> {
    if (phoneDigits) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, username, status
         FROM subscribers
         WHERE tenant_id = ?
           AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),' ',''),'-',''),'+',''),'(','') = ?
         LIMIT 2`,
        [tenantId, phoneDigits]
      );
      return rows;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, username, status FROM subscribers WHERE tenant_id = ? AND username = ? LIMIT 1`,
      [tenantId, usernameInput]
    );
    return rows;
  }

  let subs: RowDataPacket[] = await loadSubscribersByLookup();
  if (phoneDigits && subs.length > 1) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  /** Restored DMA DB: create extension row from rm_users + radcheck when missing. */
  if (!subs[0] && (await hasTable(pool, "rm_users"))) {
    let legacyUser: string | null = null;
    if (usernameInput) {
      const [c] = await pool.query<RowDataPacket[]>(
        `SELECT username FROM rm_users WHERE username = ? LIMIT 1`,
        [usernameInput]
      );
      if (c[0]) legacyUser = String(c[0].username);
    } else if (phoneDigits) {
      const [c] = await pool.query<RowDataPacket[]>(
        `SELECT username FROM rm_users
         WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),' ',''),'-',''),'+',''),'(','') = ?
            OR REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(mobile,''),' ',''),'-',''),'+',''),'(','') = ?
         LIMIT 2`,
        [phoneDigits, phoneDigits]
      );
      if (c.length === 1) legacyUser = String(c[0].username);
    }
    if (legacyUser) {
      const reloadAfterImport = async () => {
        const [byUser] = await pool.query<RowDataPacket[]>(
          `SELECT id, username, status FROM subscribers WHERE tenant_id = ? AND username = ? LIMIT 1`,
          [tenantId, legacyUser]
        );
        subs = byUser;
      };
      if (phoneDigits && !password) {
        await importSubscribersFromDma(pool, {
          tenantId,
          validateSchema: false,
          dryRun: false,
          onlyUsernames: [legacyUser],
        });
        await reloadAfterImport();
      } else if (password && (await verifyLegacySubscriberPassword(pool, legacyUser, password))) {
        await importSubscribersFromDma(pool, {
          tenantId,
          validateSchema: false,
          dryRun: false,
          onlyUsernames: [legacyUser],
        });
        await reloadAfterImport();
      }
    }
  }

  if (!subs[0]) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const username = String(subs[0].username ?? "");
  // Phone mode: login by phone only (no password) after match.
  if (!phoneDigits) {
    if (!password) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    if (!(await verifyLegacySubscriberPassword(pool, username, password))) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
  }
  const payload: SubscriberJwtPayload = {
    kind: "subscriber",
    sub: subs[0].id as string,
    tenantId,
    username: subs[0].username as string,
  };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: "24h" });
  res.json({ token, user: { id: payload.sub, username: payload.username } });
});

router.get("/me", requireSubscriberAuth, async (req, res) => {
  const sid = req.subscriber!.sub;
  const tenantId = req.subscriber!.tenantId;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.username, s.status, s.expiration_date, s.start_date, s.used_bytes,
            s.first_name, s.last_name, s.nickname, s.phone, s.region_id,
            p.name AS package_name, p.mikrotik_rate_limit, p.quota_total_bytes,
            r.name AS region_name,
            u.total_bytes AS usage_live_bytes
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id
     LEFT JOIN subscriber_regions r ON r.id = s.region_id
     LEFT JOIN user_usage_live u ON u.tenant_id = s.tenant_id AND u.username = s.username
     WHERE s.id = ? AND s.tenant_id = ? LIMIT 1`,
    [sid, tenantId]
  );
  if (!rows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  let framedIp: string | null = null;
  if (await hasTable(pool, "radacct")) {
    const [sess] = await pool.query<RowDataPacket[]>(
      `SELECT framedipaddress FROM radacct
       WHERE username = ? AND acctstoptime IS NULL
       ORDER BY acctstarttime DESC LIMIT 1`,
      [rows[0].username as string]
    );
    framedIp = sess[0]?.framedipaddress != null ? String(sess[0].framedipaddress) : null;
  }
  const quota = BigInt(rows[0].quota_total_bytes as string | number | bigint ?? 0);
  const used = BigInt(
    (rows[0].usage_live_bytes ?? rows[0].used_bytes ?? 0) as string | number | bigint
  );
  const remaining =
    quota > 0n ? (used >= quota ? 0n : quota - used) : null;
  res.json({
    subscriber: rows[0],
    current_ip: framedIp,
    usage_bytes: used.toString(),
    quota_bytes: quota.toString(),
    remaining_bytes: remaining != null ? remaining.toString() : null,
  });
});

router.get("/me/traffic-report", requireSubscriberAuth, async (req, res) => {
  const queryParsed = z
    .object({
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: "invalid_query" });
    return;
  }
  const fromDate = queryParsed.data.from ?? null;
  const toDate = queryParsed.data.to ?? null;
  if (fromDate && toDate && fromDate > toDate) {
    res.status(400).json({ error: "invalid_range" });
    return;
  }
  const sid = req.subscriber!.sub;
  const tenantId = req.subscriber!.tenantId;
  const [subs] = await pool.query<RowDataPacket[]>(
    `SELECT username FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [sid, tenantId]
  );
  if (!subs[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const username = String(subs[0].username ?? "");
  if (!(await hasTable(pool, "radacct"))) {
    res.json({
      username,
      totals: {
        daily_online_seconds: 0,
        daily_download_bytes: "0",
        daily_upload_bytes: "0",
        daily_total_bytes: "0",
        monthly_online_seconds: 0,
        monthly_download_bytes: "0",
        monthly_upload_bytes: "0",
        monthly_total_bytes: "0",
      },
      daily: [],
      monthly: [],
      yearly: [],
      sessions: [],
    });
    return;
  }
  const sessionSecondsExpr = `GREATEST(
    COALESCE(acctsessiontime, 0),
    COALESCE(TIMESTAMPDIFF(SECOND, acctstarttime, COALESCE(acctstoptime, NOW())), 0)
  )`;
  const dateWhereParts: string[] = [];
  const dateParams: string[] = [];
  if (fromDate) {
    dateWhereParts.push(`DATE(acctstarttime) >= ?`);
    dateParams.push(fromDate);
  }
  if (toDate) {
    dateWhereParts.push(`DATE(acctstarttime) <= ?`);
    dateParams.push(toDate);
  }
  const dateWhereSql = dateWhereParts.length ? ` AND ${dateWhereParts.join(" AND ")}` : "";
  const [dailyRows, monthlyRows, yearlyRows, todayRows, monthRows, sessionRows] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT
         DATE(acctstarttime) AS period,
         COUNT(*) AS sessions_count,
         SUM(${sessionSecondsExpr}) AS online_seconds,
         SUM(COALESCE(acctinputoctets,0)) AS download_bytes,
         SUM(COALESCE(acctoutputoctets,0)) AS upload_bytes
       FROM radacct
       WHERE username = ?${dateWhereSql}
       GROUP BY DATE(acctstarttime)
       ORDER BY period DESC
       LIMIT 90`,
      [username, ...dateParams]
    ),
    pool.query<RowDataPacket[]>(
      `SELECT
         DATE_FORMAT(acctstarttime, '%Y-%m') AS period,
         COUNT(*) AS sessions_count,
         SUM(${sessionSecondsExpr}) AS online_seconds,
         SUM(COALESCE(acctinputoctets,0)) AS download_bytes,
         SUM(COALESCE(acctoutputoctets,0)) AS upload_bytes
       FROM radacct
       WHERE username = ?${dateWhereSql}
       GROUP BY DATE_FORMAT(acctstarttime, '%Y-%m')
       ORDER BY period DESC
       LIMIT 24`,
      [username, ...dateParams]
    ),
    pool.query<RowDataPacket[]>(
      `SELECT
         DATE_FORMAT(acctstarttime, '%Y') AS period,
         COUNT(*) AS sessions_count,
         SUM(${sessionSecondsExpr}) AS online_seconds,
         SUM(COALESCE(acctinputoctets,0)) AS download_bytes,
         SUM(COALESCE(acctoutputoctets,0)) AS upload_bytes
       FROM radacct
       WHERE username = ?${dateWhereSql}
       GROUP BY DATE_FORMAT(acctstarttime, '%Y')
       ORDER BY period DESC
       LIMIT 10`,
      [username, ...dateParams]
    ),
    pool.query<RowDataPacket[]>(
      `SELECT
         SUM(${sessionSecondsExpr}) AS online_seconds,
         SUM(COALESCE(acctinputoctets,0)) AS download_bytes,
         SUM(COALESCE(acctoutputoctets,0)) AS upload_bytes
       FROM radacct
       WHERE username = ? AND DATE(acctstarttime) = CURDATE()${dateWhereSql}`,
      [username, ...dateParams]
    ),
    pool.query<RowDataPacket[]>(
      `SELECT
         SUM(${sessionSecondsExpr}) AS online_seconds,
         SUM(COALESCE(acctinputoctets,0)) AS download_bytes,
         SUM(COALESCE(acctoutputoctets,0)) AS upload_bytes
       FROM radacct
       WHERE username = ?
         AND YEAR(acctstarttime) = YEAR(CURDATE())
         AND MONTH(acctstarttime) = MONTH(CURDATE())${dateWhereSql}`,
      [username, ...dateParams]
    ),
    pool.query<RowDataPacket[]>(
      `SELECT
         radacctid,
         nasipaddress,
         framedipaddress,
         callingstationid,
         acctstarttime,
         acctstoptime,
         ${sessionSecondsExpr} AS online_seconds,
         COALESCE(acctinputoctets,0) AS download_bytes,
         COALESCE(acctoutputoctets,0) AS upload_bytes
       FROM radacct
       WHERE username = ?${dateWhereSql}
       ORDER BY acctstarttime DESC
       LIMIT 120`,
      [username, ...dateParams]
    ),
  ]);
  const mapAggRows = (rows: RowDataPacket[]) =>
    rows.map((r) => {
      const download = toSafeBigInt(r.download_bytes).toString();
      const upload = toSafeBigInt(r.upload_bytes).toString();
      const total = (toSafeBigInt(r.download_bytes) + toSafeBigInt(r.upload_bytes)).toString();
      return {
        period: String(r.period ?? ""),
        sessions_count: Number(r.sessions_count ?? 0),
        online_seconds: Number(r.online_seconds ?? 0),
        download_bytes: download,
        upload_bytes: upload,
        total_bytes: total,
      };
    });
  const daily = mapAggRows(dailyRows[0] ?? []);
  const monthly = mapAggRows(monthlyRows[0] ?? []);
  const yearly = mapAggRows(yearlyRows[0] ?? []);
  const today = todayRows[0]?.[0] ?? {};
  const month = monthRows[0]?.[0] ?? {};
  const dailyDownload = toSafeBigInt(today.download_bytes).toString();
  const dailyUpload = toSafeBigInt(today.upload_bytes).toString();
  const monthlyDownload = toSafeBigInt(month.download_bytes).toString();
  const monthlyUpload = toSafeBigInt(month.upload_bytes).toString();
  const sessions = (sessionRows[0] ?? []).map((r) => {
    const download = toSafeBigInt(r.download_bytes).toString();
    const upload = toSafeBigInt(r.upload_bytes).toString();
    const total = (toSafeBigInt(r.download_bytes) + toSafeBigInt(r.upload_bytes)).toString();
    return {
      radacctid: String(r.radacctid ?? ""),
      start_time: r.acctstarttime ? String(r.acctstarttime) : null,
      stop_time: r.acctstoptime ? String(r.acctstoptime) : null,
      online_seconds: Number(r.online_seconds ?? 0),
      download_bytes: download,
      upload_bytes: upload,
      total_bytes: total,
      framed_ip: r.framedipaddress ? String(r.framedipaddress) : null,
      caller_id: r.callingstationid ? String(r.callingstationid) : null,
      nas_ip: r.nasipaddress ? String(r.nasipaddress) : null,
      is_active: !r.acctstoptime,
    };
  });
  res.json({
    username,
    filter: {
      from: fromDate,
      to: toDate,
    },
    totals: {
      daily_online_seconds: Number(today.online_seconds ?? 0),
      daily_download_bytes: dailyDownload,
      daily_upload_bytes: dailyUpload,
      daily_total_bytes: (toSafeBigInt(today.download_bytes) + toSafeBigInt(today.upload_bytes)).toString(),
      monthly_online_seconds: Number(month.online_seconds ?? 0),
      monthly_download_bytes: monthlyDownload,
      monthly_upload_bytes: monthlyUpload,
      monthly_total_bytes: (toSafeBigInt(month.download_bytes) + toSafeBigInt(month.upload_bytes)).toString(),
    },
    daily,
    monthly,
    yearly,
    sessions,
  });
});

const changePwBody = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(1),
});

router.post("/change-password", requireSubscriberAuth, async (req, res) => {
  const parsed = changePwBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const { current_password, new_password } = parsed.data;
  const username = req.subscriber!.username;
  const sid = req.subscriber!.sub;
  const tenantId = req.subscriber!.tenantId;
  const [pwRows] = await pool.query<RowDataPacket[]>(
    `SELECT value FROM radcheck WHERE username = ? AND attribute = 'Cleartext-Password' LIMIT 1`,
    [username]
  );
  const stored = pwRows[0]?.value != null ? String(pwRows[0].value) : null;
  if (!stored || stored !== current_password) {
    res.status(400).json({ error: "wrong_password" });
    return;
  }
  const enc = encryptSecret(new_password);
  await pool.execute(`UPDATE subscribers SET radius_password_encrypted = ? WHERE id = ? AND tenant_id = ?`, [
    enc,
    sid,
    tenantId,
  ]);
  const [sub] = await pool.query<RowDataPacket[]>(
    `SELECT package_id, status, ip_address, mac_address, pool FROM subscribers WHERE id = ? AND tenant_id = ?`,
    [sid, tenantId]
  );
  if (sub[0]?.package_id && sub[0].status === "active") {
    const pkg = await radius.getPackage(tenantId, sub[0].package_id as string);
    if (pkg) {
      await radius.createRadiusUser({
        username,
        password: new_password,
        package: pkg,
        framedIp: sub[0].ip_address as string | null,
        macLock: sub[0].mac_address as string | null,
        framedPool: sub[0].pool as string | null,
      });
    }
  } else {
    await pool.execute(
      `UPDATE radcheck SET value = ? WHERE username = ? AND attribute = 'Cleartext-Password'`,
      [new_password, username]
    );
  }
  res.json({ ok: true });
});

export default router;
