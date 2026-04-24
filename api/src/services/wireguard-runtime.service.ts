import { createPrivateKey, createPublicKey, randomBytes, randomUUID } from "crypto";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";
import { encryptSecret, tryDecryptSecret } from "./crypto.service.js";
import { getSystemSettings, updateSystemSettings } from "./system-settings.service.js";

type KeyPair = { privateKey: string; publicKey: string };
type Ipv4Cidr = { address: number; network: number; prefix: number };

const X25519_PKCS8_PRIVATE_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

function keyObjectToWireGuardKey(key: Buffer): string {
  return key.subarray(key.length - 32).toString("base64");
}

export function deriveWireGuardPublicKey(privateKey: string): string | null {
  const rawPrivateKey = Buffer.from(String(privateKey ?? "").trim(), "base64");
  if (rawPrivateKey.length !== 32) return null;
  const keyObject = createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PRIVATE_PREFIX, rawPrivateKey]),
    format: "der",
    type: "pkcs8",
  });
  return keyObjectToWireGuardKey(createPublicKey(keyObject).export({ type: "spki", format: "der" }) as Buffer);
}

export function generateWireGuardKeyPair(): KeyPair {
  const privateKey = randomBytes(32);
  privateKey[0] &= 248;
  privateKey[31] &= 127;
  privateKey[31] |= 64;
  const privateKeyBase64 = privateKey.toString("base64");
  const publicKey = deriveWireGuardPublicKey(privateKeyBase64);
  if (!publicKey) throw new Error("wireguard_key_generation_failed");
  return {
    privateKey: privateKeyBase64,
    publicKey,
  };
}

