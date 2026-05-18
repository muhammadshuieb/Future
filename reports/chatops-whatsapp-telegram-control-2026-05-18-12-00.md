# ChatOps — WhatsApp & Telegram Control

**Date:** 2026-05-18  
**Project:** Future Radius

## Summary

Implemented a unified **ChatOps** engine so authorized staff can query subscribers, run safe billing actions, print prepaid cards, and view monitoring status from **WhatsApp (WAHA)** or **Telegram**, with Arabic-first replies, permission checks, confirmation for dangerous actions, rate limits, and audit logging.

## Architecture

```
WhatsApp (WAHA webhook) ──┐
                          ├──► chatops-router ──► auth ──► parser ──► executor ──► existing services
Telegram (Bot webhook) ───┘                              │
                                                           ├── pending confirmations (2 min TTL)
                                                           ├── chatops_messages / chatops_commands
                                                           └── audit_logs + financial_audit_logs
```

### Core services (`api/src/services/chatops/`)

| File | Role |
|------|------|
| `chatops-router.service.ts` | Entry: rate limit, auth, confirm flow, logging |
| `chatops-auth.service.ts` | `staff_chat_identities` lookup + `chatops:*` permissions |
| `chatops-command-parser.service.ts` | Deterministic Arabic keyword parser |
| `chatops-executor.service.ts` | Delegates to billing, CoA, rm-cards, monitoring |
| `chatops-whatsapp-adapter.service.ts` | WAHA inbound/outbound |
| `chatops-telegram-adapter.service.ts` | Telegram Bot API inbound/outbound |
| `chatops-payload-parse.ts` | Webhook payload parsing (test-friendly, no Redis) |
| `chatops-settings.service.ts` | Tenant ChatOps settings + Telegram token |
| `chatops-confirmation.service.ts` | 2-minute confirmation codes |
| `chatops-rate-limit.service.ts` | Per-sender limits and lockout |
| `chatops-log.service.ts` | DB message/command logs |

## Database (`sql/migrations/027_chatops.sql`)

- `staff_chat_identities` — link staff to WhatsApp number / Telegram user id
- `chatops_settings` — enable flags, rate limits, Telegram token (encrypted)
- `chatops_messages`, `chatops_commands`, `chatops_pending_confirmations`
- `chatops_rate_limits`

## Permissions (`api/src/lib/chatops-permissions.ts`)

- `chatops:use`, `chatops:view_subscriber`, `chatops:create_subscriber`, `chatops:renew_subscriber`
- `chatops:disconnect_user`, `chatops:view_finance`, `chatops:print_prepaid_cards`
- `chatops:view_monitoring`, `chatops:execute_router_actions`

Merged into JWT for **admin** (all on) and **manager** (defaults in `staff_role_permissions` / `users.permissions_json`).

## API routes (`/api/chatops`)

| Method | Path | Notes |
|--------|------|--------|
| POST | `/whatsapp/webhook` | Optional `CHATOPS_WHATSAPP_WEBHOOK_TOKEN` |
| POST | `/telegram/webhook` | Optional `TELEGRAM_WEBHOOK_SECRET` header |
| GET/PUT | `/settings` | Admin PUT |
| GET/POST/DELETE | `/identities` | Staff linking |
| GET | `/logs`, `/pending` | Command history |

## Security

- Unknown senders rejected (Arabic: «غير مصرح…»)
- No raw SQL from chat; all actions via existing services
- Dangerous commands require `تأكيد CODE` within **2 minutes**
- Rate limit per sender; lockout after repeated failures
- Max prepaid batch size and non-admin financial caps from settings

## WhatsApp note

WAHA may **not deliver webhooks for messages sent by the connected session owner number**. Operators should use a **separate admin phone** linked in `staff_chat_identities`, or use **Telegram** for commands.

Configure WAHA to POST message events to:

`POST https://<api-host>/api/chatops/whatsapp/webhook`

## Telegram

Set `TELEGRAM_BOT_TOKEN` (env) or save token in ChatOps settings. Register webhook:

`POST https://<api-host>/api/chatops/telegram/webhook`

## UI

- Route: `/chatops`
- Sections: settings, manager linking, permissions reference, command log, pending confirmations, examples
- Nav: under WhatsApp group in admin shell

## Tests

`api/src/tests/chatops.test.ts` — parser, permissions, webhook parsing, confirmation prompt (10 tests, all passing).

## Validation

| Check | Result |
|-------|--------|
| `npm test` (chatops suite) | Pass |
| `npm run build` (api) | Pass |
| `npm run build` (frontend) | Pass |
| `docker compose config` | Run on host |

## Environment variables

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
CHATOPS_WHATSAPP_WEBHOOK_TOKEN=
```

## Example commands (Arabic)

```
تفاصيل المشترك ali
حالة ali
افصل ali
جدد ali شهر
أنشئ مشترك username=ali password=123456 phone=09xxx package=10M
كم عدد المتصلين الآن؟
حالة السيرفرات
رصيد المدير محمد
تقرير اليوم
اطبع 10 كرت باقة 5M
```

After a dangerous command, reply: `تأكيد 1234` (code shown in prompt).

## Follow-ups (optional)

- Register Telegram `setWebhook` helper endpoint in admin UI
- Richer prepaid print link/PDF reply
- Acknowledge monitoring alerts via chat
- AI parser layer (still must pass validation + confirmation)
