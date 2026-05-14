import type { Pool } from "mysql2/promise";
import { hasTable } from "../db/schemaGuards.js";

export type RouterCommandLogInput = {
  tenantId?: string | null;
  routerId?: string | null;
  nasIp?: string | null;
  commandType: string;
  payload?: unknown;
  result?: unknown;
  errorMessage?: string | null;
  durationMs: number;
  retryCount?: number;
};

/**
 * Persists MikroTik / RouterOS API operations for audit and debugging.
 * Best-effort: never throws to callers.
 */
export async function logRouterCommand(pool: Pool, input: RouterCommandLogInput): Promise<void> {
  if (!(await hasTable(pool, "router_commands_log"))) return;
  try {
    const payloadJson = JSON.stringify(input.payload ?? null);
    const resultJson = JSON.stringify(input.result ?? null);
    await pool.execute(
      `INSERT INTO router_commands_log
        (tenant_id, router_id, nas_ip, command_type, payload, result, error_message, duration_ms, retry_count, created_at)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, NOW(3))`,
      [
        input.tenantId ?? null,
        input.routerId ?? null,
        input.nasIp ?? null,
        input.commandType.slice(0, 64),
        payloadJson,
        resultJson,
        input.errorMessage?.slice(0, 8000) ?? null,
        Math.max(0, Math.floor(input.durationMs)),
        Math.max(0, Math.floor(input.retryCount ?? 0)),
      ]
    );
  } catch {
    /* logging must not break API paths */
  }
}
