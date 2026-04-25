import { Agent } from "https";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getTableColumns, hasTable } from "../db/schemaGuards.js";
import { tryDecryptSecret } from "./crypto.service.js";

type KickResult = { ok: boolean; message: string };

function buildFetchOptions(
  authHeader: string,
  agent?: Agent
): RequestInit & { agent?: Agent } {
  const o: RequestInit & { agent?: Agent } = {
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  };
  if (agent) o.agent = agent;
  return o;
}

/**
 * Kick a user via RouterOS 7+ REST. Uses Basic auth to `/rest/ppp/active` and `/rest/ip/hotspot/active`.
 */
export async function mikrotikKickUsername(opts: {
  pool: Pool;
  tenantId: string;
  nasIp: string;
  username: string;
}): Promise<KickResult> {
  const { pool, tenantId, nasIp, username } = opts;
  if (!(await hasTable(pool, "nas_servers"))) {
    return { ok: false, message: "nas_servers_missing" };
  }
  const cols = await getTableColumns(pool, "nas_servers");
  if (!cols.has("mikrotik_api_enabled")) {
    return { ok: false, message: "mikrotik_api_not_configured" };
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ip, wireguard_tunnel_ip, mikrotik_api_enabled, mikrotik_api_user, mikrotik_api_password_encrypted
     FROM nas_servers
     WHERE tenant_id = ? AND status = 'active'
       AND (ip = ? OR wireguard_tunnel_ip = ?)
     ORDER BY CASE WHEN ip = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [tenantId, nasIp, nasIp, nasIp]
  );
  const row = rows[0];
  if (!row) return { ok: false, message: "nas_row_not_found" };
  if (!Number(row.mikrotik_api_enabled ?? 0)) {
    return { ok: false, message: "mikrotik_api_disabled" };
  }
  const apiUser = String(row.mikrotik_api_user ?? "").trim();
  const enc = row.mikrotik_api_password_encrypted as Buffer | Uint8Array | null | undefined;
  if (!apiUser || !enc) {
    return { ok: false, message: "mikrotik_api_credentials_missing" };
  }
  const apiPass = tryDecryptSecret(Buffer.from(enc));
  if (!apiPass) {
    return { ok: false, message: "mikrotik_api_password_decrypt_failed" };
  }
  const tunnel = String(row.wireguard_tunnel_ip ?? "").trim();
  const publicIp = String(row.ip ?? nasIp);
  const host = tunnel || publicIp;
  const useTls = process.env.MIKROTIK_REST_TLS === "1" || process.env.MIKROTIK_REST_TLS === "true";
  const port = (process.env.MIKROTIK_REST_PORT?.trim() || (useTls ? "443" : "80")) as string;
  const base = `${useTls ? "https" : "http"}://${host}:${port}/rest`;
  const auth = Buffer.from(`${apiUser}:${apiPass}`).toString("base64");
  const authHeader = `Basic ${auth}`;
  const tlsAgent =
    useTls && process.env.MIKROTIK_TLS_INSECURE === "1"
      ? new Agent({ rejectUnauthorized: false })
      : undefined;
  const getOpts = buildFetchOptions(authHeader, tlsAgent);

  const listAndDelete = async (path: string, match: (x: { ".id"?: string } & Record<string, unknown>) => boolean) => {
    const listUrl = `${base}${path}`;
    const r = await fetch(listUrl, getOpts);
    if (!r.ok) {
      return { ok: false as const, msg: `list_status_${r.status}` };
    }
    const data = (await r.json()) as unknown;
    const items: { ".id"?: string }[] = Array.isArray(data)
      ? (data as { ".id"?: string }[])
      : ((data as { value?: { ".id"?: string }[] })?.value ?? []);
    if (!Array.isArray(items)) {
      return { ok: false as const, msg: "invalid_list_json" };
    }
    for (const item of items) {
      if (match(item as { ".id"?: string } & Record<string, unknown>)) {
        const id = String(item[".id"] ?? "");
        if (!id) continue;
        const delUrl = `${listUrl}/${encodeURIComponent(id)}`;
        const del = await fetch(delUrl, { ...getOpts, method: "DELETE" });
        if (del.ok) return { ok: true as const, msg: "kicked" };
        return { ok: false as const, msg: `delete_status_${del.status}` };
      }
    }
    return { ok: false as const, msg: "no_match" };
  };

  try {
    const ppp = await listAndDelete("/ppp/active", (x) => String(x.name ?? "") === username);
    if (ppp.ok) return { ok: true, message: ppp.msg };
    const hs = await listAndDelete("/ip/hotspot/active", (x) => String(x.user ?? "") === username);
    if (hs.ok) return { ok: true, message: hs.msg };
    return { ok: false, message: `ppp:${ppp.msg};hotspot:${hs.msg}` };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `mikrotik_rest_error:${m}` };
  }
}
