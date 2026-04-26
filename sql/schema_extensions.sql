-- Database: radius  (نفس اسم القاعدة في radius.sql)
-- Future Radius: NEW tables only. Apply AFTER loading radius.sql (DMA + FreeRADIUS).
-- Does NOT alter radcheck, radreply, radacct, nas, rm_* tables.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Tenants (multi-tenant root)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tenants` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `tenants` (`id`, `name`) VALUES ('00000000-0000-0000-0000-000000000001', 'Default');

-- ---------------------------------------------------------------------------
-- Packages (modern catalog; map rate/shape to FreeRADIUS radreply attributes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `packages` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `mikrotik_rate_limit` VARCHAR(253) DEFAULT NULL COMMENT 'Value for Mikrotik-Rate-Limit',
  `framed_ip_address` VARCHAR(15) DEFAULT NULL,
  `mikrotik_address_list` VARCHAR(253) DEFAULT NULL,
  `default_framed_pool` VARCHAR(64) DEFAULT NULL COMMENT 'Framed-Pool default for radreply',
  `simultaneous_use` INT NOT NULL DEFAULT 1,
  `quota_total_bytes` BIGINT NOT NULL DEFAULT 0 COMMENT '0 = unlimited combined quota',
  `billing_period_days` INT NOT NULL DEFAULT 30,
  `price` DECIMAL(13,2) NOT NULL DEFAULT 0.00,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `rm_srvid` INT DEFAULT NULL COMMENT 'Optional map to rm_services.srvid',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_packages_tenant_rm_srvid` (`tenant_id`, `rm_srvid`),
  KEY `idx_packages_tenant` (`tenant_id`),
  CONSTRAINT `fk_packages_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Subscribers (links to radcheck.username; operational status for modern API)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `subscribers` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `username` VARCHAR(64) NOT NULL COMMENT 'Matches radcheck.username',
  `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `package_id` CHAR(36) DEFAULT NULL,
  `expiration_date` DATETIME NOT NULL COMMENT 'Canonical expiry; renewals extend from this at 12:00',
  `start_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `used_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Synced from user_usage_live by worker',
  `nas_server_id` CHAR(36) DEFAULT NULL,
  `radius_password_encrypted` VARBINARY(512) DEFAULT NULL COMMENT 'AES-GCM; recreate radcheck after disable',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` CHAR(36) DEFAULT NULL COMMENT 'staff_users.id or NULL',
  `nickname` VARCHAR(128) DEFAULT NULL,
  `phone` VARCHAR(32) DEFAULT NULL,
  `address` VARCHAR(255) DEFAULT NULL,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `mac_address` VARCHAR(17) DEFAULT NULL,
  `pool` VARCHAR(64) DEFAULT NULL,
  `notes` TEXT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subscribers_tenant_username` (`tenant_id`,`username`),
  KEY `idx_subscribers_package` (`package_id`),
  KEY `idx_subscribers_exp` (`expiration_date`),
  KEY `idx_subscribers_nas` (`nas_server_id`),
  CONSTRAINT `fk_subscribers_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `fk_subscribers_package` FOREIGN KEY (`package_id`) REFERENCES `packages` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Billing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `invoices` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `subscriber_id` CHAR(36) NOT NULL,
  `period` ENUM('monthly','yearly','one_time') NOT NULL DEFAULT 'monthly',
  `invoice_no` VARCHAR(32) NOT NULL,
  `issue_date` DATE NOT NULL,
  `due_date` DATE NOT NULL,
  `amount` DECIMAL(13,2) NOT NULL,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
  `status` ENUM('draft','sent','paid','void') NOT NULL DEFAULT 'draft',
  `meta` JSON DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoice_no_tenant` (`tenant_id`,`invoice_no`),
  KEY `idx_invoices_subscriber` (`subscriber_id`),
  CONSTRAINT `fk_invoices_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `fk_invoices_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payments` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `invoice_id` CHAR(36) NOT NULL,
  `amount` DECIMAL(13,2) NOT NULL,
  `method` VARCHAR(32) NOT NULL DEFAULT 'manual',
  `reference` VARCHAR(128) DEFAULT NULL,
  `paid_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_payments_invoice` (`invoice_id`),
  CONSTRAINT `fk_payments_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `fk_payments_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- NAS overlay (encrypted secret; optional link to legacy nas.id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `nas_servers` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `legacy_nas_id` INT DEFAULT NULL COMMENT 'Optional nas.id from DMA',
  `name` VARCHAR(128) NOT NULL,
  `ip` VARCHAR(45) NOT NULL,
  `secret_encrypted` VARBINARY(512) NOT NULL,
  `password_encrypted` VARBINARY(512) DEFAULT NULL,
  `type` VARCHAR(32) NOT NULL DEFAULT 'mikrotik',
  `mikrotik_api_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `mikrotik_api_user` VARCHAR(128) DEFAULT NULL,
  `mikrotik_api_password_encrypted` VARBINARY(512) DEFAULT NULL,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `coa_port` INT NOT NULL DEFAULT 3799,
  `online_status` ENUM('unknown','online','offline') NOT NULL DEFAULT 'unknown',
  `last_ping_ok` TINYINT(1) DEFAULT NULL,
  `last_radius_ok` TINYINT(1) DEFAULT NULL,
  `last_check_at` DATETIME(3) DEFAULT NULL,
  `session_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_nas_tenant` (`tenant_id`),
  KEY `idx_nas_legacy` (`legacy_nas_id`),
  CONSTRAINT `fk_nas_servers_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Usage caches (aggregated from radacct)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_usage_live` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` CHAR(36) NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `total_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usage_live_user_tenant` (`tenant_id`,`username`),
  KEY `idx_usage_live_updated` (`updated_at`),
  CONSTRAINT `fk_user_usage_live_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_usage_daily` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` CHAR(36) NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `day` DATE NOT NULL,
  `total_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usage_daily_user_day` (`tenant_id`,`username`,`day`),
  KEY `idx_usage_daily_day` (`day`),
  CONSTRAINT `fk_user_usage_daily_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_quota_state` (
  `tenant_id` CHAR(36) NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `quota_date` DATE NOT NULL,
  `enforced_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`,`username`,`quota_date`),
  KEY `idx_uqs_tenant_date` (`tenant_id`,`quota_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Staff & audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `staff_users` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('admin','manager','accountant','viewer') NOT NULL DEFAULT 'viewer',
  `permissions_json` JSON DEFAULT NULL,
  `parent_staff_id` CHAR(36) DEFAULT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `opening_balance` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `wallet_balance` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_staff_email_tenant` (`tenant_id`,`email`),
  KEY `idx_staff_parent` (`tenant_id`,`parent_staff_id`),
  CONSTRAINT `fk_staff_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `manager_wallet_transactions` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `staff_id` CHAR(36) NOT NULL,
  `actor_staff_id` CHAR(36) DEFAULT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `currency` VARCHAR(8) DEFAULT NULL,
  `tx_type` VARCHAR(32) NOT NULL,
  `note` VARCHAR(255) DEFAULT NULL,
  `related_subscriber_id` CHAR(36) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_wallet_tx_tenant_staff_created` (`tenant_id`,`staff_id`,`created_at`),
  CONSTRAINT `fk_wallet_tx_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `staff_role_permissions` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `role` ENUM('admin','manager','accountant','viewer') NOT NULL,
  `permissions_json` JSON NOT NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_staff_role_permissions_tenant_role` (`tenant_id`,`role`),
  KEY `idx_staff_role_permissions_tenant` (`tenant_id`),
  CONSTRAINT `fk_staff_role_permissions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `staff_id` CHAR(36) DEFAULT NULL,
  `action` VARCHAR(64) NOT NULL,
  `entity_type` VARCHAR(64) NOT NULL,
  `entity_id` VARCHAR(64) DEFAULT NULL,
  `payload` JSON DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_audit_tenant_time` (`tenant_id`,`created_at`),
  CONSTRAINT `fk_audit_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- FK إلى nas_servers: قد تكون موجودة مسبقاً (استعادة / تشغيل سابق). الخدمة تسبق الملف بـ USE.
-- referential_constraints أدق من table_constraints لأنواع MySQL 8.4
SET @c_fk_nas = (
  SELECT COUNT(*) FROM information_schema.referential_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'subscribers'
    AND constraint_name = 'fk_subscribers_nas_server'
    AND referenced_table_name = 'nas_servers'
);
SET @q_fk_nas = IF(
  @c_fk_nas = 0,
  'ALTER TABLE `subscribers` ADD CONSTRAINT `fk_subscribers_nas_server` FOREIGN KEY (`nas_server_id`) REFERENCES `nas_servers` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_fk_nas FROM @q_fk_nas;
EXECUTE stmt_fk_nas;
DEALLOCATE PREPARE stmt_fk_nas;

SET FOREIGN_KEY_CHECKS = 1;
