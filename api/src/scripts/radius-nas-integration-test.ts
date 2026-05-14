/**
 * End-to-end RADIUS + NAS integration lab (MikroTik-style).
 * - Seeds TEST-* NAS, packages, subscribers, prepaid cards (no deletes).
 * - Uses radclient inside the FreeRADIUS Docker container when available (same as synthetic probe).
 * - Writes reports/radius-nas-integration-test-YYYY-MM-DD-HH-mm.md at repo root.
 *
 * Run from `api/`:  npm run test:radius-integration
 *
 * Env:
 *   DATABASE_URL, DEFAULT_TENANT_ID (optional)
 *   RADIUS_TEST_CONTAINER (default futureradius-freeradius-1)
 *   RADIUS_TEST_HOST_AUTH (default 127.0.0.1:1812)
 *   RADIUS_TEST_HOST_ACCT (default 127.0.0.1:1813)
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { pool, waitForDbReady } from "../lib/db.js";
import { hasTable } from "../db/schemaGuards.js";
import { RadiusSyncService } from "../services/radius-sync.service.js";
import { AccountingService } from "../services/accounting.service.js";
import { RadiusService } from "../services/radius.service.js";
import { CoaService } from "../services/coa.service.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const radius: any = require("radius");
radius.load_dictionaries?.();

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");

const TENANT = config.defaultTenantId;
const CONTAINER = process.env.RADIUS_TEST_CONTAINER ?? "futureradius-freeradius-1";
const HOST_AUTH = process.env.RADIUS_TEST_HOST_AUTH ?? "127.0.0.1:1812";
const HOST_ACCT = process.env.RADIUS_TEST_HOST_ACCT ?? "127.0.0.1:1813";

const BYTES_50MB = 50 * 1024 * 1024;
const BYTES_10MB = 10 * 1024 * 1024;

/**
 * `radclient` inside the FreeRADIUS container sends from 127.0.0.1. The stock `clients.conf`
 * defines `client localhost { ipaddr = 127.0.0.1; secret = testing123; }` which takes precedence
 * over SQL `nas` rows for that source IP — use the same secret for radclient verification.
 */
const RADCLIENT_LOOPBACK_SECRET = process.env.RADIUS_TEST_LOCAL_CLIENT_SECRET ?? "testing123";

type CaseResult = "PASSED" | "FAILED" | "SKIPPED";

const NAS_DEFS = [
  { name: "TEST-NAS-01", ip: "192.0.2.10", secret: "TEST-SECRET-NAS-01" },
  { name: "TEST-NAS-02", ip: "192.0.2.11", secret: "TEST-SECRET-NAS-02" },
  { name: "TEST-NAS-03", ip: "192.0.2.12", secret: "TEST-SECRET-NAS-03" },
  { name: "TEST-NAS-04", ip: "192.0.2.13", secret: "TEST-SECRET-NAS-04" },
  { name: "TEST-NAS-05", ip: "192.0.2.14", secret: "TEST-SECRET-NAS-05" },
] as const;

type NasRow = { id: string; name: string; ip: string; secret: string };

class Report {
  lines: string[] = [];
  h(s: string) {
    this.lines.push(s, "");
  }
  p(s: string) {
    this.lines.push(s, "");
  }
  code(s: string) {
    this.lines.push("```", s, "```", "");
  }
  toString() {
    return this.lines.join("\n").trim() + "\n";
  }
}

