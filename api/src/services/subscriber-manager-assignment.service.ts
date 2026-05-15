import type { Pool, PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { hasColumn, hasTable } from "../db/schemaGuards.js";
import { pool } from "../db/pool.js";

export type AssignmentMode = "first_creator_only" | "first_payment_owner" | "latest_renewal_owner";

export async function getSubscriberAssignmentMode(tenantId: string): Promise<AssignmentMode> {
  if (!(await hasTable(pool, "system_settings"))) return "latest_renewal_owner";
  if (!(await hasColumn(pool, "system_settings", "subscriber_manager_assignment_mode"))) {
    return "latest_renewal_owner";
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT subscriber_manager_assignment_mode FROM system_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  const m = String(rows[0]?.subscriber_manager_assignment_mode ?? "latest_renewal_owner");
  if (m === "first_creator_only" || m === "first_payment_owner" || m === "latest_renewal_owner") return m;
  return "latest_renewal_owner";
}

export async function logSubscriberManagerAudit(
  conn: Pool | PoolConnection,
  input: {
    tenantId: string;
    subscriberId: string;
    oldManagerId: string | null;
    newManagerId: string | null;
    source: string;
    reason?: string | null;
    changedBy: string | null;
  }
): Promise<void> {
  if (!(await hasTable(pool, "subscriber_manager_audit"))) return;
  await conn.execute(
    `INSERT INTO subscriber_manager_audit
      (id, tenant_id, subscriber_id, old_manager_id, new_manager_id, reason, source, changed_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      randomUUID(),
      input.tenantId,
      input.subscriberId,
      input.oldManagerId,
      input.newManagerId,
      input.reason ?? null,
      input.source,
      input.changedBy,
    ]
  );
}

/**
 * When a manager renews/collects — update responsible manager per tenant mode.
 */
export async function assignResponsibleManagerOnFinancialEvent(
  conn: PoolConnection,
  tenantId: string,
  subscriberId: string,
  managerStaffId: string,
  source: "renewal" | "invoice_payment" | "prepaid_card"
): Promise<void> {
  if (!(await hasColumn(pool, "subscribers", "responsible_manager_id"))) return;
  const mode = await getSubscriberAssignmentMode(tenantId);
  const [cur] = await conn.query<RowDataPacket[]>(
    `SELECT responsible_manager_id FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
    [subscriberId, tenantId]
  );
  const current = cur[0]?.responsible_manager_id != null ? String(cur[0].responsible_manager_id) : null;

  if (mode === "first_creator_only") return;

  let shouldSet = false;
  if (mode === "latest_renewal_owner") shouldSet = true;
  else if (mode === "first_payment_owner") shouldSet = current == null;

  if (!shouldSet) return;

  if (current === managerStaffId) {
    await conn.execute(
      `UPDATE subscribers SET last_renewed_by_manager_id = ?, manager_assigned_at = CURRENT_TIMESTAMP(3),
        manager_assignment_source = ?
       WHERE id = ? AND tenant_id = ?`,
      [managerStaffId, source, subscriberId, tenantId]
    );
    return;
  }

  await conn.execute(
    `UPDATE subscribers SET responsible_manager_id = ?, last_renewed_by_manager_id = ?,
      manager_assigned_at = CURRENT_TIMESTAMP(3), manager_assignment_source = ?
     WHERE id = ? AND tenant_id = ?`,
    [managerStaffId, managerStaffId, source, subscriberId, tenantId]
  );
  await logSubscriberManagerAudit(conn, {
    tenantId,
    subscriberId,
    oldManagerId: current,
    newManagerId: managerStaffId,
    source,
    reason: null,
    changedBy: managerStaffId,
  });
}
