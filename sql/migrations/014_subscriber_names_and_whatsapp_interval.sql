SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'subscribers'
        AND COLUMN_NAME = 'first_name'
    ),
    'SELECT 1',
    'ALTER TABLE subscribers ADD COLUMN first_name VARCHAR(128) NULL AFTER created_by'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'subscribers'
        AND COLUMN_NAME = 'last_name'
    ),
    'SELECT 1',
    'ALTER TABLE subscribers ADD COLUMN last_name VARCHAR(128) NULL AFTER first_name'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'whatsapp_settings'
        AND COLUMN_NAME = 'message_interval_seconds'
    ),
    'SELECT 1',
    'ALTER TABLE whatsapp_settings ADD COLUMN message_interval_seconds INT NOT NULL DEFAULT 30 AFTER reminder_days'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
