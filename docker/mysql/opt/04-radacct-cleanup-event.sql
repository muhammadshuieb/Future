-- radacct closed-session cleanup is handled by the API worker job `prune-data-retention`
-- (system_settings.radacct_closed_retention_days, default 180). This event is disabled
-- to avoid conflicting with the older 30-day fixed retention.
SET NAMES utf8mb4;

DROP EVENT IF EXISTS `cleanup_radacct`;
