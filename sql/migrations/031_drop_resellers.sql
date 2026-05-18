-- Remove reseller / franchise module.

DELETE FROM speed_profile_schedules WHERE target_type = 'reseller';

DROP TABLE IF EXISTS reseller_audit_logs;
DROP TABLE IF EXISTS reseller_subscriber_assignments;
DROP TABLE IF EXISTS reseller_package_access;
DROP TABLE IF EXISTS reseller_branding;
DROP TABLE IF EXISTS reseller_settlements;
DROP TABLE IF EXISTS reseller_commissions;
DROP TABLE IF EXISTS reseller_commission_rules;
DROP TABLE IF EXISTS reseller_wallet_transactions;
DROP TABLE IF EXISTS reseller_wallets;
DROP TABLE IF EXISTS reseller_users;
DROP TABLE IF EXISTS resellers;

UPDATE staff_role_permissions
SET permissions_json = JSON_REMOVE(
  COALESCE(permissions_json, JSON_OBJECT()),
  '$.view_resellers',
  '$.create_reseller',
  '$.edit_reseller',
  '$.suspend_reseller',
  '$.manage_reseller_wallet',
  '$.adjust_reseller_wallet',
  '$.view_reseller_commissions',
  '$.approve_reseller_settlements',
  '$.manage_reseller_branding'
);
