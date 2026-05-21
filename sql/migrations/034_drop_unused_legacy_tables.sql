-- Drop legacy / unused application tables (no API references).
-- Pre-flight: sql/scripts/verify-unused-tables-empty.sql — all row_count must be 0.
-- Keeps: radius_sync_logs, sessions, notifications, subscribers.customer_id (nullable column).

SET NAMES utf8mb4;

-- Detach optional branch FK (branch_id columns remain on speed_* tables).
ALTER TABLE speed_profiles DROP FOREIGN KEY fk_speed_profiles_branch;

ALTER TABLE speed_profile_schedules DROP FOREIGN KEY fk_sps_branch;

DROP TABLE IF EXISTS customer_contacts;
DROP TABLE IF EXISTS customer_addresses;
DROP TABLE IF EXISTS package_speed_profiles;
DROP TABLE IF EXISTS package_quota_profiles;
DROP TABLE IF EXISTS package_fup_rules;
DROP TABLE IF EXISTS radius_group_attributes;
DROP TABLE IF EXISTS subscriber_radius_attributes;
DROP TABLE IF EXISTS radius_groups;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS session_interim_updates;

DROP TABLE IF EXISTS radius_sync_jobs;
DROP TABLE IF EXISTS subscriber_status_history;
DROP TABLE IF EXISTS usage_counters;
DROP TABLE IF EXISTS usage_daily;
DROP TABLE IF EXISTS usage_monthly;
DROP TABLE IF EXISTS wallet_transactions;
DROP TABLE IF EXISTS staff_wallet_transactions;
DROP TABLE IF EXISTS payment_methods;
DROP TABLE IF EXISTS notification_templates;
DROP TABLE IF EXISTS background_jobs;
DROP TABLE IF EXISTS system_health_events;
DROP TABLE IF EXISTS api_tokens;
DROP TABLE IF EXISTS radippool;
DROP TABLE IF EXISTS radgroupcheck;
DROP TABLE IF EXISTS backups;
DROP TABLE IF EXISTS whatsapp_messages;
DROP TABLE IF EXISTS prepaid_card_templates;
DROP TABLE IF EXISTS admin_notifications;
DROP TABLE IF EXISTS subscriber_portal_sessions;
DROP TABLE IF EXISTS router_sync_jobs;
DROP TABLE IF EXISTS infrastructure_alert_history;

DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS branches;
