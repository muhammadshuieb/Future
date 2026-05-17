ALTER TABLE infrastructure_monitoring_settings
  ADD COLUMN telegram_status_reports_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER telegram_last_error,
  ADD COLUMN telegram_status_interval_minutes INT NOT NULL DEFAULT 5 AFTER telegram_status_reports_enabled,
  ADD COLUMN telegram_last_status_report_at DATETIME(3) NULL AFTER telegram_status_interval_minutes;
