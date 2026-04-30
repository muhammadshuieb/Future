import { randomUUID } from "crypto";
import { readFile, stat } from "fs/promises";
import path from "path";
import { Router } from "express";
import type { Request } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";
import { requireAuth } from "../middleware/auth.js";
import { routePolicy } from "../middleware/policy.js";
import { tryDecryptSecret } from "../services/crypto.service.js";
import { getSystemSettings, updateSystemSettings } from "../services/system-settings.service.js";
import {
  allocateWireGuardPeerIp,
  encryptWireGuardPrivateKey,
  generateWireGuardKeyPair,
  isWireGuardTunnelIp,
  syncWireGuardRuntime,
} from "../services/wireguard-runtime.service.js";

const router = Router();
router.use(requireAuth);

const configSchema = z.object({
  wireguard_vpn_enabled: z.boolean(),
  wireguard_server_host: z.string().max(128),
  wireguard_server_port: z.number().int().min(1).max(65535),
  wireguard_interface_cidr: z.string().max(64),
  wireguard_client_dns: z.string().max(128),
  wireguard_persistent_keepalive: z.number().int().min(0).max(300),
});

const peerCreateSchema = z.object({
  username: z.string().trim().min(1).max(128),
  tunnel_ip: z.string().trim().max(64).optional(),
  allowed_ips: z.string().trim().max(255).optional(),
  note: z.string().trim().max(255).optional(),
  is_active: z.boolean().optional(),
});

const peerUpdateSchema = peerCreateSchema.partial();
type PeerConnectionStatus = {
  status: "connected" | "waiting" | "unknown";
  latest_handshake_at: string | null;
  latest_handshake_seconds_ago: number | null;
  endpoint: string | null;
  rx_bytes: number;
  tx_bytes: number;
};

async function ensureWireGuardPeersTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wireguard_peers (
      id CHAR(36) NOT NULL,
      tenant_id CHAR(36) NOT NULL,
      username VARCHAR(128) NOT NULL,
      public_key VARCHAR(64) NOT NULL,
      private_key_encrypted VARBINARY(512) NOT NULL,
      tunnel_ip VARCHAR(64) DEFAULT NULL,
      allowed_ips VARCHAR(255) DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      note VARCHAR(255) DEFAULT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_wireguard_peers_tenant (tenant_id),
      KEY idx_wireguard_peers_username (username),
      KEY idx_wireguard_peers_tunnel_ip (tunnel_ip)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function publicConfig(settings: Awaited<ReturnType<typeof getSystemSettings>>, inferredHost = "") {
  return {
    wireguard_vpn_enabled: settings.wireguard_vpn_enabled,
    wireguard_server_host: settings.wireguard_server_host || inferredHost,
    wireguard_server_port: settings.wireguard_server_port,
    wireguard_interface_cidr: settings.wireguard_interface_cidr,
    wireguard_client_dns: settings.wireguard_client_dns,
    wireguard_persistent_keepalive: settings.wireguard_persistent_keepalive,
    wireguard_server_public_key: settings.wireguard_server_public_key,
    wireguard_server_private_key_set: settings.wireguard_server_private_key_set,
  };
}

function stripPort(host: string): string {
  const value = String(host ?? "").trim();
  if (!value) return "";
  if (value.startsWith("[")) return value.replace(/^\[|\](?::\d+)?$/g, "");
  return value.split(":")[0] ?? "";
}

function inferServerHost(req: Request): string {
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "").split(",")[0]?.trim() ?? "";
  const host = forwardedHost || String(req.headers.host ?? "");
  const fromHost = stripPort(host);
  if (fromHost) return fromHost;

  const origin = String(req.headers.origin ?? req.headers.referer ?? "");
  if (!origin) return "";
  try {
    return new URL(origin).hostname;
  } catch {
    return "";
  }
}

function resolveEndpointHost(req: Request, settings: Awaited<ReturnType<typeof getSystemSettings>>): string {
  return settings.wireguard_server_host || inferServerHost(req) || "YOUR_SERVER_IP";
}

function routerOsName(value: string): string {
  return String(value ?? "wireguard-peer").replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 40) || "wireguard-peer";
}

