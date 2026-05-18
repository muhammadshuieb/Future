import type { Pool } from "mysql2/promise";
import { config } from "../../config.js";
import { writeAuditLog } from "../audit-log.service.js";
import { findStaffByChatIdentity } from "./chatops-auth.service.js";
import { parseChatOpsCommand } from "./chatops-command-parser.service.js";
import {
  createPendingConfirmation,
  consumePendingConfirmation,
  formatConfirmationPrompt,
} from "./chatops-confirmation.service.js";
import {
  buildConfirmationSummary,
  executeChatOpsCommand,
  executeConfirmedPayload,
} from "./chatops-executor.service.js";
import { logChatOpsCommand, logChatOpsMessage } from "./chatops-log.service.js";
import { getChatOpsSettings } from "./chatops-settings.service.js";
import { bumpChatOpsRateLimit, checkChatOpsRateLimit } from "./chatops-rate-limit.service.js";
import type { ChatOpsInboundMessage, ChatOpsRouteResult } from "./chatops-types.js";

export async function routeChatOpsMessage(
  pool: Pool,
  msg: ChatOpsInboundMessage,
  reply: (text: string) => Promise<void>
): Promise<ChatOpsRouteResult> {
  const tenantId = msg.tenantId || config.defaultTenantId;
  const settings = await getChatOpsSettings(pool, tenantId);

  if (!settings.enabled) {
    return { replyText: "", status: "ignored" };
  }

  if (msg.channel === "whatsapp" && !settings.whatsapp_enabled) {
    return { replyText: "", status: "ignored" };
  }
  if (msg.channel === "telegram" && !settings.telegram_enabled) {
    return { replyText: "", status: "ignored" };
  }
  if (msg.isGroup) {
    if (msg.channel === "whatsapp" && !settings.allow_whatsapp_groups) {
      return { replyText: "", status: "ignored" };
    }
    if (msg.channel === "telegram" && !settings.allow_telegram_groups) {
      return { replyText: "", status: "ignored" };
    }
  }

  await logChatOpsMessage(pool, {
    tenantId,
    channel: msg.channel,
    direction: "inbound",
    externalSenderId: msg.externalSenderId,
    messageBody: msg.text,
  });

  const rate = await checkChatOpsRateLimit(pool, tenantId, msg.channel, msg.externalSenderId, settings);
  if (!rate.allowed) {
    const text = rate.reason ?? "محاولات كثيرة.";
    await reply(text);
    return { replyText: text, status: "denied" };
  }

  const staff = await findStaffByChatIdentity(
    pool,
    tenantId,
    msg.channel,
    msg.externalSenderId,
    msg.phoneNumber
  );

  if (!staff) {
    await bumpChatOpsRateLimit(pool, tenantId, msg.channel, msg.externalSenderId, true, settings);
    const text = "غير مصرح. رقمك أو حسابك غير مربوط بموظف نشط.";
    await logChatOpsCommand(pool, {
      tenantId,
      channel: msg.channel,
      staffUserId: null,
      externalSenderId: msg.externalSenderId,
      rawMessage: msg.text,
      parsedCommand: null,
      status: "denied",
      responseText: text,
      errorMessage: "unauthorized_sender",
    });
    await reply(text);
    return { replyText: text, status: "denied" };
  }

  const parsed = parseChatOpsCommand(msg.text);

  if (parsed.type === "confirm") {
    const code = String(parsed.args.code ?? "");
    const pending = await consumePendingConfirmation(
      pool,
      tenantId,
      msg.channel,
      msg.externalSenderId,
      code
    );
    if (!pending) {
      const text = "رمز التأكيد غير صالح أو منتهي.";
      await reply(text);
      return { replyText: text, status: "failed", error: "confirmation_expired" };
    }
    const resultText = await executeConfirmedPayload(
      pool,
      staff,
      pending.commandType,
      pending.payload,
      settings
    );
    await writeAuditLog(pool, {
      tenantId,
      staffId: staff.staffUserId,
      action: "chatops_confirmed",
      entityType: "chatops_command",
      entityId: pending.id,
      payload: { commandType: pending.commandType },
    });
    await logChatOpsCommand(pool, {
      tenantId,
      channel: msg.channel,
      staffUserId: staff.staffUserId,
      externalSenderId: msg.externalSenderId,
      rawMessage: msg.text,
      parsedCommand: pending.commandType as never,
      status: "executed",
      responseText: resultText,
      confirmationStatus: "confirmed",
    });
    await bumpChatOpsRateLimit(pool, tenantId, msg.channel, msg.externalSenderId, false, settings);
    await reply(resultText);
    return { replyText: resultText, status: "executed", commandType: pending.commandType as never };
  }

  if (parsed.requiresConfirmation) {
    const summary = await buildConfirmationSummary(pool, staff, parsed);
    const pending = await createPendingConfirmation(pool, {
      tenantId,
      staffUserId: staff.staffUserId,
      channel: msg.channel,
      externalSenderId: msg.externalSenderId,
      commandType: parsed.type,
      payload: {
        ...parsed.args,
        target: parsed.target,
      },
      summaryText: summary,
    });
    const prompt = formatConfirmationPrompt(summary, pending.confirmationCode);
    await logChatOpsCommand(pool, {
      tenantId,
      channel: msg.channel,
      staffUserId: staff.staffUserId,
      externalSenderId: msg.externalSenderId,
      rawMessage: msg.text,
      parsedCommand: parsed.type,
      targetEntity: parsed.target ?? null,
      status: "pending_confirmation",
      responseText: prompt,
      confirmationStatus: "pending",
    });
    await bumpChatOpsRateLimit(pool, tenantId, msg.channel, msg.externalSenderId, false, settings);
    await reply(prompt);
    return {
      replyText: prompt,
      status: "pending_confirmation",
      commandType: parsed.type,
      targetEntity: parsed.target,
    };
  }

  const resultText = await executeChatOpsCommand(pool, staff, parsed, settings);
  if (resultText === "__NEEDS_CONFIRMATION__") {
    const summary = await buildConfirmationSummary(pool, staff, parsed);
    const pending = await createPendingConfirmation(pool, {
      tenantId,
      staffUserId: staff.staffUserId,
      channel: msg.channel,
      externalSenderId: msg.externalSenderId,
      commandType: parsed.type,
      payload: { ...parsed.args, target: parsed.target },
      summaryText: summary,
    });
    const prompt = formatConfirmationPrompt(summary, pending.confirmationCode);
    await reply(prompt);
    return { replyText: prompt, status: "pending_confirmation", commandType: parsed.type };
  }

  const status = resultText.startsWith("لا تملك") || resultText.startsWith("غير مصرح")
    ? "denied"
    : resultText.startsWith("فشل") || resultText.startsWith("تعذر")
      ? "failed"
      : "executed";

  await logChatOpsCommand(pool, {
    tenantId,
    channel: msg.channel,
    staffUserId: staff.staffUserId,
    externalSenderId: msg.externalSenderId,
    rawMessage: msg.text,
    parsedCommand: parsed.type,
    targetEntity: parsed.target ?? null,
    status,
    responseText: resultText,
    errorMessage: status === "failed" ? resultText : null,
  });
  await bumpChatOpsRateLimit(pool, tenantId, msg.channel, msg.externalSenderId, status === "denied", settings);
  await writeAuditLog(pool, {
    tenantId,
    staffId: staff.staffUserId,
    action: `chatops_${parsed.type}`,
    entityType: "chatops",
    entityId: parsed.target ?? null,
    payload: { channel: msg.channel, args: parsed.args },
  });
  await reply(resultText);
  return { replyText: resultText, status, commandType: parsed.type, targetEntity: parsed.target };
}
