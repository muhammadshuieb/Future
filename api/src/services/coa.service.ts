import { createRequire } from "module";
import dgram from "dgram";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { hasTable } from "../db/schemaGuards.js";
import { tryDecryptSecret } from "./crypto.service.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const radius: any = require("radius");

export type DisconnectResult = { host: string; port: number; ok: boolean; message: string };
type NasServerCoaConfig = { nasIp: string; coaHost: string; coaPort: number; secret: string | null };

/**
 * UDP Change of Authorization (RFC 5176) — Disconnect-Request on port 3799.
 * Secret resolution: nas_servers (encrypted) preferred, else legacy nas.secret.
 * MikroTik must accept incoming RADIUS: /radius incoming → set accept=yes (see docker/freeradius/NOTES.txt).
 */
export class CoaService {
  constructor(private readonly pool: Pool) {}

  private async getSecretForNasIp(nasIp: string): Promise<string | null> {
    if (!(await hasTable(this.pool, "nas"))) return null;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, secret FROM nas WHERE nasname = ? LIMIT 1`,
      [nasIp]
    );
    if (rows[0]?.secret) return rows[0].secret as string;
    return null;
  }

  private async getNasServerCoaConfig(nasIp: string, tenantId: string): Promise<NasServerCoaConfig | null> {
    if (!(await hasTable(this.pool, "nas_servers"))) return null;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ip, pptp_tunnel_ip, coa_port, secret_encrypted
       FROM nas_servers
       WHERE tenant_id = ?
         AND status = 'active'
         AND (ip = ? OR pptp_tunnel_ip = ?)
       ORDER BY CASE WHEN ip = ? THEN 0 ELSE 1 END
       LIMIT 1`,
      [tenantId, nasIp, nasIp, nasIp]
    );
    const row = rows[0];
    if (!row) return null;
    const rowIp = String(row.ip ?? nasIp);
    const tunnelIp = String(row.pptp_tunnel_ip ?? "").trim();
    const coaHost = tunnelIp || rowIp || nasIp;
    const coaPortRaw = Number(row.coa_port ?? 3799);
    const coaPort = Number.isFinite(coaPortRaw) && coaPortRaw > 0 ? Math.floor(coaPortRaw) : 3799;
    const buf = row.secret_encrypted as Buffer | Uint8Array | null | undefined;
    let secret: string | null = null;
    if (buf) {
      secret = tryDecryptSecret(Buffer.from(buf));
    }
    return { nasIp: rowIp, coaHost, coaPort, secret };
  }

  /**
   * Disconnect-Request with explicit RADIUS secret (no DB lookup).
   */
  disconnectUser(
    username: string,
    host: string,
    secret: string,
    acctSessionId?: string,
    framedIp?: string,
    port = 3799
  ): Promise<DisconnectResult> {
    const attrs: [string, string][] = [["User-Name", username]];
    if (acctSessionId) attrs.push(["Acct-Session-Id", acctSessionId]);
    if (framedIp) attrs.push(["Framed-IP-Address", framedIp]);

    const packet = {
      code: "Disconnect-Request",
      identifier: Math.floor(Math.random() * 256),
      secret,
      attributes: attrs,
    };

    let encoded: Buffer;
    try {
      encoded = radius.encode(packet);
    } catch (e) {
      return Promise.resolve({
        host,
        port,
        ok: false,
        message: `Encode error: ${(e as Error).message}`,
      });
    }

    return this.sendUdp(host, port, encoded, secret);
  }

  async disconnectUserForTenant(
    username: string,
    nasIp: string,
    tenantId: string,
    acctSessionId?: string,
    framedIp?: string
  ): Promise<DisconnectResult> {
    let host = nasIp;
    let port = 3799;
    let secret: string | null = null;
    try {
      const config = await this.getNasServerCoaConfig(nasIp, tenantId);
      if (config) {
        host = config.coaHost;
        port = config.coaPort;
        secret = config.secret;
      }
      if (!secret) {
        secret = await this.getSecretForNasIp(config?.nasIp ?? nasIp);
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return {
        host,
        port,
        ok: false,
        message: `Secret resolution failed for ${nasIp}: ${err}`,
      };
    }
    if (!secret) {
      return {
        host,
        port,
        ok: false,
        message: `No RADIUS secret for NAS ${nasIp}`,
      };
    }
    return this.disconnectUser(username, host, secret, acctSessionId, framedIp, port);
  }

  async disconnectAllSessions(username: string, tenantId: string): Promise<DisconnectResult[]> {
    if (!(await hasTable(this.pool, "radacct"))) return [];
    const [sessions] = await this.pool.query<RowDataPacket[]>(
      `SELECT nasipaddress, acctsessionid, framedipaddress FROM radacct
       WHERE username = ? AND acctstoptime IS NULL`,
      [username]
    );
    const results: DisconnectResult[] = [];
    for (const s of sessions) {
      const nas = s.nasipaddress as string;
      const sid = s.acctsessionid as string;
      const framedIp = s.framedipaddress as string | undefined;
      results.push(await this.disconnectUserForTenant(username, nas, tenantId, sid, framedIp));
    }
    return results;
  }

  private sendUdp(
    host: string,
    port: number,
    payload: Buffer,
    secret: string
  ): Promise<DisconnectResult> {
    return new Promise((resolve) => {
      const sock = dgram.createSocket("udp4");
      const timer = setTimeout(() => {
        try {
          sock.close();
        } catch {
          /* ignore */
        }
        resolve({ host, port, ok: false, message: "timeout" });
      }, config.coaTimeoutMs);

      sock.bind(0, () => {
        sock.send(payload, port, host, (err) => {
          if (err) {
            clearTimeout(timer);
            sock.close();
            resolve({ host, port, ok: false, message: err.message });
            return;
          }
          sock.once("message", (msg) => {
            clearTimeout(timer);
            sock.close();
            try {
              const decoded = radius.decode({ packet: msg, secret });
              const code = decoded.code;
              const ok = code === "Disconnect-ACK" || code === 41;
              resolve({
                host,
                port,
                ok,
                message: String(code),
              });
            } catch (decodeErr) {
              const reason = decodeErr instanceof Error ? decodeErr.message : String(decodeErr);
              resolve({
                host,
                port,
                ok: false,
                message: `invalid_response: ${reason}`,
              });
            }
          });
        });
      });
    });
  }
}
