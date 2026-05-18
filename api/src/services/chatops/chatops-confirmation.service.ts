import { randomInt, randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import { hasTable } from "../../db/schemaGuards.js";
import type { ChatOpsChannel } from "./chatops-types.js";

const CONFIRM_TTL_MS = 2 * 60 * 1000;

export type PendingConfirmation = {
  id: string;
  commandType: string;
  payload: Record<string, unknown>;
  summaryText: string;
  confirmationCode: string;
  expiresAt: Date;
};

export async function createPendingConfirmation(
  pool: Pool,
  input: {
    tenantId: string;
    staffUserId: string;
    channel: ChatOpsChannel;
    externalSenderId: string;
    commandType: string;
    payload: Record<string, unknown>;
    summaryText: string;
  }
): Promise<PendingConfirmation> {
  if (!(await hasTable(pool, "chatops_pending_confirmations"))) {
    throw new Error("chatops_confirmations_schema_missing");
  }
  await pool.execute(
    `DELETE FROM chatops_pending_confirmations
     WHERE tenant_id = ? AND channel = ? AND external_sender_id = ?`,
    [input.tenantId, input.channel, input.externalSenderId]
  );
  const id = randomUUID();
  const code = String(randomInt(1000, 9999));
  const expiresAt = new Date(Date.now() + CONFIRM_TTL_MS);
  await pool.execute(
    `INSERT INTO chatops_pending_confirmations
     (id, tenant_id, staff_user_id, channel, external_sender_id, command_type, payload_json, confirmation_code, summary_text, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.tenantId,
      input.staffUserId,
      input.channel,
      input.externalSenderId,
      input.commandType,
      JSON.stringify(input.payload),
      code,
      input.summaryText,
      expiresAt,
    ]
  );
  return {
    id,
    commandType: input.commandType,
    payload: input.payload,
    summaryText: input.summaryText,
    confirmationCode: code,
    expiresAt,
  };
}

export async function consumePendingConfirmation(
  pool: Pool,
  tenantId: string,
  channel: ChatOpsChannel,
  externalSenderId: string,
  code: string
): Promise<PendingConfirmation | null> {
  if (!(await hasTable(pool, "chatops_pending_confirmations"))) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM chatops_pending_confirmations
     WHERE tenant_id = ? AND channel = ? AND external_sender_id = ? AND confirmation_code = ?
     LIMIT 1`,
    [tenantId, channel, externalSenderId, code.trim()]
  );
  const row = rows[0];
  if (!row) return null;
  const expiresAt = new Date(String(row.expires_at));
  if (expiresAt.getTime() < Date.now()) {
    await pool.execute(`DELETE FROM chatops_pending_confirmations WHERE id = ?`, [row.id]);
    return null;
  }
  await pool.execute(`DELETE FROM chatops_pending_confirmations WHERE id = ?`, [row.id]);
  let payload: Record<string, unknown> = {};
  try {
    payload =
      typeof row.payload_json === "string"
        ? (JSON.parse(row.payload_json) as Record<string, unknown>)
        : (row.payload_json as Record<string, unknown>);
  } catch {
    payload = {};
  }
  return {
    id: String(row.id),
    commandType: String(row.command_type),
    payload,
    summaryText: String(row.summary_text ?? ""),
    confirmationCode: String(row.confirmation_code),
    expiresAt,
  };
}

export function formatConfirmationPrompt(summary: string, code: string): string {
  return `${summary}\n\nهل تؤكد؟\nاكتب: تأكيد ${code}\n\nينتهي التأكيد خلال دقيقتين.`;
}
