-- Remove live RADIUS monitor module: tables and staff permission keys.

DROP TABLE IF EXISTS radius_monitor_rules;
DROP TABLE IF EXISTS radius_monitor_alerts;
DROP TABLE IF EXISTS radius_coa_events;
DROP TABLE IF EXISTS radius_acct_events;
DROP TABLE IF EXISTS radius_auth_events;
DROP TABLE IF EXISTS radius_metrics_snapshots;

UPDATE staff_role_permissions
SET permissions_json = JSON_REMOVE(
  COALESCE(permissions_json, JSON_OBJECT()),
  '$.view_radius_monitor',
  '$.manage_radius_monitor_rules'
);
