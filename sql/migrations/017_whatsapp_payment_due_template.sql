SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'whatsapp_templates'
        AND COLUMN_NAME = 'template_key'
        AND LOCATE('payment_due', COLUMN_TYPE) > 0
    ),
    'SELECT 1',
    'ALTER TABLE whatsapp_templates MODIFY COLUMN template_key ENUM(''new_account'',''expiry_soon'',''payment_due'') NOT NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'whatsapp_message_logs'
        AND COLUMN_NAME = 'template_key'
        AND LOCATE('payment_due', COLUMN_TYPE) > 0
    ),
    'SELECT 1',
    'ALTER TABLE whatsapp_message_logs MODIFY COLUMN template_key ENUM(''new_account'',''expiry_soon'',''payment_due'') NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO whatsapp_templates (tenant_id, template_key, body)
SELECT
  ws.tenant_id,
  'payment_due',
  'مرحباً {{full_name}}،\nنود تذكيرك بوجود ذمة مالية مستحقة على حسابك.\n\n• إجمالي المستحقات: {{due_amount}} {{currency}}\n• عدد الفواتير غير المدفوعة: {{unpaid_count}}\n• أقدم تاريخ استحقاق: {{oldest_due_date}}\n\nيرجى السداد في أقرب وقت لتجنب أي انقطاع بالخدمة. شكراً لتعاونك.'
FROM whatsapp_settings ws
WHERE NOT EXISTS (
  SELECT 1
  FROM whatsapp_templates wt
  WHERE wt.tenant_id = ws.tenant_id
    AND wt.template_key = 'payment_due'
);
