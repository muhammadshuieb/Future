-- Pre-flight: run BEFORE migration 034_drop_unused_legacy_tables.sql on production.
-- Every listed table should report row_count = 0 (or table_missing).
-- If any table has data, investigate before applying the drop migration.

SET NAMES utf8mb4;

SELECT 'permissions' AS tbl,
  IF(
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'permissions') = 0,
    'table_missing',
    (SELECT CAST(COUNT(*) AS CHAR) FROM permissions)
  ) AS row_count
UNION ALL SELECT 'role_permissions', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'role_permissions') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM role_permissions))
UNION ALL SELECT 'customer_contacts', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_contacts') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM customer_contacts))
UNION ALL SELECT 'customer_addresses', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_addresses') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM customer_addresses))
UNION ALL SELECT 'customers', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM customers))
UNION ALL SELECT 'branches', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branches') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM branches))
UNION ALL SELECT 'package_speed_profiles', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'package_speed_profiles') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM package_speed_profiles))
UNION ALL SELECT 'package_quota_profiles', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'package_quota_profiles') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM package_quota_profiles))
UNION ALL SELECT 'package_fup_rules', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'package_fup_rules') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM package_fup_rules))
UNION ALL SELECT 'radius_groups', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'radius_groups') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM radius_groups))
UNION ALL SELECT 'radius_group_attributes', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'radius_group_attributes') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM radius_group_attributes))
UNION ALL SELECT 'subscriber_radius_attributes', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_radius_attributes') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM subscriber_radius_attributes))
UNION ALL SELECT 'radius_sync_jobs', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'radius_sync_jobs') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM radius_sync_jobs))
UNION ALL SELECT 'subscriber_status_history', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_status_history') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM subscriber_status_history))
UNION ALL SELECT 'session_interim_updates', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'session_interim_updates') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM session_interim_updates))
UNION ALL SELECT 'usage_counters', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usage_counters') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM usage_counters))
UNION ALL SELECT 'usage_daily', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usage_daily') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM usage_daily))
UNION ALL SELECT 'usage_monthly', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usage_monthly') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM usage_monthly))
UNION ALL SELECT 'wallet_transactions', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wallet_transactions') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM wallet_transactions))
UNION ALL SELECT 'staff_wallet_transactions', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_wallet_transactions') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM staff_wallet_transactions))
UNION ALL SELECT 'payment_methods', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_methods') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM payment_methods))
UNION ALL SELECT 'notification_templates', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_templates') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM notification_templates))
UNION ALL SELECT 'background_jobs', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'background_jobs') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM background_jobs))
UNION ALL SELECT 'system_health_events', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_health_events') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM system_health_events))
UNION ALL SELECT 'api_tokens', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'api_tokens') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM api_tokens))
UNION ALL SELECT 'radippool', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'radippool') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM radippool))
UNION ALL SELECT 'radgroupcheck', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'radgroupcheck') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM radgroupcheck))
UNION ALL SELECT 'backups', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backups') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM backups))
UNION ALL SELECT 'whatsapp_messages', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'whatsapp_messages') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM whatsapp_messages))
UNION ALL SELECT 'prepaid_card_templates', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prepaid_card_templates') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM prepaid_card_templates))
UNION ALL SELECT 'admin_notifications', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_notifications') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM admin_notifications))
UNION ALL SELECT 'subscriber_portal_sessions', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_portal_sessions') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM subscriber_portal_sessions))
UNION ALL SELECT 'router_sync_jobs', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'router_sync_jobs') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM router_sync_jobs))
UNION ALL SELECT 'infrastructure_alert_history', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'infrastructure_alert_history') = 0, 'table_missing', (SELECT CAST(COUNT(*) AS CHAR) FROM infrastructure_alert_history));

-- Orphan references after customer removal (informational):
SELECT COUNT(*) AS subscribers_with_customer_id
FROM subscribers
WHERE customer_id IS NOT NULL;