function routerOsQuote(value: string): string {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function addressWithInterfacePrefix(value: string, interfaceCidr: string): string {
  const ip = String(value ?? "").trim().replace(/\/\d+$/, "");
  const prefix = String(interfaceCidr ?? "").trim().split("/")[1] || "24";
  return `${ip}/${prefix}`;
}

function defaultAllowedIps(row: RowDataPacket, settings: Awaited<ReturnType<typeof getSystemSettings>>): string {
  return String(row.allowed_ips ?? "").trim() || settings.wireguard_interface_cidr.replace(/\.\d+\/(\d+)$/, ".0/$1") || "10.20.0.0/24";
}

/** نفس تنسيق تصدير MikroTik / ملف ‎.conf الافتراضي للعميل (للتنزيل أو لأدوات سطح المكتب). */
function buildWireGuardClientConfText(params: {
  privateKey: string;
  tunnelIp: string;
  allowedIps: string;
  settings: Awaited<ReturnType<typeof getSystemSettings>>;
  endpoint: string;
}): string {
  const { privateKey, tunnelIp, allowedIps, settings, endpoint } = params;
  const lines: string[] = [
    "[Interface]",
    `PrivateKey = ${privateKey}`,
    `Address = ${tunnelIp.includes("/") ? tunnelIp : `${tunnelIp}/32`}`,
  ];
  if (String(settings.wireguard_client_dns ?? "").trim()) {
    lines.push(`DNS = ${settings.wireguard_client_dns}`);
  }
  const allowed = String(allowedIps ?? "").trim() || "10.20.0.0/24";
  lines.push(
    "",
    "[Peer]",
    `PublicKey = ${settings.wireguard_server_public_key}`,
    `Endpoint = ${endpoint}`,
    `AllowedIPs = ${allowed}`,
    `PersistentKeepalive = ${settings.wireguard_persistent_keepalive}`
  );
  return `${lines.join("\n")}\n`;
}

async function readStatusFile(
  name: "peer-status" | "peer-ping"
): Promise<{ text: string; mtimeMs: number } | null> {
  const runtimeDir = process.env.WIREGUARD_RUNTIME_DIR || "/app/runtime/wireguard";
  const fileName = name === "peer-status" ? "peer-status.tsv" : "peer-ping.tsv";
  const p = path.join(runtimeDir, fileName);
  try {
    const [text, s] = await Promise.all([readFile(p, "utf8"), stat(p)]);
    return { text, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

function applyPeerPing(base: PeerConnectionStatus, options: { pingOk: boolean | null; wgStale: boolean }): PeerConnectionStatus {
  if (base.status === "connected" && !options.wgStale) {
    return base;
  }
  if (options.pingOk === true) {
    return { ...base, status: "connected" };
  }
  if (options.pingOk === false) {
    if (options.wgStale) {
      return { ...base, status: "unknown" };
    }
    if (base.status === "connected") {
      return base;
    }
    return { ...base, status: "waiting" };
  }
  if (options.wgStale) {
    return { ...base, status: "unknown" };
  }
  return base;
}

type PeerStatusMaps = {
  byPublicKey: Map<string, PeerConnectionStatus>;
  byTunnelIp: Map<string, PeerConnectionStatus>;
};

/**
 * يقرأ ‎peer-status.tsv من سيرفر WireGuard (نفس ‎wireguard_runtime volume).
 * المطابقة حسب ‎public_key؛ وإن اختلف المفتاح (مثلاً بعد تغييره على المايكروتك) نطابق بعنوان النفق ‎/32.
 */
async function readPeerConnectionStatuses(): Promise<PeerStatusMaps> {
  const empty = (): PeerStatusMaps => ({ byPublicKey: new Map(), byTunnelIp: new Map() });
  const [wgFile, pingFile] = await Promise.all([readStatusFile("peer-status"), readStatusFile("peer-ping")]);
  const pingIps = new Set<string>();
  const pingIsFresh = !!pingFile && Date.now() - pingFile.mtimeMs <= 60_000;
  if (pingFile?.text) {
    for (const line of pingFile.text.split(/\r?\n/)) {
      const ip = line.trim();
      if (ip) pingIps.add(ip);
    }
  }

  if (!wgFile) {
    return empty();
  }
  /** ملف ‎tsv يُحدَّث كل ~3s؛ نفسح أطول ليتجنّب «غير معروف» عند تعارض ‎NTP أو ‎I/O. */
  const wgStale = Date.now() - wgFile.mtimeMs > 90_000;
  const byPublicKey = new Map<string, PeerConnectionStatus>();
  const byTunnelIp = new Map<string, PeerConnectionStatus>();
  for (const line of wgFile.text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 4) continue;
    const [publicKey, allowed, latestHandshakeRaw, rxRaw, txRaw, endpointRaw] = parts;
    const latestHandshake = Number(latestHandshakeRaw || 0);
    const secondsAgo = latestHandshake > 0 ? Math.max(0, Math.floor(Date.now() / 1000) - latestHandshake) : null;
    const firstAllowed = String(allowed ?? "").split(",")[0]?.trim() ?? "";
    const peerIp = firstAllowed.replace(/\/\d+$/, "");
    const rx = Number(rxRaw || 0);
    const tx = Number(txRaw || 0);
    const hasTraffic = rx + tx > 0;
    const hasHandshake = latestHandshake > 0;
    const pingOk: boolean | null = !pingIsFresh
      ? null
      : peerIp
        ? pingIps.has(peerIp)
        : null;
    const base: PeerConnectionStatus = wgStale
      ? {
          status: "unknown",
          latest_handshake_at: latestHandshake > 0 ? new Date(latestHandshake * 1000).toISOString() : null,
          latest_handshake_seconds_ago: secondsAgo,
          endpoint: endpointRaw && endpointRaw !== "(none)" ? endpointRaw : null,
          rx_bytes: rx,
          tx_bytes: tx,
        }
      : {
          status: hasHandshake || hasTraffic ? "connected" : "waiting",
          latest_handshake_at: latestHandshake > 0 ? new Date(latestHandshake * 1000).toISOString() : null,
          latest_handshake_seconds_ago: secondsAgo,
          endpoint: endpointRaw && endpointRaw !== "(none)" ? endpointRaw : null,
          rx_bytes: rx,
          tx_bytes: tx,
        };
    const status = applyPeerPing(base, { pingOk, wgStale });
    const keyNorm = String(publicKey ?? "").trim();
    if (keyNorm) {
      byPublicKey.set(keyNorm, status);
    }
    if (peerIp) {
      byTunnelIp.set(peerIp, status);
    }
  }
  return { byPublicKey, byTunnelIp };
}

function resolvePeerRowStatus(
  row: RowDataPacket,
  maps: PeerStatusMaps
): PeerConnectionStatus {
  const pk = String(row.public_key ?? "").trim();
  if (pk && maps.byPublicKey.has(pk)) {
    return maps.byPublicKey.get(pk)!;
  }
  const tip = String(row.tunnel_ip ?? "")
    .trim()
    .replace(/\/\d+$/, "");
  if (tip && maps.byTunnelIp.has(tip)) {
    return maps.byTunnelIp.get(tip)!;
  }
  return {
    status: "unknown",
    latest_handshake_at: null,
    latest_handshake_seconds_ago: null,
    endpoint: null,
    rx_bytes: 0,
    tx_bytes: 0,
  };
}

router.get("/config", routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }), async (req, res) => {
  try {
    await syncWireGuardRuntime(req.auth!.tenantId);
    const settings = await getSystemSettings(req.auth!.tenantId);
    res.json({ config: publicConfig(settings, inferServerHost(req)) });
  } catch (e) {
    console.error("wireguard config get", e);
    res.status(500).json({ error: "wireguard_config_failed" });
  }
});

router.put("/config", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const cur = await getSystemSettings(req.auth!.tenantId);
    await updateSystemSettings(req.auth!.tenantId, {
      ...cur,
      ...parsed.data,
      wireguard_server_public_key: cur.wireguard_server_public_key,
    });
    await syncWireGuardRuntime(req.auth!.tenantId);
    const next = await getSystemSettings(req.auth!.tenantId);
    res.json({ config: publicConfig(next, inferServerHost(req)) });
  } catch (e) {
    console.error("wireguard config put", e);
    res.status(500).json({ error: "wireguard_config_save_failed" });
  }
});

