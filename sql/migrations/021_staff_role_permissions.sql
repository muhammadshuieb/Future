CREATE TABLE IF NOT EXISTS `staff_role_permissions` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `tenant_id` CHAR(36) NOT NULL,
  `role` ENUM('admin','manager','accountant','viewer') NOT NULL,
  `permissions_json` JSON NOT NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uq_staff_role_permissions_tenant_role` (`tenant_id`, `role`),
  KEY `idx_staff_role_permissions_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
