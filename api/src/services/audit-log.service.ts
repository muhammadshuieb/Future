import { randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";
import { hasTable } from "../db/schemaGuards.js";

export type AuditWriteInput = {
  tenantId: string;
  staffId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  payload?: unknown;
};

/**
 * Best-effort audit write (never throws to callers).
 */
export async function writeAuditLog(pool: Pool, input: AuditWriteInput): Promise<void> {
  try {
    if (!(await hasTable(pool, "audit_logs"))) return;
    await pool.execute(
      `INSERT INTO audit_logs (id, tenant_id, staff_id, action, entity_type, entity_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.tenantId,
        input.staffId ?? null,
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.payload ? JSON.stringify(input.payload) : null,
      ]
    );
  } catch (error) {
    console.warn("audit log write failed", error);
  }
}