router.get("/peers", routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }), async (req, res) => {
  try {
    await ensureWireGuardPeersTable();
    await syncWireGuardRuntime(req.auth!.tenantId);
    if (!(await hasTable(pool, "wireguard_peers"))) {
      res.json({ peers: [] });
      return;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, username, public_key, tunnel_ip, allowed_ips, is_active, note, updated_at
       FROM wireguard_peers
       WHERE tenant_id = ?
       ORDER BY username ASC`,
      [req.auth!.tenantId]
    );
    const statusMaps = await readPeerConnectionStatuses();
    res.json({
      peers: rows.map((row) => ({
        ...row,
        connection: resolvePeerRowStatus(row, statusMaps),
      })),
    });
  } catch (e) {
    console.error("wireguard peers get", e);
    res.status(500).json({ error: "wireguard_peers_failed" });
  }
});

router.post("/peers", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  const parsed = peerCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    await ensureWireGuardPeersTable();
    if (!(await hasTable(pool, "wireguard_peers"))) {
      res.status(503).json({ error: "wireguard_peers_table_missing" });
      return;
    }
    const keys = generateWireGuardKeyPair();
    const id = randomUUID();
    const requestedTunnelIp = parsed.data.tunnel_ip?.trim() || "";
    if (requestedTunnelIp && !isWireGuardTunnelIp(requestedTunnelIp)) {
      res.status(400).json({ error: "invalid_tunnel_ip" });
      return;
    }
    const tunnelIp = requestedTunnelIp || (await allocateWireGuardPeerIp(req.auth!.tenantId));
    await pool.execute(
      `INSERT INTO wireguard_peers
       (id, tenant_id, username, public_key, private_key_encrypted, tunnel_ip, allowed_ips, is_active, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.auth!.tenantId,
        parsed.data.username,
        keys.publicKey,
        encryptWireGuardPrivateKey(keys.privateKey),
        tunnelIp,
        parsed.data.allowed_ips?.trim() || null,
        parsed.data.is_active === false ? 0 : 1,
        parsed.data.note?.trim() || null,
      ]
    );
    await syncWireGuardRuntime(req.auth!.tenantId);
    res.json({ ok: true, id });
  } catch (e) {
    console.error("wireguard peers post", e);
    res.status(500).json({ error: "wireguard_peer_create_failed" });
  }
});