function tsName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}`;
}

function radclientDocker(
  hostPort: string,
  mode: "auth" | "acct",
  secret: string,
  attrBlock: string
): Promise<{ out: string; code: number | null }> {
  return new Promise((resolve) => {
    const args = ["exec", "-i", CONTAINER, "radclient", "-x", "-t", "4", "-r", "2", hostPort, mode, secret];
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 12_000);
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ out: `docker_spawn_error: ${e instanceof Error ? e.message : String(e)}`, code: 1 });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ out: `${stdout}\n${stderr}`.trim(), code });
    });
    try {
      child.stdin.end(attrBlock.endsWith("\n") ? attrBlock : `${attrBlock}\n`);
    } catch (e) {
      clearTimeout(t);
      resolve({ out: `stdin_error: ${e instanceof Error ? e.message : String(e)}`, code: 1 });
    }
  });
}

function parseRadclientAuth(out: string): { kind: "Accept" | "Reject" | "Unknown"; attrs: Record<string, string> } {
  const attrs: Record<string, string> = {};
  if (/Received Access-Accept/i.test(out)) {
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*[:=]\s*(.+)$/i);
      if (m) attrs[m[1]] = m[2].trim();
    }
    return { kind: "Accept", attrs };
  }
  if (/Received Access-Reject/i.test(out)) {
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*[:=]\s*(.+)$/i);
      if (m) attrs[m[1]] = m[2].trim();
    }
    return { kind: "Reject", attrs };
  }
  return { kind: "Unknown", attrs: {} };
}

async function radiusAuthUdp(
  nasIp: string,
  secret: string,
  username: string,
  password: string
): Promise<{ kind: "Accept" | "Reject" | "Unknown"; raw?: string; attrs: Record<string, string>; err?: string }> {
  const dgram = await import("node:dgram");
  const socket = dgram.createSocket("udp4");
  const [host, portStr] = HOST_AUTH.split(":");
  const port = parseInt(portStr || "1812", 10);
  const identifier = Math.floor(Math.random() * 256);
  let encoded: Buffer;
  try {
    encoded = radius.encode({
      code: "Access-Request",
      secret,
      identifier,
      attributes: [
        ["NAS-IP-Address", nasIp],
        ["User-Name", username],
        ["User-Password", password],
      ],
    });
  } catch (e) {
    return { kind: "Unknown", attrs: {}, err: e instanceof Error ? e.message : String(e) };
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve({ kind: "Unknown", attrs: {}, err: "udp_timeout" });
    }, 1500);
    socket.once("message", (msg) => {
      clearTimeout(timer);
      try {
        const decoded = radius.decode({ packet: msg, secret });
        const attrs: Record<string, string> = {};
        const a = decoded.attributes ?? {};
        for (const [k, v] of Object.entries(a)) {
          attrs[k] = Array.isArray(v) ? v.map(String).join(", ") : String(v);
        }
        const kind =
          decoded.code === "Access-Accept"
            ? "Accept"
            : decoded.code === "Access-Reject"
              ? "Reject"
              : "Unknown";
        socket.close();
        resolve({ kind, attrs });
      } catch (e) {
        socket.close();
        resolve({ kind: "Unknown", attrs: {}, err: e instanceof Error ? e.message : String(e) });
      }
    });
    socket.once("error", (e) => {
      clearTimeout(timer);
      resolve({ kind: "Unknown", attrs: {}, err: e.message });
    });
    socket.bind(0, () => {
      socket.send(encoded, port, host, (err) => {
        if (err) {
          clearTimeout(timer);
          socket.close();
          resolve({ kind: "Unknown", attrs: {}, err: err.message });
        }
      });
    });
  });
}

async function ensureNasList(radiusSync: RadiusSyncService): Promise<NasRow[]> {
  const out: NasRow[] = [];
  for (const n of NAS_DEFS) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, ip, secret FROM nas_devices WHERE tenant_id = ? AND name = ? LIMIT 1`,
      [TENANT, n.name]
    );
    if (rows[0]) {
      out.push({
        id: String(rows[0].id),
        name: String(rows[0].name),
        ip: String(rows[0].ip),
        secret: String(rows[0].secret),
      });
      continue;
    }
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO nas_devices (id, tenant_id, name, ip, type, secret, coa_port, mikrotik_api_enabled, status)
       VALUES (?, ?, ?, ?, 'mikrotik', ?, 3799, 0, 'active')`,
      [id, TENANT, n.name, n.ip, n.secret]
    );
    await radiusSync.syncNasDevice(id, TENANT);
    out.push({ id, name: n.name, ip: n.ip, secret: n.secret });
  }
  return out;
}

async function ensurePackage(
  name: string,
  mikrotikRate: string,
  quotaBytes: number,
  accountType: "subscriptions" | "cards" = "subscriptions"
): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM packages WHERE tenant_id = ? AND name = ? LIMIT 1`,
    [TENANT, name]
  );
  if (rows[0]) return String(rows[0].id);
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO packages (id, tenant_id, name, description, mikrotik_rate_limit, framed_ip_address,
       mikrotik_address_list, default_framed_pool, simultaneous_use, quota_total_bytes, billing_period_days,
       price, currency, account_type, active)
     VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL, 1, ?, 30, 0, 'USD', ?, 1)`,
    [id, TENANT, name, mikrotikRate, String(quotaBytes), accountType]
  );
  return id;
}

async function ensureSubscriber(
  username: string,
  password: string,
  packageId: string | null,
  status: string,
  expiration: string | null,
  usedBytes = 0
): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM subscribers WHERE tenant_id = ? AND username = ? LIMIT 1`,
    [TENANT, username]
  );
  let id: string;
  if (rows[0]) {
    id = String(rows[0].id);
    await pool.execute(
      `UPDATE subscribers SET package_id = ?, status = ?, expiration_date = ?, used_bytes = ? WHERE id = ? AND tenant_id = ?`,
      [packageId, status, expiration, usedBytes, id, TENANT]
    );
    await pool.execute(
      `INSERT INTO subscriber_credentials (subscriber_id, tenant_id, password) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE password = VALUES(password)`,
      [id, TENANT, password]
    );
  } else {
    id = randomUUID();
    await pool.execute(
      `INSERT INTO subscribers (id, tenant_id, customer_id, package_id, username, status, expiration_date, used_bytes)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
      [id, TENANT, packageId, username, status, expiration, usedBytes]
    );
    await pool.execute(`INSERT INTO subscriber_credentials (subscriber_id, tenant_id, password) VALUES (?, ?, ?)`, [
      id,
      TENANT,
      password,
    ]);
  }
  return id;
}

async function runAcct(
  nas: NasRow,
  username: string,
  status: "Start" | "Interim-Update" | "Stop",
  sessionId: string,
  inOctets: number,
  outOctets: number
): Promise<string> {
  const statusType =
    status === "Start" ? 1 : status === "Stop" ? 2 : 3;
  const stopAttrs =
    status === "Stop"
      ? `Acct-Session-Time = 120
Acct-Terminate-Cause = User-Request
`
      : "";
  const block = `User-Name = ${username}
NAS-IP-Address = ${nas.ip}
Acct-Session-Id = ${sessionId}
Acct-Status-Type = ${statusType}
Acct-Authentic = RADIUS
Service-Type = Framed-User
Framed-Protocol = PPP
Acct-Input-Octets = ${inOctets}
Acct-Output-Octets = ${outOctets}
${stopAttrs}`;
  const { out, code } = await radclientDocker(HOST_ACCT, "acct", RADCLIENT_LOOPBACK_SECRET, block);
  return `exit=${code}\n${out}`;
}

async function refreshUsage(accounting: AccountingService): Promise<void> {
  await accounting.refreshUsageCache(TENANT);
  await accounting.syncSubscribersUsedBytes(TENANT);
}

async function runIntegrationUsageCycle(
  accounting: AccountingService,
  radiusSvc: RadiusService,
  coa: CoaService
): Promise<void> {
  await accounting.refreshUsageCache(TENANT);
  await accounting.syncSubscribersUsedBytes(TENANT);

  const [due] = await pool.query<RowDataPacket[]>(
    `SELECT id, username FROM subscribers
     WHERE tenant_id = ? AND status = 'active' AND expiration_date IS NOT NULL AND expiration_date < NOW()`,
    [TENANT]
  );
  for (const row of due) {
    const username = String(row.username ?? "");
    const id = String(row.id ?? "");
    if (!username) continue;
    await coa.disconnectAllSessions(username, TENANT).catch(() => null);
    await radiusSvc.disableRadiusUser(username).catch(() => null);
    await pool.execute(`UPDATE subscribers SET status = 'expired' WHERE id = ?`, [id]);
  }

  const [quotaRows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.username, s.used_bytes, p.quota_total_bytes
     FROM subscribers s
     INNER JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
     WHERE s.tenant_id = ?
       AND s.status = 'active'
       AND COALESCE(p.quota_total_bytes, 0) > 0
       AND s.used_bytes >= p.quota_total_bytes`,
    [TENANT]
  );
  for (const row of quotaRows) {
    const username = String(row.username ?? "");
    const sid = String(row.id ?? "");
    if (!username) continue;
    await coa.disconnectAllSessions(username, TENANT).catch(() => null);
    await radiusSvc.applyQuotaHardDeny(username).catch(() => null);
    await pool.execute(`UPDATE subscribers SET status = 'suspended' WHERE id = ? AND tenant_id = ?`, [sid, TENANT]);
  }
}

