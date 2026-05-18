-- Remove QoE module: tables and staff permission keys.

DROP TABLE IF EXISTS qoe_incidents;
DROP TABLE IF EXISTS qoe_rules;
DROP TABLE IF EXISTS nas_qoe_scores;
DROP TABLE IF EXISTS tower_qoe_scores;
DROP TABLE IF EXISTS subscriber_qoe_alerts;
DROP TABLE IF EXISTS subscriber_qoe_samples;
DROP TABLE IF EXISTS subscriber_qoe_metrics;

UPDATE staff_role_permissions
SET permissions_json = JSON_REMOVE(
  COALESCE(permissions_json, JSON_OBJECT()),
  '$.view_qoe',
  '$.manage_qoe_rules'
);
