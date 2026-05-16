import { randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { RouterOSAPI } from "node-routeros";
import { hasTable } from "../../db/schemaGuards.js";
import { resolveMikrotikApiHost, nasRowHasMikrotikApi } from "../mikrotik-api-probe.js";
import { logRouterCommand } from "../router-command-log.service.js";

export type RouterActionType = "reboot" | "restart_interface" | "disable_interface" | "enable_interface";

export async function scheduleRouterAction(
  pool: Pool,
  input: {
    tenantId: string;
    nasDeviceId: string;
    actionType: RouterActionType;
    payload?: Record<string, unknown>;
    scheduledAt: Date;
    createdBy?: string;
    requiresConfirmation?: boolean;
  }
): Promise<string> {
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO router_scheduled_actions
      (id, tenant_id, nas_device_id, action_type, payload_json, scheduled_at, status, requires_confirmation, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id,
      input.tenantId,
      input.nasDeviceId,
      input.actionType,
      input.payload ? JSON.stringify(input.payload) : null,
      input.scheduledAt,
      input.requiresConfirmation !== false ? 1 : 0,
      input.createdBy ?? null,
    ]
  );
  return id;
}

export async function confirmRouterAction(
  pool: Pool,
  tenantId: string,
  actionId: string,
  userId: string
): Promise<boolean> {
  const [r] = await pool.execute(
    `UPDATE router_scheduled_actions SET confirmed_at = NOW(3), confirmed_by = ?
     WHERE id = ? AND tenant_id = ? AND status = 'pending' AND requires_confirmation = 1`,
    [userId, actionId, tenantId]
  );
  return (r as { affectedRows?: number }).affectedRows === 1;
}

async function runRosAction(
  host: string,
  user: string,
  password: string,
  actionType: RouterActionType,
  payload: Record<string, unknown>
): Promise<string> {
  const api = new RouterOSAPI({ host, user, password, port: 8728, timeout: 15_000 });
  try {
    await api.connect();
    if (actionType === "reboot") {
      await api.write("/system/reboot");
      await api.close();
      return "reboot_sent";
    }
    const iface = String(payload.interface ?? payload.name ?? "").trim();
    if (!iface) throw new Error("missing_interface");
    if (actionType === "restart_interface") {
      await api.write("/interface/disable", [`=numbers=${iface}`]);
      await api.write("/interface/enable", [`=numbers=${iface}`]);
    } else if (actionType === "disable_interface") {
      await api.write("/interface/disable", [`=numbers=${iface}`]);
    } else if (actionType === "enable_interface") {
      await api.write("/interface/enable", [`=numbers=${iface}`]);
    }
    await api.close();
    return "ok";
  } catch (e) {
    try {
      await api.close();
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export async function executeDueRouterActions(pool: Pool, tenantId: string): Promise<void> {
  if (!(await hasTable(pool, "router_scheduled_actions"))) return;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT a.*, n.mikrotik_api_enabled, n.mikrotik_api_user, n.mikrotik_api_password, n.wireguard_tunnel_ip, n.ip, n.name
     FROM router_scheduled_actions a
     JOIN nas_devices n ON n.id = a.nas_device_id AND n.tenant_id = a.tenant_id
     WHERE a.tenant_id = ? AND a.status = 'pending' AND a.scheduled_at <= NOW(3)
       AND (a.requires_confirmation = 0 OR a.confirmed_at IS NOT NULL)
     ORDER BY a.scheduled_at ASC
     LIMIT 5`,
    [tenantId]
  );

  for (const row of rows) {
    const actionId = String(row.id);
    await pool.execute(`UPDATE router_scheduled_actions SET status = 'running' WHERE id = ?`, [actionId]);
    let resultMessage = "ok";
    try {
      if (!nasRowHasMikrotikApi(row)) throw new Error("mikrotik_api_not_configured");
      const host = resolveMikrotikApiHost(row);
      if (!host) throw new Error("invalid_host");
      const user = String(row.mikrotik_api_user ?? "").trim();
      const password = String(row.mikrotik_api_password ?? "");
      let payload: Record<string, unknown> = {};
      try {
        payload = row.payload_json ? JSON.parse(String(row.payload_json)) : {};
      } catch {
        payload = {};
      }
      const started = Date.now();
      resultMessage = await runRosAction(
        host,
        user,
        password,
        String(row.action_type) as RouterActionType,
        payload
      );
      await logRouterCommand(pool, {
        tenantId,
        routerId: String(row.nas_device_id),
        nasIp: host,
        commandType: `ros.action.${row.action_type}`,
        payload: { action: row.action_type, ...payload },
        result: { message: resultMessage },
        errorMessage: null,
        durationMs: Date.now() - started,
        retryCount: 0,
      });
      await pool.execute(
        `UPDATE router_scheduled_actions SET status = 'completed', executed_at = NOW(3), result_message = ? WHERE id = ?`,
        [resultMessage, actionId]
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await pool.execute(
        `UPDATE router_scheduled_actions SET status = 'failed', executed_at = NOW(3), result_message = ? WHERE id = ?`,
        [msg.slice(0, 512), actionId]
      );
    }
  }
}
