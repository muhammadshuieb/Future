import { pool } from "../../db/pool.js";
import { sendTelegramMessage } from "../infrastructure/infrastructure-telegram.service.js";
import { resolveTelegramBotToken } from "./chatops-settings.service.js";
import { routeChatOpsMessage } from "./chatops-router.service.js";
import { logChatOpsMessage } from "./chatops-log.service.js";
export { parseTelegramUpdate } from "./chatops-payload-parse.js";
import { parseTelegramUpdate } from "./chatops-payload-parse.js";

export async function handleTelegramChatOpsWebhook(body: unknown): Promise<{ handled: boolean }> {
  const msg = parseTelegramUpdate(body);
  if (!msg) return { handled: false };
  const tenantId = msg.tenantId;
  const token = await resolveTelegramBotToken(pool, tenantId);
  if (!token) return { handled: false };

  const chatId =
    msg.isGroup && msg.externalSenderId.startsWith("tg:")
      ? msg.externalSenderId.slice(3)
      : msg.externalSenderId;

  const reply = async (text: string) => {
    if (!text.trim()) return;
    await sendTelegramMessage(token, chatId, text);
    await logChatOpsMessage(pool, {
      tenantId,
      channel: "telegram",
      direction: "outbound",
      externalSenderId: msg.externalSenderId,
      messageBody: text,
    });
  };

  await routeChatOpsMessage(pool, msg, reply);
  return { handled: true };
}
