import { randomUUID } from "crypto";
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

function routerOsQuote(value: string): string {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function routerOsName(value: string): string {
  return String(value ?? "wireguard-peer").replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 40) || "wireguard-peer";
}

function addressWithPrefix(value: string): string {
  const trimmed = String(value ?? "").trim();
  return trimmed.includes("/") ? trimmed : `${trimmed}/32`;
}

function addressWithInterfacePrefix(value: string, interfaceCidr: string): string {
  const ip = String(value ?? "").trim().replace(/\/\d+$/, "");
  const prefix = String(interfaceCidr ?? "").trim().split("/")[1] || "24";
  return `${ip}/${prefix}`;
}

function defaultAllowedIps(row: RowDataPacket, settings: Awaited<ReturnType<typeof getSystemSettings>>): string {
  return String(row.allowed_ips ?? "").trim() || settings.wireguard_interface_cidr.replace(/\.\d+\/(\d+)$/, ".0/$1") || "10.20.0.0/24";
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
    res.json({ peers: rows });
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
    const lines = [
      "[Interface]",
      `PrivateKey = ${privateKey}`,
      `Address = ${tunnelIp.includes("/") ? tunnelIp : `${tunnelIp}/32`}`,
    ];
    if (settings.wireguard_client_dns) lines.push(`DNS = ${settings.wireguard_client_dns}`);
    lines.push(
      "",
      "[Peer]",
      `PublicKey = ${settings.wireguard_server_public_key}`,
      `Endpoint = ${endpoint}`,
      `AllowedIPs = ${String(row.allowed_ips ?? "").trim() || "10.20.0.0/24"}`,
      `PersistentKeepalive = ${settings.wireguard_persistent_keepalive}`
    );
    res.json({ username: String(row.username ?? ""), config: `${lines.join("\n")}\n` });
  } catch (e) {
    console.error("wireguard peer config get", e);
    res.status(500).json({ error: "wireguard_peer_config_failed" });
  }
});

router.get("/peers/:id/mikrotik-conf", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  try {
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
    const lines = [
      "[Interface]",
      `PrivateKey = ${privateKey}`,
      `Address = ${addressWithInterfacePrefix(tunnelIp, settings.wireguard_interface_cidr)}`,
    ];
    if (settings.wireguard_client_dns) lines.push(`DNS = ${settings.wireguard_client_dns}`);
    lines.push(
      "",
      "[Peer]",
      `PublicKey = ${settings.wireguard_server_public_key}`,
      `Endpoint = ${endpoint}`,
      `AllowedIPs = ${defaultAllowedIps(row, settings)}`,
      `PersistentKeepalive = ${settings.wireguard_persistent_keepalive}`
    );
    res.json({
      username: String(row.username ?? ""),
      filename: `${routerOsName(String(row.username ?? "wireguard"))}-wireguard.conf`,
      config: `${lines.join("\n")}\n`,
    });
  } catch (e) {
    console.error("wireguard mikrotik wg import get", e);
    res.status(500).json({ error: "wireguard_mikrotik_conf_failed" });
  }
});

router.get("/peers/:id/mikrotik", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  try {
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
    const interfaceName = `wg-${routerOsName(String(row.username ?? "future")).toLowerCase()}`;
    const endpointHost = resolveEndpointHost(req, settings);
    const endpointPort = settings.wireguard_server_port;
    const allowedIps = defaultAllowedIps(row, settings);
    const keepalive = Math.max(0, Math.min(300, Number(settings.wireguard_persistent_keepalive || 25)));
    const lines = [
      "# Future Radius - MikroTik WireGuard setup",
      "# Import this file in MikroTik Terminal or via Files > Import.",
      `:local wgName ${routerOsQuote(interfaceName)}`,
      "",
      "/interface wireguard",
      `add name=$wgName private-key=${routerOsQuote(privateKey)} disabled=no`,
      "",
      "/ip address",
      `add address=${addressWithPrefix(tunnelIp)} interface=$wgName comment=${routerOsQuote("Future Radius WireGuard")}`,
      "",
      "/interface wireguard peers",
      [
        "add",
        "interface=$wgName",
        `public-key=${routerOsQuote(settings.wireguard_server_public_key)}`,
        `endpoint-address=${routerOsQuote(endpointHost)}`,
        `endpoint-port=${endpointPort}`,
        `allowed-address=${allowedIps}`,
        keepalive > 0 ? `persistent-keepalive=${keepalive}s` : "",
        "disabled=no",
      ].filter(Boolean).join(" "),
      "",
      "/ip route",
      `add dst-address=${allowedIps} gateway=$wgName comment=${routerOsQuote("Future Radius WireGuard route")}`,
      "",
      "# After import, test with: /ping 10.20.0.1",
      "# In Future Radius NAS page, set WireGuard tunnel address to this device IP:",
      `# ${tunnelIp.replace(/\/\d+$/, "")}`,
      "",
    ];
    res.json({
      username: String(row.username ?? ""),
      filename: `${routerOsName(String(row.username ?? "wireguard"))}-wireguard.rsc`,
      script: lines.join("\n"),
    });
  } catch (e) {
    console.error("wireguard mikrotik config get", e);
    res.status(500).json({ error: "wireguard_mikrotik_config_failed" });
  }
});

export default router;
