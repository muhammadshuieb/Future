-- Incremental upgrade for databases created from an older schema_extensions.sql
-- (before enterprise columns). Do NOT run if you already applied the current schema_extensions.sql.

SET NAMES utf8mb4;

ALTER TABLE `packages`
  ADD COLUMN `default_framed_pool` VARCHAR(64) DEFAULT NULL COMMENT 'Framed-Pool default for radreply' AFTER `mikrotik_address_list`;

ALTER TABLE `subscribers`
  ADD COLUMN `start_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER `expiration_date`,
  ADD COLUMN `used_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `start_date`,
  ADD COLUMN `nas_server_id` CHAR(36) DEFAULT NULL AFTER `used_bytes`,
  ADD COLUMN `radius_password_encrypted` VARBINARY(512) DEFAULT NULL COMMENT 'AES-GCM; recreate radcheck after disable' AFTER `nas_server_id`;

ALTER TABLE `nas_servers`
  ADD COLUMN `online_status` ENUM('unknown','online','offline') NOT NULL DEFAULT 'unknown' AFTER `coa_port`,
  ADD COLUMN `last_ping_ok` TINYINT(1) DEFAULT NULL AFTER `online_status`,
  ADD COLUMN `last_radius_ok` TINYINT(1) DEFAULT NULL AFTER `last_ping_ok`,
  ADD COLUMN `last_check_at` DATETIME(3) DEFAULT NULL AFTER `last_radius_ok`,
  ADD COLUMN `session_count` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `last_check_at`;

ALTER TABLE `subscribers`
  ADD KEY `idx_subscribers_nas` (`nas_server_id`);

CREATE TABLE IF NOT EXISTS `inventory_categories` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_inv_cat_tenant` (`tenant_id`),
  CONSTRAINT `fk_inv_cat_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_products` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `category_id` CHAR(36) DEFAULT NULL,
  `sku` VARCHAR(64) NOT NULL,
  `name` VARCHAR(256) NOT NULL,
  `unit` VARCHAR(32) NOT NULL DEFAULT 'pcs',
  `unit_cost` DECIMAL(13,2) NOT NULL DEFAULT 0.00,
  `stock_qty` INT NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inv_sku_tenant` (`tenant_id`,`sku`),
  KEY `idx_inv_prod_cat` (`category_id`),
  CONSTRAINT `fk_inv_prod_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `fk_inv_prod_cat` FOREIGN KEY (`category_id`) REFERENCES `inventory_categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_movements` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `delta_qty` INT NOT NULL,
  `reason` VARCHAR(255) DEFAULT NULL,
  `invoice_id` CHAR(36) DEFAULT NULL,
  `staff_id` CHAR(36) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_inv_mov_product` (`product_id`),
  KEY `idx_inv_mov_invoice` (`invoice_id`),
  CONSTRAINT `fk_inv_mov_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `fk_inv_mov_product` FOREIGN KEY (`product_id`) REFERENCES `inventory_products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_inv_mov_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `staff_id` CHAR(36) DEFAULT NULL,
  `kind` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT,
  `read_at` DATETIME(3) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_notif_tenant` (`tenant_id`,`created_at`),
  CONSTRAINT `fk_notif_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `subscribers`
  ADD CONSTRAINT `fk_subscribers_nas_server` FOREIGN KEY (`nas_server_id`) REFERENCES `nas_servers` (`id`) ON DELETE SET NULL;
