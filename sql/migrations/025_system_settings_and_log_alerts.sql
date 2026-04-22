CREATE TABLE IF NOT EXISTS `system_settings` (
  `tenant_id` CHAR(36) NOT NULL,
  `critical_alert_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `critical_alert_phone` VARCHAR(32) DEFAULT NULL,
  `critical_alert_use_session_owner` TINYINT(1) NOT NULL DEFAULT 1,
  `server_log_retention_days` INT NOT NULL DEFAULT 14,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `server_log_alerts` (
  `id` CHAR(36) NOT NULL,
  `log_id` BIGINT UNSIGNED NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `status` ENUM('sent','failed','skipped') NOT NULL DEFAULT 'skipped',
  `error_message` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_server_log_alerts_log_id` (`log_id`),
  KEY `idx_server_log_alerts_tenant_created` (`tenant_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
