CREATE TABLE IF NOT EXISTS whatsapp_settings (
  tenant_id CHAR(36) NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  waha_url VARCHAR(255) NULL,
  session_name VARCHAR(128) NULL,
  api_key VARCHAR(255) NULL,
  reminder_days INT NOT NULL DEFAULT 5,
  message_interval_seconds INT NOT NULL DEFAULT 30,
  auto_send_new TINYINT(1) NOT NULL DEFAULT 1,
  usage_alert_thresholds VARCHAR(64) NOT NULL DEFAULT '10,20,30,50',
  last_check_ok TINYINT(1) NULL,
  last_check_at DATETIME NULL,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  tenant_id CHAR(36) NOT NULL,
  template_key ENUM('new_account','expiry_soon','payment_due','usage_threshold') NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, template_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS whatsapp_message_logs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NULL,
  phone VARCHAR(32) NOT NULL,
  template_key ENUM('new_account','expiry_soon','payment_due','usage_threshold') NULL,
  message_body TEXT NOT NULL,
  status ENUM('sent','failed') NOT NULL,
  provider_message_id VARCHAR(255) NULL,
  error_message TEXT NULL,
  retry_of CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  INDEX idx_whatsapp_log_tenant_created (tenant_id, created_at),
  INDEX idx_whatsapp_log_tenant_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS whatsapp_usage_alerts_sent (
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NOT NULL,
  threshold_percent INT NOT NULL,
  month_key CHAR(7) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, subscriber_id, threshold_percent, month_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
