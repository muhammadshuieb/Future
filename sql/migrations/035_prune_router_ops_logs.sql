-- Prune append-only router ops tables (grows with sync failures and API commands).
-- Requires event_scheduler = ON.

SET NAMES utf8mb4;

DROP EVENT IF EXISTS prune_router_sync_errors;

CREATE EVENT prune_router_sync_errors
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP + INTERVAL 5 MINUTE
COMMENT 'Delete router_sync_errors older than 30 days'
DO
  DELETE FROM router_sync_errors
  WHERE created_at < NOW() - INTERVAL 30 DAY;

DROP EVENT IF EXISTS prune_router_commands_log;

CREATE EVENT prune_router_commands_log
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP + INTERVAL 10 MINUTE
COMMENT 'Delete router_commands_log older than 90 days'
DO
  DELETE FROM router_commands_log
  WHERE created_at < NOW() - INTERVAL 90 DAY;
