import type { Pool } from "mysql2/promise";
import { randomUUID } from "crypto";
import { hasTable } from "../db/schemaGuards.js";

export type FinancialAuditInput = {
  tenantId: string;
  staffId: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  payload?: unknown;
  ip?: string | null;
};

export async function writeFinancialAudit(pool: Pool, input: FinancialAuditInput): Promise<void> {
  if (!(await hasTable(pool, "financial_audit_logs"))) return;
  try {
    await pool.execute(
      `INSERT INTO financial_audit_logs (id, tenant_id, staff_id, action, entity_type, entity_id, payload, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.tenantId,
        input.staffId,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.payload != null ? JSON.stringify(input.payload) : null,
        input.ip ?? null,
      ]
    );
  } catch (e) {
    console.warn("[financial-audit] insert failed", e instanceof Error ? e.message : e);
  }
}
