import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";
import { getSystemSettings } from "./system-settings.service.js";
import { tryDecryptSecret } from "./crypto.service.js";

type Ipv4Cidr = {
  network: number;
  prefix: number;
};

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
  const base = ipToInt(m[1]);
  const prefix = Number(m[2]);
  if (base < 0 || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  const network = (base & mask) >>> 0;
  return { network, prefix };
}

function deriveLocalIp(localNetworkCidr: string): string {
  const cidr = parseCidr(localNetworkCidr);
  if (!cidr) return "10.0.0.1";
  if (cidr.prefix >= 31) return intToIp(cidr.network);
  return intToIp((cidr.network + 1) >>> 0);
}

function deriveRemoteRange(clientPoolCidr: string): string {
  const cidr = parseCidr(clientPoolCidr);
  if (!cidr) return "10.10.10.10-10.10.10.250";
  if (cidr.prefix >= 31) {
    const ip = intToIp(cidr.network);
    return `${ip}-${ip}`;
  }
  const total = 2 ** (32 - cidr.prefix);
  const firstHost = (cidr.network + 1) >>> 0;
  const lastHost = (cidr.network + total - 2) >>> 0;
  const preferredStart = (firstHost + 9) >>> 0;
  const start = preferredStart <= lastHost ? preferredStart : firstHost;
  return `${intToIp(start)}-${intToIp(lastHost)}`;
}

export async function syncPptpRuntime(tenantId: string): Promise<void> {
  const runtimeDir = process.env.PPTP_RUNTIME_DIR || "/app/runtime/pptp";
  await mkdir(runtimeDir, { recursive: true });

  const settings = await getSystemSettings(tenantId);
  const localIp = deriveLocalIp(settings.pptp_local_network_cidr);
  const remoteRange = deriveRemoteRange(settings.pptp_client_pool_cidr);
  const listenIp = String(settings.pptp_server_host ?? "").trim();

  const confLines = [
    "option /etc/ppp/pptpd-options",
    `localip ${localIp}`,
    `remoteip ${remoteRange}`,
  ];
  if (listenIp && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(listenIp)) {
    confLines.push(`listen ${listenIp}`);
  }

  const optionsLines = [
    "name pptpd",
    // Server mode: do not require the server to authenticate itself to clients.
    "noauth",
    "refuse-pap",
    "refuse-chap",
    "require-mschap-v2",
    "require-mppe-128",
    "ms-dns 8.8.8.8",
    "ms-dns 1.1.1.1",
    "proxyarp",
    "lock",
    "nobsdcomp",
    "nodeflate",
  ];

  const secrets: Array<{ username: string; password: string; staticIp: string }> = [];
  if (await hasTable(pool, "pptp_secrets")) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT username, password_encrypted, static_ip, is_active
       FROM pptp_secrets
       WHERE tenant_id = ?
       ORDER BY username ASC`,
      [tenantId]
    );
    for (const row of rows) {
      if (!Boolean(Number(row.is_active ?? 0))) continue;
      const user = String(row.username ?? "").trim();
      if (!user) continue;
      const pass = tryDecryptSecret(Buffer.from(row.password_encrypted as Buffer)) ?? "";
      if (!pass) continue;
      secrets.push({
        username: user,
        password: pass,
        staticIp: String(row.static_ip ?? "").trim() || "*",
      });
    }
  }

  const chapHeader = "# client\tserver\tsecret\tassigned-ip";
  const chapLines = [chapHeader, ...secrets.map((s) => `${s.username}\tpptpd\t${s.password}\t${s.staticIp}`)];

  const state = [
    `PPTP_ENABLED=${settings.pptp_vpn_enabled ? "1" : "0"}`,
    `PPTP_PORT=${Math.max(1, Math.min(65535, Number(settings.pptp_server_port || 1723)))}`,
  ];

  await Promise.all([
    writeFile(path.join(runtimeDir, "pptpd.conf"), `${confLines.join("\n")}\n`, "utf8"),
    writeFile(path.join(runtimeDir, "pptpd-options"), `${optionsLines.join("\n")}\n`, "utf8"),
    writeFile(path.join(runtimeDir, "chap-secrets"), `${chapLines.join("\n")}\n`, "utf8"),
    writeFile(path.join(runtimeDir, "pptp-state.env"), `${state.join("\n")}\n`, "utf8"),
  ]);
}