router.patch("/peers/:id", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  const parsed = peerUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const sets: string[] = [];
    const vals: Array<string | number | null> = [];
    if (parsed.data.username !== undefined) {
      sets.push("username = ?");
      vals.push(parsed.data.username);
    }
    if (parsed.data.tunnel_ip !== undefined) {
      if (parsed.data.tunnel_ip.trim() && !isWireGuardTunnelIp(parsed.data.tunnel_ip)) {
        res.status(400).json({ error: "invalid_tunnel_ip" });
        return;
      }
      sets.push("tunnel_ip = ?");
      vals.push(parsed.data.tunnel_ip.trim());
    }
    if (parsed.data.allowed_ips !== undefined) {
      sets.push("allowed_ips = ?");
      vals.push(parsed.data.allowed_ips.trim() || null);
    }
    if (parsed.data.note !== undefined) {
      sets.push("note = ?");
      vals.push(parsed.data.note.trim() || null);
    }
    if (parsed.data.is_active !== undefined) {
      sets.push("is_active = ?");
      vals.push(parsed.data.is_active ? 1 : 0);
    }
    if (!sets.length) {
      res.status(400).json({ error: "nothing_to_update" });
      return;
    }
    await pool.execute(
      `UPDATE wireguard_peers SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`,
      [...vals, String(req.params.id), req.auth!.tenantId]
    );
    await syncWireGuardRuntime(req.auth!.tenantId);
    res.json({ ok: true });
  } catch (e) {
    console.error("wireguard peers patch", e);
    res.status(500).json({ error: "wireguard_peer_update_failed" });
  }
});

router.delete("/peers/:id", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  try {
    if (await hasTable(pool, "wireguard_peers")) {
      await pool.execute(`DELETE FROM wireguard_peers WHERE id = ? AND tenant_id = ?`, [
        String(req.params.id),
        req.auth!.tenantId,
      ]);
    }
    await syncWireGuardRuntime(req.auth!.tenantId);
    res.json({ ok: true });
  } catch (e) {
    console.error("wireguard peers delete", e);
    res.status(500).json({ error: "wireguard_peer_delete_failed" });
  }
});

