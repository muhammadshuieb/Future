SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'nas_servers'
        AND COLUMN_NAME = 'password_encrypted'
    ),
    'SELECT 1',
    'ALTER TABLE nas_servers ADD COLUMN password_encrypted VARBINARY(512) NULL AFTER secret_encrypted'
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
        AND TABLE_NAME = 'nas_servers'
        AND COLUMN_NAME = 'mikrotik_api_enabled'
    ),
    'SELECT 1',
    'ALTER TABLE nas_servers ADD COLUMN mikrotik_api_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER type'
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
        AND TABLE_NAME = 'nas_servers'
        AND COLUMN_NAME = 'mikrotik_api_user'
    ),
    'SELECT 1',
    'ALTER TABLE nas_servers ADD COLUMN mikrotik_api_user VARCHAR(128) NULL AFTER mikrotik_api_enabled'
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
        AND TABLE_NAME = 'nas_servers'
        AND COLUMN_NAME = 'mikrotik_api_password_encrypted'
    ),
    'SELECT 1',
    'ALTER TABLE nas_servers ADD COLUMN mikrotik_api_password_encrypted VARBINARY(512) NULL AFTER mikrotik_api_user'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