function ipToInt(ip: string): number {
  const p = ip.split(".").map((v) => Number(v));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return -1;
  return (((p[0] << 24) >>> 0) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function intToIp(n: number): string {
  const v = n >>> 0;
  return `${(v >>> 24) & 255}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`;
}

function parseCidr(raw: string): Ipv4Cidr | null {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m) return null;
  const address = ipToInt(m[1]);
  const prefix = Number(m[2]);
  if (address < 0 || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return { address, network: (address & mask) >>> 0, prefix };
}

export function isWireGuardTunnelIp(raw: string): boolean {
  const value = String(raw ?? "").trim();
  if (!value) return false;
  if (value.includes("/")) return parseCidr(value) !== null;
  return ipToInt(value) >= 0;
}

function networkCidr(raw: string): string {
  const cidr = parseCidr(raw);
  if (!cidr) return "10.20.0.0/24";
  return `${intToIp(cidr.network)}/${cidr.prefix}`;
}

function ipWithPrefix(ip: string): string {
  const value = String(ip ?? "").trim();
  if (!isWireGuardTunnelIp(value)) return "10.20.0.2/32";
  return value.includes("/") ? value : `${value}/32`;
}

function safeClientFileName(username: string): string {
  return username.replace(/[^a-zA-Z0-9_.-]/g, "_") || randomUUID();
}

export async function ensureWireGuardServerKeys(tenantId: string): Promise<KeyPair> {
  const settings = await getSystemSettings(tenantId);
  if (settings.wireguard_server_private_key && settings.wireguard_server_public_key) {
    const derivedPublicKey = deriveWireGuardPublicKey(settings.wireguard_server_private_key);
    if (derivedPublicKey && derivedPublicKey !== settings.wireguard_server_public_key) {
      await updateSystemSettings(tenantId, {
        ...settings,
        wireguard_server_public_key: derivedPublicKey,
      });
      return {
        privateKey: settings.wireguard_server_private_key,
        publicKey: derivedPublicKey,
      };
    }
    return {
      privateKey: settings.wireguard_server_private_key,
      publicKey: settings.wireguard_server_public_key,
    };
  }
  const nextKeys = generateWireGuardKeyPair();
  await updateSystemSettings(tenantId, {
    ...settings,
    wireguard_server_public_key: nextKeys.publicKey,
    wireguard_server_private_key: nextKeys.privateKey,
  });
  return nextKeys;
}

export async function allocateWireGuardPeerIp(tenantId: string): Promise<string> {
  const settings = await getSystemSettings(tenantId);
  const cidr = parseCidr(settings.wireguard_interface_cidr);
  if (!cidr || cidr.prefix >= 31) return "10.20.0.2";
  const used = new Set<number>([cidr.address]);
  if (await hasTable(pool, "wireguard_peers")) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT tunnel_ip FROM wireguard_peers WHERE tenant_id = ?`,
      [tenantId]
    );
    for (const row of rows) {
      const parsed = ipToInt(String(row.tunnel_ip ?? "").replace(/\/\d+$/, ""));
      if (parsed >= 0) used.add(parsed);
    }
  }
  const last = (cidr.network + 2 ** (32 - cidr.prefix) - 2) >>> 0;
  for (let candidate = (cidr.network + 2) >>> 0; candidate <= last; candidate += 1) {
    if (!used.has(candidate)) return intToIp(candidate);
  }
  throw new Error("wireguard_ip_pool_exhausted");
}

export async function syncWireGuardRuntime(tenantId: string): Promise<void> {
  const runtimeDir = process.env.WIREGUARD_RUNTIME_DIR || "/app/runtime/wireguard";
  const clientsDir = path.join(runtimeDir, "clients");
  await mkdir(clientsDir, { recursive: true });

  const settings = await getSystemSettings(tenantId);
  const serverKeys = await ensureWireGuardServerKeys(tenantId);
  const port = Math.max(1, Math.min(65535, Number(settings.wireguard_server_port || 51820)));
  const vpnCidr = networkCidr(settings.wireguard_interface_cidr);

  const peers: Array<{
    id: string;
    username: string;
    publicKey: string;
    privateKey: string;
    tunnelIp: string;
    allowedIps: string;
    isActive: boolean;
  }> = [];
  if (await hasTable(pool, "wireguard_peers")) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, username, public_key, private_key_encrypted, tunnel_ip, allowed_ips, is_active
       FROM wireguard_peers
       WHERE tenant_id = ?
       ORDER BY username ASC`,
      [tenantId]
    );
    for (const row of rows) {
      const username = String(row.username ?? "").trim();
      const publicKey = String(row.public_key ?? "").trim();
      const tunnelIp = String(row.tunnel_ip ?? "").trim();
      const privateBlob = row.private_key_encrypted as Buffer | Uint8Array | null | undefined;
      const privateKey = privateBlob ? (tryDecryptSecret(Buffer.from(privateBlob)) ?? "") : "";
      const derivedPublicKey = privateKey ? deriveWireGuardPublicKey(privateKey) : null;
      if (derivedPublicKey && derivedPublicKey !== publicKey) {
        await pool.execute(`UPDATE wireguard_peers SET public_key = ? WHERE id = ? AND tenant_id = ?`, [
          derivedPublicKey,
          String(row.id),
          tenantId,
        ]);
      }
      if (!username || !(derivedPublicKey || publicKey) || !isWireGuardTunnelIp(tunnelIp) || !privateKey) continue;
      peers.push({
        id: String(row.id),
        username,
        publicKey: derivedPublicKey || publicKey,
        privateKey,
        tunnelIp,
        allowedIps: String(row.allowed_ips ?? "").trim() || vpnCidr,
        isActive: Boolean(Number(row.is_active ?? 0)),
      });
    }
  }

  const serverLines = [
    "[Interface]",
    `Address = ${settings.wireguard_interface_cidr || "10.20.0.1/24"}`,
    `ListenPort = ${port}`,
    `PrivateKey = ${serverKeys.privateKey}`,
    "SaveConfig = false",
    `PostUp = sysctl -w net.ipv4.ip_forward=1; iptables -t nat -C POSTROUTING -s ${vpnCidr} -o \${WIREGUARD_NAT_INTERFACE:-eth0} -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s ${vpnCidr} -o \${WIREGUARD_NAT_INTERFACE:-eth0} -j MASQUERADE`,
    `PostDown = iptables -t nat -D POSTROUTING -s ${vpnCidr} -o \${WIREGUARD_NAT_INTERFACE:-eth0} -j MASQUERADE 2>/dev/null || true`,
    "",
  ];

  for (const peer of peers.filter((p) => p.isActive)) {
    serverLines.push("[Peer]", `# ${peer.username}`, `PublicKey = ${peer.publicKey}`, `AllowedIPs = ${ipWithPrefix(peer.tunnelIp)}`, "");
  }

  await rm(clientsDir, { recursive: true, force: true });
  await mkdir(clientsDir, { recursive: true });

  const endpointHost = String(settings.wireguard_server_host ?? "").trim() || "YOUR_SERVER_IP";
  const dns = String(settings.wireguard_client_dns ?? "").trim();
  const keepalive = Math.max(0, Math.min(300, Number(settings.wireguard_persistent_keepalive || 25)));
  for (const peer of peers) {
    const clientLines = [
      "[Interface]",
      `PrivateKey = ${peer.privateKey}`,
      `Address = ${ipWithPrefix(peer.tunnelIp)}`,
    ];
    if (dns) clientLines.push(`DNS = ${dns}`);
    clientLines.push(
      "",
      "[Peer]",
      `PublicKey = ${serverKeys.publicKey}`,
      `Endpoint = ${endpointHost}:${port}`,
      `AllowedIPs = ${peer.allowedIps || vpnCidr}`
    );
    if (keepalive > 0) clientLines.push(`PersistentKeepalive = ${keepalive}`);
    await writeFile(path.join(clientsDir, `${safeClientFileName(peer.username)}.conf`), `${clientLines.join("\n")}\n`, "utf8");
  }

  const state = [
    `WIREGUARD_ENABLED=${settings.wireguard_vpn_enabled ? "1" : "0"}`,
    `WIREGUARD_PORT=${port}`,
  ];

  await Promise.all([
    writeFile(path.join(runtimeDir, "wg0.conf"), `${serverLines.join("\n")}\n`, "utf8"),
    writeFile(path.join(runtimeDir, "wireguard-state.env"), `${state.join("\n")}\n`, "utf8"),
  ]);
}

export function encryptWireGuardPrivateKey(privateKey: string): Buffer {
  return encryptSecret(privateKey.trim());
}