router.get("/peers/:id/config", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  try {
    await syncWireGuardRuntime(req.auth!.tenantId);
    const settings = await getSystemSettings(req.auth!.tenantId);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT username, private_key_encrypted, tunnel_ip, allowed_ips
       FROM wireguard_peers
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [String(req.params.id), req.auth!.tenantId]
    );
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const privateKey = tryDecryptSecret(Buffer.from(row.private_key_encrypted as Buffer)) ?? "";
    let tunnelIp = String(row.tunnel_ip ?? "").trim();
    if (!isWireGuardTunnelIp(tunnelIp)) {
      tunnelIp = await allocateWireGuardPeerIp(req.auth!.tenantId);
      await pool.execute(`UPDATE wireguard_peers SET tunnel_ip = ? WHERE id = ? AND tenant_id = ?`, [
        tunnelIp,
        String(req.params.id),
        req.auth!.tenantId,
      ]);
      await syncWireGuardRuntime(req.auth!.tenantId);
    }
    const endpoint = `${resolveEndpointHost(req, settings)}:${settings.wireguard_server_port}`;
    const configText = buildWireGuardClientConfText({
      privateKey,
      tunnelIp,
      allowedIps: defaultAllowedIps(row, settings),
      settings,
      endpoint,
    });
    res.json({ username: String(row.username ?? ""), config: configText });
  } catch (e) {
    console.error("wireguard peer config get", e);
    res.status(500).json({ error: "wireguard_peer_config_failed" });
  }
});

router.get("/peers/:id/mikrotik-commands", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  try {
    await syncWireGuardRuntime(req.auth!.tenantId);
    const settings = await getSystemSettings(req.auth!.tenantId);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT username, private_key_encrypted, tunnel_ip, allowed_ips
       FROM wireguard_peers
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [String(req.params.id), req.auth!.tenantId]
    );
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const privateKey = tryDecryptSecret(Buffer.from(row.private_key_encrypted as Buffer)) ?? "";
    let tunnelIp = String(row.tunnel_ip ?? "").trim();
    if (!isWireGuardTunnelIp(tunnelIp)) {
      tunnelIp = await allocateWireGuardPeerIp(req.auth!.tenantId);
      await pool.execute(`UPDATE wireguard_peers SET tunnel_ip = ? WHERE id = ? AND tenant_id = ?`, [
        tunnelIp,
        String(req.params.id),
        req.auth!.tenantId,
      ]);
      await syncWireGuardRuntime(req.auth!.tenantId);
    }
    const endpoint = `${resolveEndpointHost(req, settings)}:${settings.wireguard_server_port}`;
    const [endpointHost, endpointPort] = endpoint.split(":");
    const interfaceName = `wg-${routerOsName(String(row.username ?? "future")).toLowerCase()}`;
    const keepalive = Math.max(0, Math.min(300, Number(settings.wireguard_persistent_keepalive || 25)));
    const lines = [
      "/interface wireguard",
      [
        "add",
        `name=${routerOsQuote(interfaceName)}`,
        "listen-port=13231",
        `private-key=${routerOsQuote(privateKey)}`,
        "disabled=no",
      ].join(" "),
      "",
      "/ip address",
      `add address=${addressWithInterfacePrefix(tunnelIp, settings.wireguard_interface_cidr)} interface=${routerOsQuote(interfaceName)}`,
      "",
      "/interface wireguard peers",
      [
        "add",
        `interface=${routerOsQuote(interfaceName)}`,
        `public-key=${routerOsQuote(settings.wireguard_server_public_key)}`,
        `endpoint-address=${endpointHost}`,
        `endpoint-port=${endpointPort || settings.wireguard_server_port}`,
        `allowed-address=${defaultAllowedIps(row, settings)}`,
        keepalive > 0 ? `persistent-keepalive=${keepalive}s` : "",
        "disabled=no",
      ].filter(Boolean).join(" "),
    ];
    const wireguardConf = buildWireGuardClientConfText({
      privateKey,
      tunnelIp,
      allowedIps: defaultAllowedIps(row, settings),
      settings,
      endpoint,
    });
    res.json({
      username: String(row.username ?? ""),
      interfaceName,
      wireguard_conf: wireguardConf,
      commands: `${lines.join("\n")}\n`,
    });
  } catch (e) {
    console.error("wireguard mikrotik commands get", e);
    res.status(500).json({ error: "wireguard_mikrotik_commands_failed" });
  }
});

export default router;
