-- Server logs: default retention 5 days (hourly prune-server-logs job). Editable in system settings (3–90).

ALTER TABLE system_settings
  MODIFY COLUMN server_log_retention_days INT NOT NULL DEFAULT 5;

UPDATE system_settings
SET server_log_retention_days = 5
WHERE server_log_retention_days = 14;
