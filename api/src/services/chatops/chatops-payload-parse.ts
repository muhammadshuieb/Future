import { config } from "../../config.js";
import type { ChatOpsInboundMessage } from "./chatops-types.js";

function extractPhoneFromChatId(chatId: string): string | null {
  const m = chatId.match(/^(\d+)@/);
  return m?.[1] ?? null;
}

export function parseWahaInbound(body: unknown): ChatOpsInboundMessage | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const event = String(root.event ?? root.type ?? "").toLowerCase();
  const payload = (root.payload ?? root.data ?? root) as Record<string, unknown>;
  if (event && !event.includes("message") && !payload.body && !payload.text) {
    if (event !== "message.any" && event !== "message") return null;
  }
  const from = String(payload.from ?? payload.chatId ?? "");
  const text = String(payload.body ?? payload.text ?? payload.caption ?? "").trim();
  if (!from || !text) return null;
  const isGroup = from.includes("@g.us");
  const externalSenderId = isGroup ? from : extractPhoneFromChatId(from) ?? from.replace(/\D/g, "");
  return {
    tenantId: config.defaultTenantId,
    channel: "whatsapp",
    externalSenderId,
    phoneNumber: isGroup ? null : externalSenderId,
    displayName: payload.pushName != null ? String(payload.pushName) : null,
    text,
    isGroup,
  };
}

export function parseTelegramUpdate(body: unknown): ChatOpsInboundMessage | null {
  if (!body || typeof body !== "object") return null;
  const update = body as Record<string, unknown>;
  const message = (update.message ?? update.edited_message) as Record<string, unknown> | undefined;
  if (!message) return null;
  const chat = message.chat as Record<string, unknown> | undefined;
  const from = message.from as Record<string, unknown> | undefined;
  const text = String(message.text ?? "").trim();
  if (!text || !chat) return null;
  const chatType = String(chat.type ?? "private");
  const isGroup = chatType === "group" || chatType === "supergroup";
  const chatId = String(chat.id ?? "");
  const userId = from?.id != null ? String(from.id) : chatId;
  const externalSenderId = isGroup ? `tg:${chatId}` : userId;
  return {
    tenantId: config.defaultTenantId,
    channel: "telegram",
    externalSenderId,
    phoneNumber: null,
    displayName: from?.first_name != null ? String(from.first_name) : null,
    text,
    isGroup,
  };
}
