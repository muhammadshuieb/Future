-- ChatOps: WhatsApp/Telegram command control for authorized staff

CREATE TABLE IF NOT EXISTS staff_chat_identities (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  staff_user_id CHAR(36) NOT NULL,
  channel ENUM('whatsapp', 'telegram') NOT NULL,
  external_id VARCHAR(128) NOT NULL,
  phone_number VARCHAR(32) NULL,
  display_name VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_staff_chat_identity (tenant_id, channel, external_id),
  KEY idx_staff_chat_staff (tenant_id, staff_user_id),
  KEY idx_staff_chat_phone (tenant_id, channel, phone_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chatops_settings (
  tenant_id CHAR(36) NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  whatsapp_enabled TINYINT(1) NOT NULL DEFAULT 1,
  telegram_enabled TINYINT(1) NOT NULL DEFAULT 1,
  telegram_bot_token_encrypted VARBINARY(512) NULL,
  telegram_webhook_secret VARCHAR(128) NULL,
  allow_whatsapp_groups TINYINT(1) NOT NULL DEFAULT 0,
  allow_telegram_groups TINYINT(1) NOT NULL DEFAULT 0,
  commands_per_minute INT NOT NULL DEFAULT 20,
  failed_attempts_before_lockout INT NOT NULL DEFAULT 5,
  lockout_minutes INT NOT NULL DEFAULT 15,
  max_prepaid_cards_per_command INT NOT NULL DEFAULT 50,
  max_financial_amount_non_admin DECIMAL(12,2) NOT NULL DEFAULT 500.00,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chatops_messages (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  channel ENUM('whatsapp', 'telegram') NOT NULL,
  direction ENUM('inbound', 'outbound') NOT NULL,
  external_sender_id VARCHAR(128) NOT NULL,
  staff_user_id CHAR(36) NULL,
  message_body TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_chatops_msg_tenant_time (tenant_id, created_at),
  KEY idx_chatops_msg_sender (tenant_id, channel, external_sender_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chatops_commands (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  channel ENUM('whatsapp', 'telegram') NOT NULL,
  staff_user_id CHAR(36) NULL,
  external_sender_id VARCHAR(128) NOT NULL,
  raw_message TEXT NOT NULL,
  parsed_command VARCHAR(128) NULL,
  target_entity VARCHAR(255) NULL,
  status ENUM('parsed', 'denied', 'pending_confirmation', 'executed', 'failed', 'ignored') NOT NULL,
  response_text TEXT NULL,
  confirmation_status ENUM('none', 'pending', 'confirmed', 'expired', 'rejected') NOT NULL DEFAULT 'none',
  error_message VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  executed_at DATETIME(3) NULL,
  KEY idx_chatops_cmd_tenant_time (tenant_id, created_at),
  KEY idx_chatops_cmd_staff (tenant_id, staff_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chatops_pending_confirmations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  staff_user_id CHAR(36) NOT NULL,
  channel ENUM('whatsapp', 'telegram') NOT NULL,
  external_sender_id VARCHAR(128) NOT NULL,
  command_type VARCHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  confirmation_code VARCHAR(8) NOT NULL,
  summary_text TEXT NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_chatops_confirm_expires (tenant_id, expires_at),
  KEY idx_chatops_confirm_sender (tenant_id, channel, external_sender_id, confirmation_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chatops_rate_limits (
  tenant_id CHAR(36) NOT NULL,
  channel ENUM('whatsapp', 'telegram') NOT NULL,
  external_sender_id VARCHAR(128) NOT NULL,
  window_start DATETIME(3) NOT NULL,
  command_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  PRIMARY KEY (tenant_id, channel, external_sender_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