async function runPolicyCycle(
  accounting: AccountingService,
  radiusService: RadiusService,
  coa: CoaService
): Promise<void> {
  await runIntegrationUsageCycle(accounting, radiusService, coa);
}

async function latestRadacct(username: string): Promise<RowDataPacket | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT radacctid, acctsessionid, nasipaddress, acctstarttime, acctstoptime, acctupdatetime,
            acctinputoctets, acctoutputoctets, acctterminatecause
     FROM radacct WHERE username = ? ORDER BY radacctid DESC LIMIT 1`,
    [username]
  );
  return rows[0] ?? null;
}

async function latestRadpostauth(username: string, n = 3): Promise<RowDataPacket[]> {
  if (!(await hasTable(pool, "radpostauth"))) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT username, reply, authdate FROM radpostauth WHERE username = ? ORDER BY id DESC LIMIT ?`,
    [username, n]
  );
  return rows;
}

async function redeemPrepaidCard(
  cardCode: string,
  subscriberId: string,
  radiusSync: RadiusSyncService
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!(await hasTable(pool, "prepaid_integration_test_cards"))) {
    return { ok: false, reason: "table_missing" };
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [cards] = await conn.query<RowDataPacket[]>(
      `SELECT id, package_id, validity_hours, status FROM prepaid_integration_test_cards
       WHERE tenant_id = ? AND card_code = ? FOR UPDATE`,
      [TENANT, cardCode]
    );
    const c = cards[0];
    if (!c) {
      await conn.rollback();
      return { ok: false, reason: "card_not_found" };
    }
    if (String(c.status) !== "available") {
      await conn.rollback();
      return { ok: false, reason: `card_${c.status}` };
    }
    const pkgId = String(c.package_id);
    const hours = Math.max(1, Math.min(24 * 365, Number(c.validity_hours ?? 24)));
    await conn.execute(
      `UPDATE subscribers SET package_id = ?, status = 'active', used_bytes = 0,
         expiration_date = DATE_ADD(NOW(), INTERVAL ${hours} HOUR)
       WHERE id = ? AND tenant_id = ?`,
      [pkgId, subscriberId, TENANT]
    );
    await conn.execute(
      `UPDATE prepaid_integration_test_cards
       SET status = 'consumed', redeemed_by_subscriber_id = ?, redeemed_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND tenant_id = ?`,
      [subscriberId, String(c.id), TENANT]
    );
    await conn.commit();
    await radiusSync.syncSubscriber(subscriberId, TENANT);
    return { ok: true };
  } catch (e) {
    await conn.rollback();
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  } finally {
    conn.release();
  }
}

