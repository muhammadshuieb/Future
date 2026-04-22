CREATE TABLE IF NOT EXISTS `server_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `level` ENUM('error','warn','info','debug') NOT NULL DEFAULT 'info',
  `source` VARCHAR(64) NOT NULL DEFAULT 'api',
  `category` VARCHAR(96) DEFAULT NULL,
  `message` TEXT NOT NULL,
  `stack` MEDIUMTEXT DEFAULT NULL,
  `meta` JSON DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_server_logs_created_at` (`created_at`),
  KEY `idx_server_logs_level` (`level`),
  KEY `idx_server_logs_source` (`source`),
  KEY `idx_server_logs_level_created` (`level`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
