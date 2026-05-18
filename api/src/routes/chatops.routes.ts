import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { hasTable } from "../db/schemaGuards.js";
import { handleWhatsAppChatOpsWebhook } from "../services/chatops/chatops-whatsapp-adapter.service.js";
import { handleTelegramChatOpsWebhook } from "../services/chatops/chatops-telegram-adapter.service.js";
import {
  getChatOpsSettings,
  saveChatOpsSettings,
  resolveTelegramWebhookSecret,
} from "../services/chatops/chatops-settings.service.js";
import { listStaffChatIdentities } from "../services/chatops/chatops-auth.service.js";

const router = Router();

router.post("/whatsapp/webhook", async (req, res, next) => {
  try {
    const token = (process.env.CHATOPS_WHATSAPP_WEBHOOK_TOKEN ?? "").trim();
    if (token) {
      const header = String(req.headers["authorization"] ?? "");
      const match = header.match(/^Bearer\s+(.+)$/i);
      if (!match || match[1]!.trim() !== token) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
    }
    const result = await handleWhatsAppChatOpsWebhook(req.body);
    res.status(result.handled ? 200 : 202).json({ ok: true, handled: result.handled });
  } catch (e) {
    next(e);
  }
});

router.post("/telegram/webhook", async (req, res, next) => {
  try {
    const tenantId = config.defaultTenantId;
    const secret = await resolveTelegramWebhookSecret(pool, tenantId);
    if (secret) {
      const header = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
      if (header !== secret) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
    }
    const result = await handleTelegramChatOpsWebhook(req.body);
    res.status(result.handled ? 200 : 202).json({ ok: true, handled: result.handled });
  } catch (e) {
    next(e);
  }
});

router.use(requireAuth);

router.get("/settings", requireRole("admin", "manager"), async (req, res, next) => {
  try {
    const settings = await getChatOpsSettings(pool, req.auth!.tenantId);
    res.json({ settings });
  } catch (e) {
    next(e);
  }
});

const settingsBody = z.object({
  enabled: z.boolean().optional(),
  whatsapp_enabled: z.boolean().optional(),
  telegram_enabled: z.boolean().optional(),
  allow_whatsapp_groups: z.boolean().optional(),
  allow_telegram_groups: z.boolean().optional(),
  commands_per_minute: z.number().int().min(1).max(120).optional(),
  failed_attempts_before_lockout: z.number().int().min(1).max(50).optional(),
  lockout_minutes: z.number().int().min(1).max(1440).optional(),
  max_prepaid_cards_per_command: z.number().int().min(1).max(500).optional(),
  max_financial_amount_non_admin: z.number().min(0).optional(),
  telegram_bot_token: z.string().nullable().optional(),
});

router.put("/settings", requireRole("admin"), async (req, res, next) => {
  try {
    const parsed = settingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const settings = await saveChatOpsSettings(pool, req.auth!.tenantId, parsed.data);
    res.json({ settings });
  } catch (e) {
    next(e);
  }
});

router.get("/identities", requireRole("admin", "manager"), async (req, res, next) => {
  try {
    const items = await listStaffChatIdentities(pool, req.auth!.tenantId);
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

const identityBody = z.object({
  staff_user_id: z.string().uuid(),
  channel: z.enum(["whatsapp", "telegram"]),
  external_id: z.string().min(1).max(128),
  phone_number: z.string().max(32).nullable().optional(),
  display_name: z.string().max(255).nullable().optional(),
  is_active: z.boolean().optional().default(true),
});

router.post("/identities", requireRole("admin", "manager"), async (req, res, next) => {
  try {
    const parsed = identityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    if (!(await hasTable(pool, "staff_chat_identities"))) {
      res.status(503).json({ error: "schema_missing" });
      return;
    }
    const b = parsed.data;
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO staff_chat_identities
       (id, tenant_id, staff_user_id, channel, external_id, phone_number, display_name, is_active, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        id,
        req.auth!.tenantId,
        b.staff_user_id,
        b.channel,
        b.external_id.trim(),
        b.phone_number?.trim() ?? null,
        b.display_name?.trim() ?? null,
        b.is_active ? 1 : 0,
      ]
    );
    res.status(201).json({ id });
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "identity_exists" });
      return;
    }
    next(e);
  }
});

router.delete("/identities/:id", requireRole("admin", "manager"), async (req, res, next) => {
  try {
    if (!(await hasTable(pool, "staff_chat_identities"))) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const [r] = await pool.execute(
      `DELETE FROM staff_chat_identities WHERE id = ? AND tenant_id = ?`,
      [req.params.id, req.auth!.tenantId]
    );
    const affected = (r as { affectedRows?: number }).affectedRows ?? 0;
    if (!affected) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get("/logs", requireRole("admin", "manager"), async (req, res, next) => {
  try {
    const tenantId = req.auth!.tenantId;
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
    if (!(await hasTable(pool, "chatops_commands"))) {
      res.json({ items: [] });
      return;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.*, u.name AS staff_name
       FROM chatops_commands c
       LEFT JOIN users u ON u.id = c.staff_user_id
       WHERE c.tenant_id = ?
       ORDER BY c.created_at DESC
       LIMIT ?`,
      [tenantId, limit]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.get("/pending", requireRole("admin", "manager"), async (req, res, next) => {
  try {
    if (!(await hasTable(pool, "chatops_pending_confirmations"))) {
      res.json({ items: [] });
      return;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.*, u.name AS staff_name
       FROM chatops_pending_confirmations p
       JOIN users u ON u.id = p.staff_user_id
       WHERE p.tenant_id = ? AND p.expires_at > CURRENT_TIMESTAMP(3)
       ORDER BY p.expires_at ASC`,
      [req.auth!.tenantId]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

export default router;
