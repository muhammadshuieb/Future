SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'whatsapp_settings'
        AND COLUMN_NAME = 'usage_alert_thresholds'
    ),
    'SELECT 1',
    'ALTER TABLE whatsapp_settings ADD COLUMN usage_alert_thresholds VARCHAR(64) NOT NULL DEFAULT ''10,20,30,50'' AFTER auto_send_new'
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
        AND TABLE_NAME = 'whatsapp_templates'
        AND COLUMN_NAME = 'template_key'
        AND LOCATE('usage_threshold', COLUMN_TYPE) > 0
    ),
    'SELECT 1',
    'ALTER TABLE whatsapp_templates MODIFY COLUMN template_key ENUM(''new_account'',''expiry_soon'',''payment_due'',''usage_threshold'') NOT NULL'
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
        AND LOCATE('usage_threshold', COLUMN_TYPE) > 0
    ),
    'SELECT 1',
    'ALTER TABLE whatsapp_message_logs MODIFY COLUMN template_key ENUM(''new_account'',''expiry_soon'',''payment_due'',''usage_threshold'') NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS whatsapp_usage_alerts_sent (
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NOT NULL,
  threshold_percent INT NOT NULL,
  month_key CHAR(7) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, subscriber_id, threshold_percent, month_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO whatsapp_templates (tenant_id, template_key, body)
SELECT
  ws.tenant_id,
  'usage_threshold',
  'مرحباً {{full_name}}،\nتنبيه استهلاك الباقة: وصلت إلى {{usage_percent}}% من الحصة.\n\n• المستخدم: {{username}}\n• المستهلك: {{used_gb}} GB من أصل {{quota_gb}} GB\n• المتبقي: {{remaining_percent}}%\n• تاريخ انتهاء الباقة: {{expiration_date}} (المتبقي {{days_left}} يوم)\n\nيرجى شحن/تجديد الباقة قبل نفادها لضمان استمرار الخدمة.'
FROM whatsapp_settings ws
WHERE NOT EXISTS (
  SELECT 1
  FROM whatsapp_templates wt
  WHERE wt.tenant_id = ws.tenant_id
    AND wt.template_key = 'usage_threshold'
);
