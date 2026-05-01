-- Future Radius extension tables used by runtime services.
-- Keep statements idempotent because this file may be re-applied.

-- Legacy table removed; staff data now comes from rm_managers only.
DROP TABLE IF EXISTS `staff_users`;

CREATE TABLE IF NOT EXISTS `manager_wallet_transactions` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `staff_id` CHAR(36) NOT NULL,
  `actor_staff_id` CHAR(36) DEFAULT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `tx_type` VARCHAR(48) NOT NULL,
  `note` VARCHAR(255) DEFAULT NULL,
  `related_subscriber_id` CHAR(36) DEFAULT NULL,
  `currency` VARCHAR(8) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_manager_wallet_tx_staff` (`tenant_id`,`staff_id`,`created_at`),
  KEY `idx_manager_wallet_tx_actor` (`tenant_id`,`actor_staff_id`,`created_at`),
  KEY `idx_manager_wallet_tx_sub` (`tenant_id`,`related_subscriber_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `server_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `level` ENUM('error','warn','info','debug') NOT NULL DEFAULT 'info',
  `source` VARCHAR(64) NOT NULL DEFAULT 'api',
  `category` VARCHAR(96) DEFAULT NULL,
  `message` VARCHAR(8000) NOT NULL,
  `stack` MEDIUMTEXT DEFAULT NULL,
  `meta` JSON DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_server_logs_level_created` (`level`,`created_at`),
  KEY `idx_server_logs_source_created` (`source`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `server_log_alerts` (
  `id` CHAR(36) NOT NULL,
  `log_id` BIGINT UNSIGNED NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `status` ENUM('sent','failed','skipped') NOT NULL DEFAULT 'skipped',
  `error_message` VARCHAR(4000) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_server_log_alerts_log` (`log_id`),
  KEY `idx_server_log_alerts_tenant_created` (`tenant_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
