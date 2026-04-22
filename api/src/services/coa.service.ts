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

  private async getSecretFromNasServer(nasIp: string, tenantId: string): Promise<string | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT secret_encrypted FROM nas_servers WHERE tenant_id = ? AND ip = ? AND status = 'active' LIMIT 1`,
      [tenantId, nasIp]
    );
    const buf = rows[0]?.secret_encrypted;
    if (!buf) return null;
    const plain = tryDecryptSecret(Buffer.from(buf));
    if (plain !== null) return plain;
    // Encrypted with an old AES_SECRET_KEY or corrupt — FreeRADIUS still uses plain `nas.secret`.
    return this.getSecretForNasIp(nasIp);
  }

  /**
   * Disconnect-Request with explicit RADIUS secret (no DB lookup).
   */
  disconnectUser(username: string, nasIp: string, secret: string, acctSessionId?: string): Promise<DisconnectResult> {
    const attrs: [string, string][] = [["User-Name", username]];
    if (acctSessionId) attrs.push(["Acct-Session-Id", acctSessionId]);

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
        host: nasIp,
        port: 3799,
        ok: false,
        message: `Encode error: ${(e as Error).message}`,
      });
    }

    return this.sendUdp(nasIp, 3799, encoded, secret);
  }

  async disconnectUserForTenant(
    username: string,
    nasIp: string,
    tenantId: string,
    acctSessionId?: string
  ): Promise<DisconnectResult> {
    const secret =
      (await this.getSecretFromNasServer(nasIp, tenantId)) ??
      (await this.getSecretForNasIp(nasIp));
    if (!secret) {
      return {
        host: nasIp,
        port: 3799,
        ok: false,
        message: `No RADIUS secret for NAS ${nasIp}`,
      };
    }
    return this.disconnectUser(username, nasIp, secret, acctSessionId);
  }

  async disconnectAllSessions(username: string, tenantId: string): Promise<DisconnectResult[]> {
    if (!(await hasTable(this.pool, "radacct"))) return [];
    const [sessions] = await this.pool.query<RowDataPacket[]>(
      `SELECT nasipaddress, acctsessionid FROM radacct
       WHERE username = ? AND acctstoptime IS NULL`,
      [username]
    );
    const results: DisconnectResult[] = [];
    for (const s of sessions) {
      const nas = s.nasipaddress as string;
      const sid = s.acctsessionid as string;
      results.push(await this.disconnectUserForTenant(username, nas, tenantId, sid));
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
            } catch {
              resolve({ host, port, ok: true, message: "response received" });
            }
          });
        });
      });
    });
  }
}
