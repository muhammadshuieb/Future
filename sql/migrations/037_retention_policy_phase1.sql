-- Phase 1 data retention policy: configurable columns + retire fixed 30-day radacct MySQL event.
-- Pruning runs via worker job `prune-data-retention` (see data-retention.service.ts).

SET NAMES utf8mb4;

DROP EVENT IF EXISTS `cleanup_radacct`;

ALTER TABLE system_settings
  ADD COLUMN radacct_closed_retention_days INT NOT NULL DEFAULT 180
    COMMENT 'Delete closed radacct rows older than N days (worker daily)'
    AFTER whatsapp_log_retention_days;

ALTER TABLE system_settings
  ADD COLUMN sessions_offline_retention_days INT NOT NULL DEFAULT 90
    COMMENT 'Delete sessions rows in OFFLINE state older than N days'
    AFTER radacct_closed_retention_days;

ALTER TABLE system_settings
  ADD COLUMN user_usage_daily_retention_days INT NOT NULL DEFAULT 365
    COMMENT 'Delete user_usage_daily rows older than N days'
    AFTER sessions_offline_retention_days;

ALTER TABLE system_settings
  ADD COLUMN radpostauth_retention_days INT NOT NULL DEFAULT 90
    COMMENT 'Delete radpostauth rows older than N days (replaces month-based default when set)'
    AFTER radpostauth_retention_months;

ALTER TABLE system_settings
  MODIFY COLUMN server_log_retention_days INT NOT NULL DEFAULT 14;

ALTER TABLE system_settings
  MODIFY COLUMN whatsapp_log_retention_days INT NOT NULL DEFAULT 30;
