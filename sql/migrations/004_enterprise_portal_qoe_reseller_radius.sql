-- Enterprise: subscriber portal accounts, QoE, reseller/franchise, live RADIUS monitoring.
-- Idempotent on MySQL 8+ (CREATE IF NOT EXISTS; benign duplicate column errors ignored by migrator).

-- ---------------------------------------------------------------------------
-- Tenant portal configuration (payment methods exposed to subscriber portal)
-- ---------------------------------------------------------------------------
ALTER TABLE system_settings
  ADD COLUMN portal_payment_methods_json JSON NULL COMMENT 'e.g. [{"id":"cash","label_ar":"كاش","enabled":1}]' AFTER subscription_license_note;

-- ---------------------------------------------------------------------------
-- Subscriber portal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriber_portal_accounts (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  otp_enabled TINYINT(1) NOT NULL DEFAULT 0,
  otp_code_hash VARCHAR(255) NULL,
  otp_expires_at DATETIME(3) NULL,
  allow_change_radius_password TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_portal_acct_sub (tenant_id, subscriber_id),
  CONSTRAINT fk_portal_acct_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_portal_acct_sub FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_payment_requests (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NULL,
  amount DECIMAL(14,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  method VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  external_ref VARCHAR(190) NULL,
  meta JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_payreq_tenant_sub (tenant_id, subscriber_id, created_at),
  CONSTRAINT fk_payreq_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_payreq_sub FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_speed_tests (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NOT NULL,
  latency_ms INT NULL,
  download_bps BIGINT NULL,
  upload_bps BIGINT NULL,
  client_meta JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_speed_tenant_sub (tenant_id, subscriber_id, created_at),
  CONSTRAINT fk_speed_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_speed_sub FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_devices (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NOT NULL,
  calling_station_id VARCHAR(128) NOT NULL,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  session_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dev_sub_mac (tenant_id, subscriber_id, calling_station_id),
  KEY idx_dev_sub_last (tenant_id, subscriber_id, last_seen_at),
  CONSTRAINT fk_dev_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_dev_sub FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_portal_sessions (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(512) NULL,
  revoked TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_pportal_sess_sub (tenant_id, subscriber_id, started_at),
  CONSTRAINT fk_pport_sess_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_pport_sess_sub FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_portal_audit_logs (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NOT NULL,
  action VARCHAR(120) NOT NULL,
  payload JSON NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pport_audit_sub (tenant_id, subscriber_id, created_at),
  CONSTRAINT fk_pport_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_pport_audit_sub FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- QoE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriber_qoe_metrics (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NOT NULL,
  score INT NOT NULL,
  status VARCHAR(16) NOT NULL,
  reasons_json JSON NULL,
  recommendations_json JSON NULL,
  computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_qoe_sub_computed (tenant_id, subscriber_id, computed_at),
  CONSTRAINT fk_qoe_met_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_qoe_met_sub FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_qoe_samples (
  id BIGINT NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NOT NULL,
  sampled_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  latency_ms DECIMAL(12,3) NULL,
  jitter_ms DECIMAL(12,3) NULL,
  packet_loss_pct DECIMAL(8,4) NULL,
  reconnect_count INT NOT NULL DEFAULT 0,
  failed_auth_count INT NOT NULL DEFAULT 0,
  avg_session_sec DECIMAL(14,3) NULL,
  bandwidth_saturation_pct DECIMAL(8,4) NULL,
  disconnect_count INT NOT NULL DEFAULT 0,
  meta JSON NULL,
  PRIMARY KEY (id),
  KEY idx_qoe_samp_sub_time (tenant_id, subscriber_id, sampled_at),
  CONSTRAINT fk_qoe_samp_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_qoe_samp_sub FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_qoe_alerts (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NULL,
  nas_device_id CHAR(36) NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'warning',
  title VARCHAR(200) NOT NULL,
  body TEXT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'open',
  acknowledged_at DATETIME(3) NULL,
  acknowledged_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_qoe_alert_tenant (tenant_id, status, created_at),
  CONSTRAINT fk_qoe_alert_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tower_qoe_scores (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  region_id CHAR(36) NOT NULL,
  score INT NOT NULL,
  status VARCHAR(16) NOT NULL,
  worst_subscriber_count INT NOT NULL DEFAULT 0,
  computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  meta JSON NULL,
  PRIMARY KEY (id),
  KEY idx_tower_qoe_region (tenant_id, region_id, computed_at),
  CONSTRAINT fk_tower_qoe_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_tower_qoe_region FOREIGN KEY (region_id) REFERENCES subscriber_regions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nas_qoe_scores (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  nas_device_id CHAR(36) NOT NULL,
  score INT NOT NULL,
  status VARCHAR(16) NOT NULL,
  active_sessions INT NOT NULL DEFAULT 0,
  poor_subscriber_count INT NOT NULL DEFAULT 0,
  computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  meta JSON NULL,
  PRIMARY KEY (id),
  KEY idx_nas_qoe_dev (tenant_id, nas_device_id, computed_at),
  CONSTRAINT fk_nas_qoe_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_nas_qoe_nas FOREIGN KEY (nas_device_id) REFERENCES nas_devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qoe_rules (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  config_json JSON NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_qoe_rules_tenant (tenant_id, enabled),
  CONSTRAINT fk_qoe_rules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qoe_incidents (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  rule_id CHAR(36) NULL,
  subscriber_id CHAR(36) NULL,
  nas_device_id CHAR(36) NULL,
  summary VARCHAR(255) NOT NULL,
  detail JSON NULL,
  opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_qoe_inc_tenant (tenant_id, opened_at),
  CONSTRAINT fk_qoe_inc_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Reseller / franchise
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resellers (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  parent_reseller_id CHAR(36) NULL,
  kind VARCHAR(32) NOT NULL DEFAULT 'reseller',
  branch_id CHAR(36) NULL,
  name VARCHAR(200) NOT NULL,
  code VARCHAR(64) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  prepaid_mode_enabled TINYINT(1) NOT NULL DEFAULT 0,
  prepaid_min_balance DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_resellers_tenant (tenant_id, status),
  KEY idx_resellers_parent (parent_reseller_id),
  CONSTRAINT fk_resellers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_resellers_parent FOREIGN KEY (parent_reseller_id) REFERENCES resellers(id) ON DELETE SET NULL,
  CONSTRAINT fk_resellers_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reseller_users (
  id CHAR(36) NOT NULL,
  reseller_id CHAR(36) NOT NULL,
  email VARCHAR(190) NOT NULL,
  name VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  permissions_json JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reseller_user_email (reseller_id, email),
  CONSTRAINT fk_reseller_users_res FOREIGN KEY (reseller_id) REFERENCES resellers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reseller_wallets (
  reseller_id CHAR(36) NOT NULL,
  balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (reseller_id),
  CONSTRAINT fk_res_wallet_res FOREIGN KEY (reseller_id) REFERENCES resellers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reseller_wallet_transactions (
  id CHAR(36) NOT NULL,
  reseller_id CHAR(36) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  kind VARCHAR(32) NOT NULL,
  reference VARCHAR(190) NULL,
  meta JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_res_wtx_res (reseller_id, created_at),
  CONSTRAINT fk_res_wtx_res FOREIGN KEY (reseller_id) REFERENCES resellers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reseller_commission_rules (
  id CHAR(36) NOT NULL,
  reseller_id CHAR(36) NOT NULL,
  package_id CHAR(36) NULL,
  rule_type VARCHAR(24) NOT NULL,
  value DECIMAL(14,4) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_res_comm_rules (reseller_id, package_id),
  CONSTRAINT fk_res_comm_rules_res FOREIGN KEY (reseller_id) REFERENCES resellers(id) ON DELETE CASCADE,
  CONSTRAINT fk_res_comm_rules_pkg FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reseller_commissions (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  reseller_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NULL,
  invoice_id CHAR(36) NULL,
  amount DECIMAL(14,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(24) NOT NULL DEFAULT 'accrued',
  meta JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_res_comm_res (reseller_id, created_at),
  CONSTRAINT fk_res_comm_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_res_comm_res FOREIGN KEY (reseller_id) REFERENCES resellers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reseller_settlements (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  reseller_id CHAR(36) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  approved_by CHAR(36) NULL,
  approved_at DATETIME(3) NULL,
  note TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_res_set_res (reseller_id, status, created_at),
  CONSTRAINT fk_res_set_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_res_set_res FOREIGN KEY (reseller_id) REFERENCES resellers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reseller_branding (
  reseller_id CHAR(36) NOT NULL,
  display_name VARCHAR(200) NULL,
  logo_url VARCHAR(512) NULL,
  primary_color VARCHAR(32) NULL,
  accent_color VARCHAR(32) NULL,
  support_phone VARCHAR(40) NULL,
  support_whatsapp VARCHAR(40) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (reseller_id),
  CONSTRAINT fk_res_brand_res FOREIGN KEY (reseller_id) REFERENCES resellers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reseller_package_access (
  reseller_id CHAR(36) NOT NULL,
  package_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (reseller_id, package_id),
  CONSTRAINT fk_res_pkg_res FOREIGN KEY (reseller_id) REFERENCES resellers(id) ON DELETE CASCADE,
  CONSTRAINT fk_res_pkg_pkg FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reseller_subscriber_assignments (
  reseller_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (reseller_id, subscriber_id),
  CONSTRAINT fk_res_sub_res FOREIGN KEY (reseller_id) REFERENCES resellers(id) ON DELETE CASCADE,
  CONSTRAINT fk_res_sub_sub FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reseller_audit_logs (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  reseller_id CHAR(36) NOT NULL,
  actor VARCHAR(120) NOT NULL,
  action VARCHAR(120) NOT NULL,
  payload JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_res_audit (reseller_id, created_at),
  CONSTRAINT fk_res_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_res_audit_res FOREIGN KEY (reseller_id) REFERENCES resellers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Live RADIUS monitoring
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radius_metrics_snapshots (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  bucket_start DATETIME(3) NOT NULL,
  auth_accept INT NOT NULL DEFAULT 0,
  auth_reject INT NOT NULL DEFAULT 0,
  acct_start INT NOT NULL DEFAULT 0,
  acct_stop INT NOT NULL DEFAULT 0,
  acct_interim INT NOT NULL DEFAULT 0,
  active_sessions INT NOT NULL DEFAULT 0,
  coa_success INT NOT NULL DEFAULT 0,
  coa_failure INT NOT NULL DEFAULT 0,
  avg_acct_delay_ms DECIMAL(14,3) NULL,
  nas_load_json JSON NULL,
  top_reject_users_json JSON NULL,
  top_reject_nas_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_rad_snap_bucket (tenant_id, bucket_start),
  CONSTRAINT fk_rad_snap_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radius_auth_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) NOT NULL,
  event_time DATETIME(3) NOT NULL,
  nas_ip VARCHAR(64) NULL,
  username VARCHAR(128) NOT NULL,
  reply VARCHAR(64) NOT NULL,
  reject_reason VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_rad_auth_ev (tenant_id, event_time),
  CONSTRAINT fk_rad_auth_ev_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radius_acct_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) NOT NULL,
  event_time DATETIME(3) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  nas_ip VARCHAR(64) NULL,
  username VARCHAR(128) NOT NULL,
  acctsessionid VARCHAR(64) NULL,
  delay_ms INT NULL,
  PRIMARY KEY (id),
  KEY idx_rad_acct_ev (tenant_id, event_time),
  CONSTRAINT fk_rad_acct_ev_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radius_coa_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) NOT NULL,
  event_time DATETIME(3) NOT NULL,
  nas_ip VARCHAR(64) NOT NULL,
  username VARCHAR(128) NOT NULL,
  ok TINYINT(1) NOT NULL,
  message VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_rad_coa_ev (tenant_id, event_time),
  CONSTRAINT fk_rad_coa_ev_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radius_monitor_alerts (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'warning',
  title VARCHAR(200) NOT NULL,
  body TEXT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'open',
  acknowledged_at DATETIME(3) NULL,
  acknowledged_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_rad_mon_alert (tenant_id, status, created_at),
  CONSTRAINT fk_rad_mon_alert_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radius_monitor_rules (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  config_json JSON NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_rad_mon_rules (tenant_id, enabled),
  CONSTRAINT fk_rad_mon_rules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default manager enterprise flags (merge into existing JSON)
UPDATE staff_role_permissions
SET permissions_json = JSON_MERGE_PATCH(
  COALESCE(permissions_json, JSON_OBJECT()),
  JSON_OBJECT(
    'view_resellers', true,
    'create_reseller', true,
    'edit_reseller', true,
    'suspend_reseller', true,
    'manage_reseller_wallet', true,
    'adjust_reseller_wallet', true,
    'view_reseller_commissions', true,
    'approve_reseller_settlements', true,
    'manage_reseller_branding', true,
    'view_qoe', true,
    'manage_qoe_rules', true,
    'view_radius_monitor', true,
    'manage_radius_monitor_rules', true
  )
)
WHERE role = 'manager';

UPDATE staff_role_permissions
SET permissions_json = JSON_MERGE_PATCH(
  COALESCE(permissions_json, JSON_OBJECT()),
  JSON_OBJECT(
    'view_resellers', false,
    'view_qoe', true,
    'view_radius_monitor', true
  )
)
WHERE role = 'viewer';
