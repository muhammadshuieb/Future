ALTER TABLE infrastructure_monitoring_settings
  ADD COLUMN whatsapp_status_reports_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER whatsapp_critical_only,
  ADD COLUMN whatsapp_status_interval_minutes INT NOT NULL DEFAULT 5 AFTER whatsapp_status_reports_enabled,
  ADD COLUMN whatsapp_last_status_report_at DATETIME(3) NULL AFTER whatsapp_status_interval_minutes;
