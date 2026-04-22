SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'whatsapp_message_logs'
        AND COLUMN_NAME = 'template_key'
        AND LOCATE('invoice_paid', COLUMN_TYPE) > 0
    ),
    'SELECT 1',
    'ALTER TABLE whatsapp_message_logs MODIFY COLUMN template_key ENUM(''new_account'',''expiry_soon'',''payment_due'',''usage_threshold'',''invoice_paid'') NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
