-- Hierarchical subscriber regions (zones) and optional link on subscribers.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `subscriber_regions` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `parent_id` CHAR(36) DEFAULT NULL,
  `name` VARCHAR(128) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_subscriber_regions_tenant` (`tenant_id`),
  KEY `idx_subscriber_regions_parent` (`tenant_id`, `parent_id`),
  CONSTRAINT `fk_subscriber_regions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_subscriber_regions_parent` FOREIGN KEY (`parent_id`) REFERENCES `subscriber_regions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscribers' AND COLUMN_NAME = 'region_id'
    ),
    'SELECT 1',
    'ALTER TABLE `subscribers`
      ADD COLUMN `region_id` CHAR(36) DEFAULT NULL AFTER `address`,
      ADD KEY `idx_subscribers_region` (`region_id`),
      ADD CONSTRAINT `fk_subscribers_region` FOREIGN KEY (`region_id`) REFERENCES `subscriber_regions` (`id`) ON DELETE SET NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
