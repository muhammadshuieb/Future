SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_users' AND COLUMN_NAME = 'name'
    ),
    'SELECT 1',
    'ALTER TABLE `staff_users` ADD COLUMN `name` VARCHAR(128) NOT NULL DEFAULT ''Administrator'' AFTER `tenant_id`'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscribers' AND COLUMN_NAME = 'nickname'
    ),
    'SELECT 1',
    'ALTER TABLE `subscribers` ADD COLUMN `nickname` VARCHAR(128) DEFAULT NULL AFTER `created_by`'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscribers' AND COLUMN_NAME = 'phone'
    ),
    'SELECT 1',
    'ALTER TABLE `subscribers` ADD COLUMN `phone` VARCHAR(32) DEFAULT NULL AFTER `nickname`'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscribers' AND COLUMN_NAME = 'address'
    ),
    'SELECT 1',
    'ALTER TABLE `subscribers` ADD COLUMN `address` VARCHAR(255) DEFAULT NULL AFTER `phone`'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
