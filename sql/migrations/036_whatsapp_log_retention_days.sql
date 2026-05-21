-- WhatsApp message log retention (default 7 days, configurable in system_settings).

SET NAMES utf8mb4;

ALTER TABLE system_settings
  ADD COLUMN whatsapp_log_retention_days INT NOT NULL DEFAULT 7
  COMMENT 'Delete whatsapp_message_logs older than N days (worker hourly prune)'
  AFTER server_log_retention_days;
