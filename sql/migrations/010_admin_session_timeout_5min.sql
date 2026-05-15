-- Default admin inactivity logout to 5 minutes (was 30).
-- Re-runnable: benign if column default already 5.

UPDATE system_settings SET admin_session_timeout_minutes = 5 WHERE admin_session_timeout_minutes = 30;
