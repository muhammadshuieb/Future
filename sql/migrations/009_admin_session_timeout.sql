-- Admin staff inactivity auto-logout (minutes). Default 30.
-- Re-runnable: duplicate column errors are benign in applyAllMigrations.

ALTER TABLE system_settings ADD COLUMN admin_session_timeout_minutes INT NOT NULL DEFAULT 30;
