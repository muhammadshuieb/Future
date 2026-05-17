ALTER TABLE infrastructure_monitoring_settings
  ADD COLUMN telegram_chat_id VARCHAR(64) NULL AFTER poll_interval_seconds,
  ADD COLUMN telegram_bot_token_encrypted VARBINARY(512) NULL AFTER telegram_chat_id,
  ADD COLUMN telegram_alerts_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER telegram_bot_token_encrypted,
  ADD COLUMN telegram_last_test_ok TINYINT(1) NULL AFTER telegram_alerts_enabled,
  ADD COLUMN telegram_last_error VARCHAR(512) NULL AFTER telegram_last_test_ok;
