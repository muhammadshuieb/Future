import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasChatOpsPermission,
  defaultChatOpsPermissionsManager,
} from "../lib/chatops-permissions.js";
import { parseChatOpsCommand } from "../services/chatops/chatops-command-parser.service.js";
import { parseWahaInbound, parseTelegramUpdate } from "../services/chatops/chatops-payload-parse.js";
import { formatConfirmationPrompt } from "../services/chatops/chatops-confirmation.service.js";

describe("chatops command parser", () => {
  it("parses subscriber details in Arabic", () => {
    const cmd = parseChatOpsCommand("تفاصيل المشترك ali");
    assert.equal(cmd.type, "subscriber_details");
    assert.equal(cmd.target, "ali");
    assert.equal(cmd.permission, "chatops:view_subscriber");
  });

  it("parses create subscriber as confirmation-required", () => {
    const cmd = parseChatOpsCommand(
      "أنشئ مشترك username=ali password=123456 phone=0999999999 package=10M"
    );
    assert.equal(cmd.type, "create_subscriber");
    assert.equal(cmd.requiresConfirmation, true);
    assert.equal(cmd.args.username, "ali");
  });

  it("parses confirm command", () => {
    const cmd = parseChatOpsCommand("تأكيد 4821");
    assert.equal(cmd.type, "confirm");
    assert.equal(cmd.args.code, "4821");
  });

  it("parses online count", () => {
    const cmd = parseChatOpsCommand("كم عدد المتصلين الآن؟");
    assert.equal(cmd.type, "online_count");
  });
});

describe("chatops permissions", () => {
  it("denies manager without chatops:use", () => {
    const perms = { ...defaultChatOpsPermissionsManager(), "chatops:use": false };
    assert.equal(
      hasChatOpsPermission({ role: "manager", permissions: perms }, "chatops:view_subscriber"),
      false
    );
  });

  it("allows admin for financial command permission", () => {
    assert.equal(
      hasChatOpsPermission({ role: "admin", permissions: {} }, "chatops:view_finance"),
      true
    );
  });

  it("requires specific permission for prepaid print", () => {
    const perms = { ...defaultChatOpsPermissionsManager(), "chatops:print_prepaid_cards": false };
    assert.equal(
      hasChatOpsPermission({ role: "manager", permissions: perms }, "chatops:print_prepaid_cards"),
      false
    );
  });
});

describe("chatops webhooks parsing", () => {
  it("parses WAHA message payload", () => {
    const msg = parseWahaInbound({
      event: "message",
      payload: { from: "963999888777@c.us", body: "حالة ali", pushName: "Admin" },
    });
    assert.ok(msg);
    assert.equal(msg.channel, "whatsapp");
    assert.equal(msg.text, "حالة ali");
    assert.equal(msg.externalSenderId, "963999888777");
  });

  it("parses Telegram private message", () => {
    const msg = parseTelegramUpdate({
      update_id: 1,
      message: {
        message_id: 2,
        from: { id: 12345, first_name: "Moh" },
        chat: { id: 12345, type: "private" },
        text: "تفاصيل ali",
      },
    });
    assert.ok(msg);
    assert.equal(msg.channel, "telegram");
    assert.equal(msg.externalSenderId, "12345");
    assert.equal(msg.text, "تفاصيل ali");
  });
});

describe("chatops confirmation", () => {
  it("formats Arabic confirmation prompt with code", () => {
    const text = formatConfirmationPrompt("سيتم إنشاء المشترك:\nالاسم: ali", "1234");
    assert.match(text, /تأكيد 1234/);
    assert.match(text, /دقيقتين/);
  });
});
