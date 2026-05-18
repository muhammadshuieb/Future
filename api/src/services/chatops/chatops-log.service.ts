import { randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";
import { hasTable } from "../../db/schemaGuards.js";
import type { ChatOpsChannel, ChatOpsCommandType } from "./chatops-types.js";

export async function logChatOpsMessage(
  pool: Pool,
  input: {
    tenantId: string;
    channel: ChatOpsChannel;
    direction: "inbound" | "outbound";
    externalSenderId: string;
    staffUserId?: string | null;
    messageBody: string;
  }
): Promise<string | null> {
  if (!(await hasTable(pool, "chatops_messages"))) return null;
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO chatops_messages (id, tenant_id, channel, direction, external_sender_id, staff_user_id, message_body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.tenantId,
      input.channel,
      input.direction,
      input.externalSenderId,
      input.staffUserId ?? null,
      input.messageBody.slice(0, 8000),
    ]
  );
  return id;
}

export async function logChatOpsCommand(
  pool: Pool,
  input: {
    tenantId: string;
    channel: ChatOpsChannel;
    staffUserId: string | null;
    externalSenderId: string;
    rawMessage: string;
    parsedCommand: ChatOpsCommandType | null;
    targetEntity?: string | null;
    status: "parsed" | "denied" | "pending_confirmation" | "executed" | "failed" | "ignored";
    responseText?: string | null;
    confirmationStatus?: "none" | "pending" | "confirmed" | "expired" | "rejected";
    errorMessage?: string | null;
  }
): Promise<string> {
  const id = randomUUID();
  if (await hasTable(pool, "chatops_commands")) {
    await pool.execute(
      `INSERT INTO chatops_commands
       (id, tenant_id, channel, staff_user_id, external_sender_id, raw_message, parsed_command, target_entity, status, response_text, confirmation_status, error_message, executed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.tenantId,
        input.channel,
        input.staffUserId,
        input.externalSenderId,
        input.rawMessage.slice(0, 4000),
        input.parsedCommand,
        input.targetEntity ?? null,
        input.status,
        input.responseText?.slice(0, 8000) ?? null,
        input.confirmationStatus ?? "none",
        input.errorMessage?.slice(0, 512) ?? null,
        input.status === "executed" ? new Date() : null,
      ]
    );
  }
  return id;
}
