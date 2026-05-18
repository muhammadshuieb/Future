import { pool } from "../../db/pool.js";
import { sendChatOpsWhatsAppReply } from "../whatsapp.service.js";
import { routeChatOpsMessage } from "./chatops-router.service.js";
import { logChatOpsMessage } from "./chatops-log.service.js";
export { parseWahaInbound } from "./chatops-payload-parse.js";
import { parseWahaInbound } from "./chatops-payload-parse.js";

export async function handleWhatsAppChatOpsWebhook(body: unknown): Promise<{ handled: boolean }> {
  const msg = parseWahaInbound(body);
  if (!msg) return { handled: false };

  const reply = async (text: string) => {
    if (!text.trim()) return;
    const phone = msg.phoneNumber ?? msg.externalSenderId;
    await sendChatOpsWhatsAppReply(msg.tenantId, phone, text);
    await logChatOpsMessage(pool, {
      tenantId: msg.tenantId,
      channel: "whatsapp",
      direction: "outbound",
      externalSenderId: msg.externalSenderId,
      messageBody: text,
    });
  };

  await routeChatOpsMessage(pool, msg, reply);
  return { handled: true };
}
