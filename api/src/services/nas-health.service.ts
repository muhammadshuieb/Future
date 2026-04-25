import { execFile } from "child_process";
import { promisify } from "util";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getTableColumns, hasTable } from "../db/schemaGuards.js";
import { CoaService } from "./coa.service.js";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

async function pingHost(ip: string): Promise<boolean> {
  try {
    await execFileAsync("ping", ["-c", "1", "-W", "2", ip], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export type NasHealthEvent = {
  type: "nas_status";
  tenant_id: string;
  nas_id: string;
  ip: string;
  name: string;
  online: boolean;
  ping_ok: boolean;
  radius_ok: boolean;
  session_count: number;
};

export class NasHealthService {
  constructor(
    private readonly pool: Pool,
    private readonly coa: CoaService,
    private readonly publish?: (msg: NasHealthEvent) => void
  ) {}

  async refreshSessionsCounts(tenantId: string): Promise<void> {
    if (!(await hasTable(this.pool, "radacct"))) return;
    if (!(await hasTable(this.pool, "nas_servers"))) return;
    const col = await getTableColumns(this.pool, "nas_servers");
    if (!col.has("session_count")) return;
    const [byNas] = await this.pool.query<RowDataPacket[]>(
      `SELECT nasipaddress AS ip, COUNT(*) AS c
       FROM radacct WHERE acctstoptime IS NULL AND nasipaddress <> ''
       GROUP BY nasipaddress`
    );
    const map = new Map<string, number>();
    for (const r of byNas) {
      map.set(String(r.ip), Number(r.c ?? 0));
    }
    const [servers] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, ip, name FROM nas_servers WHERE tenant_id = ? AND status = 'active'`,
      [tenantId]
    );
    for (const s of servers) {
      const ip = s.ip as string;
      const cnt = map.get(ip) ?? 0;
      await this.pool.execute(`UPDATE nas_servers SET session_count = ? WHERE id = ?`, [cnt, s.id]);
    }
  }

  async probeAll(tenantId: string): Promise<NasHealthEvent[]> {
    if (!(await hasTable(this.pool, "nas_servers"))) return [];
    const col = await getTableColumns(this.pool, "nas_servers");
    const canWriteHealth =
      col.has("online_status") &&
      col.has("last_ping_ok") &&
      col.has("last_radius_ok") &&
      col.has("last_check_at");

    await this.refreshSessionsCounts(tenantId);
    const events: NasHealthEvent[] = [];
    const sessCol = col.has("session_count") ? ", session_count" : "";
    const statCol = col.has("online_status") ? ", online_status" : "";
    const [servers] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, ip, name${sessCol}${statCol} FROM nas_servers WHERE tenant_id = ? AND status = 'active'`,
      [tenantId]
    );
    for (const s of servers) {
      const id = s.id as string;
      const ip = s.ip as string;
      const name = s.name as string;
      const pingOk = await pingHost(ip);
      let radiusOk = false;
      if (pingOk) {
        const probe = await this.coa.disconnectUserForTenant(`__health_${Date.now()}`, ip, tenantId);
        radiusOk = probe.ok;
      }
      const online = pingOk && radiusOk;
      const prev = col.has("online_status") ? String(s.online_status ?? "unknown") : "unknown";
      const nextStatus = online ? "online" : "offline";
      if (canWriteHealth) {
        await this.pool.execute(
          `UPDATE nas_servers SET last_ping_ok = ?, last_radius_ok = ?, online_status = ?, last_check_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [pingOk ? 1 : 0, radiusOk ? 1 : 0, nextStatus, id]
        );
      }
      const sess = col.has("session_count") ? Number(s.session_count ?? 0) : 0;
      const ev: NasHealthEvent = {
        type: "nas_status",
        tenant_id: tenantId,
        nas_id: id,
        ip,
        name,
        online,
        ping_ok: pingOk,
        radius_ok: radiusOk,
        session_count: sess,
      };
      events.push(ev);
      if (prev === "online" && nextStatus === "offline") {
        if (await hasTable(this.pool, "notifications")) {
          await this.pool
            .execute(
              `INSERT INTO notifications (id, tenant_id, kind, title, body) VALUES (?, ?, ?, ?, ?)`,
              [
                randomUUID(),
                tenantId,
                "nas_down",
                `NAS offline: ${name}`,
                JSON.stringify({ ip, ping_ok: pingOk, radius_ok: radiusOk, nas_id: id }),
              ]
            )
            .catch(() => {});
        }
        this.publish?.(ev);
      }
      if (prev === "offline" && nextStatus === "online") {
        this.publish?.(ev);
      }
    }
    return events;
  }
}
