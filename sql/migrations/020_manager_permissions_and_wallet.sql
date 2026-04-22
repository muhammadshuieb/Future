-- Manager permissions + wallet support

SET @db := DATABASE();

SET @has_permissions_json := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'staff_users' AND COLUMN_NAME = 'permissions_json'
);
SET @sql := IF(
  @has_permissions_json = 0,
  'ALTER TABLE `staff_users` ADD COLUMN `permissions_json` JSON NULL AFTER `role`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_parent_staff_id := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'staff_users' AND COLUMN_NAME = 'parent_staff_id'
);
SET @sql := IF(
  @has_parent_staff_id = 0,
  'ALTER TABLE `staff_users` ADD COLUMN `parent_staff_id` CHAR(36) NULL AFTER `permissions_json`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_opening_balance := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'staff_users' AND COLUMN_NAME = 'opening_balance'
);
SET @sql := IF(
  @has_opening_balance = 0,
  'ALTER TABLE `staff_users` ADD COLUMN `opening_balance` DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `active`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_wallet_balance := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'staff_users' AND COLUMN_NAME = 'wallet_balance'
);
SET @sql := IF(
  @has_wallet_balance = 0,
  'ALTER TABLE `staff_users` ADD COLUMN `wallet_balance` DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `opening_balance`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `manager_wallet_transactions` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `tenant_id` CHAR(36) NOT NULL,
  `staff_id` CHAR(36) NOT NULL,
  `actor_staff_id` CHAR(36) NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `currency` VARCHAR(8) NULL,
  `tx_type` VARCHAR(32) NOT NULL,
  `note` VARCHAR(255) NULL,
  `related_subscriber_id` CHAR(36) NULL,
  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_wallet_tx_tenant_staff_created` (`tenant_id`, `staff_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