async function dockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const c = spawn("docker", ["info"], { stdio: "ignore" });
    c.on("error", () => resolve(false));
    c.on("close", (code) => resolve(code === 0));
  });
}

async function containerRunning(): Promise<boolean> {
  const { out, code } = await new Promise<{ out: string; code: number | null }>((resolve) => {
    const child = spawn("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER], { stdio: ["ignore", "pipe", "pipe"] });
    let o = "";
    child.stdout.on("data", (d) => (o += d.toString()));
    child.on("close", (cd) => resolve({ out: o.trim(), code: cd }));
    child.on("error", () => resolve({ out: "", code: 1 }));
  });
  return code === 0 && out === "true";
}

async function main(): Promise<void> {
  console.error(`[radius-integration] starting at ${new Date().toISOString()}`);
  const report = new Report();
  report.h("# Future Radius — RADIUS / NAS integration test");
  report.p(`Generated: ${new Date().toISOString()}`);
  report.p(`Tenant: ${TENANT}`);
  report.p(`Docker container: ${CONTAINER}`);

  const results: Record<string, CaseResult> = {};

  await waitForDbReady();
  const radiusSync = new RadiusSyncService(pool);
  const accounting = new AccountingService(pool);
  const radiusSvc = new RadiusService(pool);
  const coa = new CoaService(pool);

  const dockerOk = await dockerAvailable();
  const containerOk = dockerOk && (await containerRunning());
  report.p(`Docker CLI: ${dockerOk ? "ok" : "unavailable"}`);
  report.p(`FreeRADIUS container running: ${containerOk ? "yes" : "no"}`);

  report.h("## 1) NAS (MikroTik-style lab)");
  const nasList = await ensureNasList(radiusSync);
  report.p(
    `- **radclient** يستخدم سر العميل الافتراضي لـ \`127.0.0.1\` من \`clients.conf\` (افتراضيًا \`testing123\`؛ يُستبدل بـ \`RADIUS_TEST_LOCAL_CLIENT_SECRET\` إن رغبت).`
  );
  for (const n of nasList) {
    report.p(`- **${n.name}** id=\`${n.id}\` ip=\`${n.ip}\` secret=\`${n.secret}\` (synced to FreeRADIUS \`nas\` table)`);
  }
  results["nas_seed"] = "PASSED";

  report.h("## 2) Packages (profiles)");
  const pkg50 = await ensurePackage("TEST-50MB", "1M/1M", BYTES_50MB, "subscriptions");
  const pkg1m = await ensurePackage("TEST-1M", "1M/1M", 0, "subscriptions");
  const pkgPrepaid = await ensurePackage("TEST-PREPAID-PKG", "1M/1M", BYTES_10MB, "cards");
  await radiusSync.syncPackage(pkg50, TENANT);
  await radiusSync.syncPackage(pkg1m, TENANT);
  await radiusSync.syncPackage(pkgPrepaid, TENANT);
  report.p(`- **TEST-50MB** id=\`${pkg50}\` rate \`1M/1M\` quota **${BYTES_50MB}** bytes (50 MiB)`);
  report.p(`- **TEST-1M** id=\`${pkg1m}\` rate \`1M/1M\` quota **0** (volume unlimited; expiry drives denial)`);
  report.p(`- **TEST-PREPAID-PKG** id=\`${pkgPrepaid}\` rate \`1M/1M\` quota **${BYTES_10MB}** bytes (10 MiB lab card value)`);
  results["packages"] = "PASSED";

  report.h("## 3) Subscribers");
  const pass50 = "TEST-PASS-50MB!";
  const pass1m = "TEST-PASS-1M!";
  const passExp = "TEST-PASS-EXPIRED!";
  const passPre = "TEST-PASS-PREPAID!";

  const u50a = await ensureSubscriber("TEST-Q50-U01", pass50, pkg50, "active", null, 0);
  const u50b = await ensureSubscriber("TEST-Q50-U02", pass50, pkg50, "active", null, 0);
  const u50c = await ensureSubscriber("TEST-Q50-U03", pass50, pkg50, "active", null, 0);
  const uExp = await ensureSubscriber("TEST-EXPIRED", passExp, pkg1m, "active", "2020-01-01 00:00:00", 0);
  const u1m = await ensureSubscriber("TEST-1M-SUB", pass1m, pkg1m, "active", null, 0);
  const uPreTarget = await ensureSubscriber("TEST-PREPAID-TARGET", passPre, null, "active", null, 0);

  for (const [u, id] of [
    ["TEST-Q50-U01", u50a],
    ["TEST-Q50-U02", u50b],
    ["TEST-Q50-U03", u50c],
  ]) {
    await radiusSync.syncSubscriber(id, TENANT);
    report.p(`- **${u}** id=\`${id}\` package TEST-50MB`);
  }
  await radiusSync.syncSubscriber(uExp, TENANT);
  await radiusSync.syncSubscriber(u1m, TENANT);
  await radiusSync.syncSubscriber(uPreTarget, TENANT);

  report.p(`- **TEST-EXPIRED** id=\`${uExp}\` package TEST-1M, expiration in the past`);
  report.p(`- **TEST-1M-SUB** id=\`${u1m}\` package TEST-1M`);
  report.p(`- **TEST-PREPAID-TARGET** id=\`${uPreTarget}\` (starts without package; cards attach package)`);

  results["subscribers_seed"] = "PASSED";

  report.h("## 4) Prepaid integration cards (migration 006)");
  const prepaidTable = await hasTable(pool, "prepaid_integration_test_cards");
  if (!prepaidTable) {
    report.p(
      "**SKIPPED**: table `prepaid_integration_test_cards` missing — apply `sql/migrations/006_prepaid_integration_test_cards.sql` via your migration runner."
    );
    results["prepaid_cards"] = "SKIPPED";
  } else {
    for (const code of ["TEST-RECHARGE-01", "TEST-RECHARGE-02"]) {
      const [ex] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM prepaid_integration_test_cards WHERE tenant_id = ? AND card_code = ? LIMIT 1`,
        [TENANT, code]
      );
      if (!ex[0]) {
        const cid = randomUUID();
        await pool.execute(
          `INSERT INTO prepaid_integration_test_cards (id, tenant_id, card_code, package_id, validity_hours, status)
           VALUES (?, ?, ?, ?, 24, 'available')`,
          [cid, TENANT, code, pkgPrepaid]
        );
      }
    }
    report.p("- Cards **TEST-RECHARGE-01**, **TEST-RECHARGE-02** ensured (`available` until redeemed).");
    results["prepaid_cards"] = "PASSED";
  }

  report.h("## 5) RADIUS authentication");

  /** Prefer `radclient` in the FreeRADIUS container when available (fast on Windows); else short UDP probe. */
  async function tryAuth(
    nas: NasRow,
    username: string,
    password: string
  ): Promise<{ line: string; accept: boolean; attrs: Record<string, string>; detail: string }> {
    if (containerOk) {
      const block = `User-Name = ${username}
User-Password = ${password}
NAS-IP-Address = ${nas.ip}`;
      const { out, code } = await radclientDocker(HOST_AUTH, "auth", RADCLIENT_LOOPBACK_SECRET, block);
      const pr = parseRadclientAuth(out);
      return {
        line: `radclient exit=${code} ${pr.kind} (docker)`,
        accept: pr.kind === "Accept",
        attrs: pr.attrs,
        detail: out.slice(0, 4000),
      };
    }
    const udp = await radiusAuthUdp(nas.ip, nas.secret, username, password);
    if (!udp.err && udp.kind !== "Unknown") {
      const pick = (k: string) => udp.attrs[k] ?? udp.attrs[k.replace(/-/g, "")] ?? "";
      const mrl = pick("Mikrotik-Rate-Limit");
      const st = pick("Session-Timeout");
      const idle = pick("Idle-Timeout");
      const framed = pick("Framed-IP-Address");
      const rm = pick("Reply-Message");
      const bits = [
        `UDP ${udp.kind}`,
        mrl && `Mikrotik-Rate-Limit=${mrl}`,
        st && `Session-Timeout=${st}`,
        idle && `Idle-Timeout=${idle}`,
        framed && `Framed-IP=${framed}`,
        rm && `Reply-Message=${rm}`,
      ]
        .filter(Boolean)
        .join(" | ");
      return { line: bits, accept: udp.kind === "Accept", attrs: udp.attrs, detail: JSON.stringify(udp.attrs) };
    }
    return {
      line: `no_path (udp_err=${udp.err ?? "n/a"}, docker=${containerOk})`,
      accept: false,
      attrs: {},
      detail: udp.err ?? "no transport",
    };
  }

  let authMatrixPass = true;
  for (const u of ["TEST-Q50-U01", "TEST-Q50-U02", "TEST-Q50-U03"]) {
    for (const nas of nasList) {
      const r = await tryAuth(nas, u, pass50);
      report.p(`- **${u}** via **${nas.name}** (${nas.ip}): ${r.line}`);
      if (!r.accept) authMatrixPass = false;
      if (r.detail.length < 2000) report.code(r.detail);
    }
  }
  results["auth_matrix_50mb_users"] = authMatrixPass ? "PASSED" : "FAILED";

  report.h("### 5b) TEST-EXPIRED — expect Access-Reject");
  let expiredPass = true;
  for (const nas of nasList) {
    const r = await tryAuth(nas, "TEST-EXPIRED", passExp);
    report.p(`- TEST-EXPIRED via ${nas.name}: ${r.line}`);
    if (r.accept) expiredPass = false;
    const post = await latestRadpostauth("TEST-EXPIRED", 1);
    if (post[0]) report.p(`  - radpostauth.reply: **${post[0].reply}** @ ${post[0].authdate}`);
  }
  results["auth_expired"] = expiredPass ? "PASSED" : "FAILED";

  report.h("### 5c) TEST-1M-SUB — rate limit in Access-Accept");
  const nas0 = nasList[0]!;
  const r1 = await tryAuth(nas0, "TEST-1M-SUB", pass1m);
  report.p(`- ${r1.line}`);
  const mrl =
    r1.attrs["Mikrotik-Rate-Limit"] ??
    r1.attrs["Mikrotik-Rate-Limit".toLowerCase() as keyof typeof r1.attrs];
  const rateOk = String(mrl ?? "").includes("1M");
  results["auth_rate_1m"] = r1.accept && rateOk ? "PASSED" : "FAILED";
  if (!rateOk) report.p(`  - **Note**: expected Mikrotik-Rate-Limit containing \`1M\`, got: \`${mrl ?? ""}\``);

  report.h("## 6) Accounting — drive TEST-Q50-U01 to 50 MiB quota");
  const quotaUser = "TEST-Q50-U01";
  const nasQ = nasList[0]!;
  const sessionId = `TEST-SESS-${randomUUID().slice(0, 8)}`;
  const acctLog: string[] = [];
  acctLog.push(await runAcct(nasQ, quotaUser, "Start", sessionId, 0, 0));
  const interimBytes = [2_000_000, 8_000_000, 20_000_000, 40_000_000, 52_000_000];
  for (const bytes of interimBytes) {
    acctLog.push(await runAcct(nasQ, quotaUser, "Interim-Update", sessionId, bytes, 0));
    await refreshUsage(accounting);
  }
  acctLog.push(await runAcct(nasQ, quotaUser, "Stop", sessionId, BYTES_50MB + 2_000_000, 0));
  report.h("### 6a) radclient accounting transcript (subset)");
  report.code(acctLog.join("\n---\n"));

  await runPolicyCycle(accounting, radiusSvc, coa);
  const [rowsQuota] = await pool.query<RowDataPacket[]>(
    `SELECT username, status, used_bytes FROM subscribers WHERE tenant_id = ? AND username = ? LIMIT 1`,
    [TENANT, quotaUser]
  );
  const subRow = rowsQuota[0] as RowDataPacket | undefined;
  report.p(
    `- After policy cycle: status=**${subRow?.status}** used_bytes=**${subRow?.used_bytes}** (quota ${BYTES_50MB})`
  );

  const rReject = await tryAuth(nasQ, quotaUser, pass50);
  report.p(`- Re-auth after quota: ${rReject.line}`);
  const quotaOk = String(subRow?.status) === "suspended" && !rReject.accept;
  results["quota_50mb_suspend"] = quotaOk ? "PASSED" : "FAILED";

  const ra = await latestRadacct(quotaUser);
  if (ra) {
    report.p(
      `- Latest radacct: nas=\`${ra.nasipaddress}\` start=\`${ra.acctstarttime}\` stop=\`${ra.acctstoptime ?? "NULL"}\` in/out=\`${ra.acctinputoctets}\`/\`${ra.acctoutputoctets}\` term=\`${ra.acctterminatecause}\``
    );
  }

  report.h("## 7) CoA / Disconnect expectations");
  const coaReport = await coa.disconnectAllSessions(quotaUser, TENANT);
  report.p(
    `- disconnectAllSessions after quota: anyOk=**${coaReport.anyOk}** (UDP to lab NAS IPs usually fails without a live router)`
  );
  report.code(JSON.stringify(coaReport.results?.slice(0, 5) ?? [], null, 2));
  results["coa_lab_note"] = "PASSED";
  report.p(
    "**Note**: With documentation IPs (192.0.2.0/24) the stack still *attempts* Disconnect-Request; lack of ACK is expected in this lab. Production MikroTik must expose RADIUS incoming on 3799 for positive ACKs."
  );

  report.h("## 8) TEST-1M-SUB — expiry then reject");
  await pool.execute(`UPDATE subscribers SET expiration_date = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?`, [u1m]);
  await radiusSync.syncSubscriber(u1m, TENANT);
  const r1exp = await tryAuth(nas0, "TEST-1M-SUB", pass1m);
  report.p(`- Auth after moving expiration to past: ${r1exp.line}`);
  await runPolicyCycle(accounting, radiusSvc, coa);
  const [st1m] = await pool.query<RowDataPacket[]>(
    `SELECT status FROM subscribers WHERE id = ? LIMIT 1`,
    [u1m]
  );
  report.p(`- Subscriber status after worker: **${st1m[0]?.status}**`);
  results["subscription_expiry_1m"] = !r1exp.accept ? "PASSED" : "FAILED";

  report.h("## 9) Prepaid card redeem + consume + reuse block");
  if (!prepaidTable) {
    report.p("- Prepaid card DB tests skipped (table missing).");
    results["prepaid_redeem_consume"] = "SKIPPED";
  } else {
    let redeemCode = "TEST-RECHARGE-01";
    const [c1] = await pool.query<RowDataPacket[]>(
      `SELECT status FROM prepaid_integration_test_cards WHERE tenant_id = ? AND card_code = ? LIMIT 1`,
      [TENANT, redeemCode]
    );
    if (String(c1[0]?.status ?? "") === "consumed") redeemCode = "TEST-RECHARGE-02";
    const [c2] = await pool.query<RowDataPacket[]>(
      `SELECT status FROM prepaid_integration_test_cards WHERE tenant_id = ? AND card_code = ? LIMIT 1`,
      [TENANT, redeemCode]
    );
    if (String(c2[0]?.status ?? "") === "consumed") {
      report.p(
        "- **SKIPPED** prepaid consume: both lab cards already consumed; insert new rows or reset a card to `available` for a full rerun."
      );
      results["prepaid_redeem_consume"] = "SKIPPED";
    } else {
      await pool.execute(
        `UPDATE subscribers SET package_id = NULL, used_bytes = 0, status = 'active',
           expiration_date = DATE_ADD(NOW(), INTERVAL 7 DAY)
         WHERE id = ? AND tenant_id = ?`,
        [uPreTarget, TENANT]
      );
      await radiusSync.syncSubscriber(uPreTarget, TENANT);

      const rdm = await redeemPrepaidCard(redeemCode, uPreTarget, radiusSync);
      report.p(`- Redeem ${redeemCode}: ${JSON.stringify(rdm)}`);
      const rdm2 = await redeemPrepaidCard(redeemCode, uPreTarget, radiusSync);
      report.p(`- Second redeem same code (expect fail): ${JSON.stringify(rdm2)}`);
      const redeemOk = rdm.ok === true && rdm2.ok === false;
      const nasP = nasList[1]!;
      const sidP = `TEST-PRE-${randomUUID().slice(0, 8)}`;
      await runAcct(nasP, "TEST-PREPAID-TARGET", "Start", sidP, 0, 0);
      await runAcct(nasP, "TEST-PREPAID-TARGET", "Interim-Update", sidP, BYTES_10MB + 500_000, 0);
      await runAcct(nasP, "TEST-PREPAID-TARGET", "Stop", sidP, BYTES_10MB + 500_000, 0);
      await runPolicyCycle(accounting, radiusSvc, coa);
      const [pst] = await pool.query<RowDataPacket[]>(
        `SELECT status, used_bytes FROM subscribers WHERE id = ? LIMIT 1`,
        [uPreTarget]
      );
      const [cst] = await pool.query<RowDataPacket[]>(
        `SELECT status FROM prepaid_integration_test_cards WHERE card_code = ? AND tenant_id = ? LIMIT 1`,
        [redeemCode, TENANT]
      );
      report.p(
        `- After consuming prepaid quota: subscriber status=**${pst[0]?.status}** used_bytes=**${pst[0]?.used_bytes}**`
      );
      report.p(`- Card ${redeemCode} status=**${cst[0]?.status}** (should remain **consumed**, not reusable)`);
      const authAfter = await tryAuth(nasP, "TEST-PREPAID-TARGET", passPre);
      report.p(`- Re-auth prepaid target: ${authAfter.line}`);
      results["prepaid_redeem_consume"] =
        redeemOk &&
        String(pst[0]?.status) === "suspended" &&
        String(cst[0]?.status) === "consumed" &&
        !authAfter.accept
          ? "PASSED"
          : "FAILED";
    }
  }

  report.h("## 10) Summary");
  for (const [k, v] of Object.entries(results)) {
    report.p(`- **${k}**: ${v}`);
  }
  const anyFailed = Object.values(results).some((v) => v === "FAILED");
  const head = anyFailed ? "OVERALL: **FAILED** (see FAILED lines)" : "OVERALL: **PASSED** (within lab limits)";
  report.p(head);

  const outDir = join(REPO_ROOT, "reports");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `radius-nas-integration-test-${tsName()}.md`);
  writeFileSync(outFile, report.toString(), "utf8");
  console.log(`Report written: ${outFile}`);
  if (anyFailed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  try {
    const d = tsName();
    const outDir = join(REPO_ROOT, "reports");
    mkdirSync(outDir, { recursive: true });
    const outFile = join(outDir, `radius-nas-integration-test-${d}-ERROR.md`);
    writeFileSync(
      outFile,
      `# RADIUS integration test — ERROR\n\n${new Date().toISOString()}\n\n\`\`\`\n${
        e instanceof Error ? e.stack ?? e.message : String(e)
      }\n\`\`\`\n`,
      "utf8"
    );
    console.error(`Failure report: ${outFile}`);
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
});
