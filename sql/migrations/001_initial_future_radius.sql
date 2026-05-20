-- Future Radius — single initial schema (MySQL 8+). Idempotent: safe to re-run.
-- Includes FreeRADIUS standard tables + application SaaS layer.

-- ---------------------------------------------------------------------------
-- FreeRADIUS (rlm_sql) — standard layout
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nasname VARCHAR(128) NOT NULL,
  shortname VARCHAR(32) NULL,
  type VARCHAR(30) DEFAULT 'other',
  ports INT NULL,
  secret VARCHAR(60) NOT NULL DEFAULT 'secret',
  server VARCHAR(64) NULL,
  community VARCHAR(50) NULL,
  description VARCHAR(200) NULL,
  UNIQUE KEY uq_nas_nasname (nasname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radcheck (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(128) NOT NULL DEFAULT '',
  attribute VARCHAR(64) NOT NULL DEFAULT '',
  op CHAR(2) NOT NULL DEFAULT '==',
  value VARCHAR(253) NOT NULL DEFAULT '',
  KEY idx_radcheck_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radreply (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(128) NOT NULL DEFAULT '',
  attribute VARCHAR(64) NOT NULL DEFAULT '',
  op CHAR(2) NOT NULL DEFAULT '=',
  value VARCHAR(253) NOT NULL DEFAULT '',
  KEY idx_radreply_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radgroupcheck (
  id INT AUTO_INCREMENT PRIMARY KEY,
  groupname VARCHAR(128) NOT NULL DEFAULT '',
  attribute VARCHAR(64) NOT NULL DEFAULT '',
  op CHAR(2) NOT NULL DEFAULT '==',
  value VARCHAR(253) NOT NULL DEFAULT '',
  KEY idx_radgroupcheck_groupname (groupname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radgroupreply (
  id INT AUTO_INCREMENT PRIMARY KEY,
  groupname VARCHAR(128) NOT NULL DEFAULT '',
  attribute VARCHAR(64) NOT NULL DEFAULT '',
  op CHAR(2) NOT NULL DEFAULT '=',
  value VARCHAR(253) NOT NULL DEFAULT '',
  KEY idx_radgroupreply_groupname (groupname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radusergroup (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(128) NOT NULL DEFAULT '',
  groupname VARCHAR(128) NOT NULL DEFAULT '',
  priority INT NOT NULL DEFAULT 1,
  KEY idx_radusergroup_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radacct (
  radacctid BIGINT AUTO_INCREMENT PRIMARY KEY,
  acctsessionid VARCHAR(64) NOT NULL DEFAULT '',
  acctuniqueid VARCHAR(32) NOT NULL DEFAULT '',
  username VARCHAR(128) NOT NULL DEFAULT '',
  groupname VARCHAR(128) NOT NULL DEFAULT '',
  realm VARCHAR(64) DEFAULT '',
  nasipaddress VARCHAR(45) NOT NULL DEFAULT '',
  nasportid VARCHAR(32) NULL,
  nasporttype VARCHAR(32) NULL,
  acctstarttime DATETIME NULL,
  acctupdatetime DATETIME NULL,
  acctstoptime DATETIME NULL,
  acctinterval INT NULL,
  acctsessiontime INT UNSIGNED NULL,
  acctauthentic VARCHAR(32) NULL,
  connectinfo_start VARCHAR(50) NULL,
  connectinfo_stop VARCHAR(50) NULL,
  acctinputoctets BIGINT NULL,
  acctoutputoctets BIGINT NULL,
  acctinputgigawords INT UNSIGNED NULL,
  acctoutputgigawords INT UNSIGNED NULL,
  calledstationid VARCHAR(50) NOT NULL DEFAULT '',
  callingstationid VARCHAR(50) NOT NULL DEFAULT '',
  acctterminatecause VARCHAR(32) NOT NULL DEFAULT '',
  servicetype VARCHAR(32) NULL,
  framedprotocol VARCHAR(32) NULL,
  framedipaddress VARCHAR(45) NOT NULL DEFAULT '',
  framedipv6address VARCHAR(45) NOT NULL DEFAULT '',
  framedipv6prefix VARCHAR(45) NOT NULL DEFAULT '',
  framedinterfaceid VARCHAR(44) NOT NULL DEFAULT '',
  delegatedipv6prefix VARCHAR(45) NOT NULL DEFAULT '',
  KEY idx_radacct_username (username),
  KEY idx_radacct_active (acctstoptime, acctupdatetime)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radpostauth (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(128) NOT NULL DEFAULT '',
  pass VARCHAR(64) NOT NULL DEFAULT '',
  reply VARCHAR(32) NOT NULL DEFAULT '',
  authdate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  class VARCHAR(64) NULL,
  KEY idx_radpostauth_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radippool (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pool_name VARCHAR(30) NOT NULL,
  framedipaddress VARCHAR(15) NOT NULL DEFAULT '',
  nasipaddress VARCHAR(15) NOT NULL DEFAULT '',
  calledstationid VARCHAR(30) NOT NULL,
  callingstationid VARCHAR(30) NOT NULL,
  expiry_time DATETIME NULL,
  username VARCHAR(64) NOT NULL DEFAULT '',
  pool_key VARCHAR(30) NOT NULL,
  UNIQUE KEY uq_radippool_ip (framedipaddress),
  KEY idx_radippool_pool (pool_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- SaaS core
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS branches (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  address TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_branches_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(140) NOT NULL UNIQUE,
  description VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_roles_tenant_name (tenant_id, name),
  CONSTRAINT fk_roles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id CHAR(36) NOT NULL,
  permission_id CHAR(36) NOT NULL,
  PRIMARY KEY (role_id, permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  email VARCHAR(190) NOT NULL,
  name VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  wallet_balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  allowed_negative_balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  permissions_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_tenant_email (tenant_id, email),
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id CHAR(36) NOT NULL,
  role_id CHAR(36) NOT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NULL,
  staff_id CHAR(36) NULL,
  action VARCHAR(140) NOT NULL,
  entity_type VARCHAR(80) NULL,
  entity_id VARCHAR(80) NULL,
  payload JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_tenant_created (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  tenant_id CHAR(36) NOT NULL,
  critical_alert_enabled TINYINT(1) NOT NULL DEFAULT 0,
  critical_alert_phone VARCHAR(32) DEFAULT NULL,
  critical_alert_use_session_owner TINYINT(1) NOT NULL DEFAULT 1,
  backup_alert_enabled TINYINT(1) NOT NULL DEFAULT 0,
  backup_alert_phone VARCHAR(32) DEFAULT NULL,
  backup_alert_use_session_owner TINYINT(1) NOT NULL DEFAULT 1,
  server_log_retention_days INT NOT NULL DEFAULT 5,
  radpostauth_retention_enabled TINYINT(1) NOT NULL DEFAULT 1,
  radpostauth_retention_months INT NOT NULL DEFAULT 2,
  user_idle_timeout_minutes INT NOT NULL DEFAULT 4,
  mikrotik_interim_update_minutes INT NOT NULL DEFAULT 1,
  disconnect_on_activation TINYINT(1) NOT NULL DEFAULT 1,
  disconnect_on_update TINYINT(1) NOT NULL DEFAULT 1,
  billing_currency CHAR(3) NOT NULL DEFAULT 'USD',
  subscription_license_note VARCHAR(512) DEFAULT NULL,
  accountant_contact_phone VARCHAR(32) DEFAULT NULL,
  wireguard_vpn_enabled TINYINT(1) NOT NULL DEFAULT 1,
  wireguard_server_host VARCHAR(128) DEFAULT NULL,
  wireguard_server_port INT NOT NULL DEFAULT 51820,
  wireguard_interface_cidr VARCHAR(64) DEFAULT NULL,
  wireguard_client_dns VARCHAR(128) DEFAULT NULL,
  wireguard_persistent_keepalive INT NOT NULL DEFAULT 25,
  wireguard_server_public_key VARCHAR(64) DEFAULT NULL,
  wireguard_server_private_key_encrypted VARBINARY(512) DEFAULT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_system_settings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  branch_id CHAR(36) NULL,
  display_name VARCHAR(190) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_customers_tenant (tenant_id),
  CONSTRAINT fk_customers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_contacts (
  id CHAR(36) PRIMARY KEY,
  customer_id CHAR(36) NOT NULL,
  type VARCHAR(40) NOT NULL,
  value VARCHAR(190) NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_customer_contacts_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_addresses (
  id CHAR(36) PRIMARY KEY,
  customer_id CHAR(36) NOT NULL,
  label VARCHAR(80) NULL,
  address TEXT NOT NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  CONSTRAINT fk_customer_addresses_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS packages (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  mikrotik_rate_limit VARCHAR(120) NULL,
  framed_ip_address VARCHAR(64) NULL,
  mikrotik_address_list VARCHAR(120) NULL,
  default_framed_pool VARCHAR(120) NULL,
  simultaneous_use INT NOT NULL DEFAULT 1,
  quota_total_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  billing_period_days INT NOT NULL DEFAULT 30,
  price DECIMAL(14,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  account_type VARCHAR(40) NOT NULL DEFAULT 'subscriptions',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_packages_tenant (tenant_id),
  CONSTRAINT fk_packages_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS package_speed_profiles (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL,
  download_kbps INT NOT NULL DEFAULT 0,
  upload_kbps INT NOT NULL DEFAULT 0,
  burst_config JSON NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS package_quota_profiles (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL,
  quota_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reset_policy VARCHAR(40) NOT NULL DEFAULT 'monthly'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS package_fup_rules (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL,
  threshold_percent INT NOT NULL,
  action VARCHAR(40) NOT NULL,
  attributes JSON NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_regions (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  parent_id CHAR(36) DEFAULT NULL,
  name VARCHAR(128) NOT NULL,
  radius_group_name VARCHAR(128) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_regions_tenant_parent_sort (tenant_id, parent_id, sort_order),
  CONSTRAINT fk_regions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_regions_parent FOREIGN KEY (parent_id) REFERENCES subscriber_regions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nas_devices (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  ip VARCHAR(64) NOT NULL,
  type VARCHAR(80) NOT NULL DEFAULT 'mikrotik',
  secret VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  coa_port INT NOT NULL DEFAULT 3799,
  mikrotik_api_enabled TINYINT(1) NOT NULL DEFAULT 0,
  mikrotik_api_user VARCHAR(160) NULL,
  mikrotik_api_password VARCHAR(255) NULL,
  wireguard_tunnel_ip VARCHAR(64) NULL,
  online_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  last_ping_ok TINYINT(1) NULL,
  last_radius_ok TINYINT(1) NULL,
  last_check_at DATETIME NULL,
  session_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_nas_tenant_ip (tenant_id, ip),
  CONSTRAINT fk_nas_devices_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscribers (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NULL,
  package_id CHAR(36) NULL,
  nas_server_id CHAR(36) NULL,
  region_id CHAR(36) NULL,
  username VARCHAR(128) NOT NULL,
  first_name VARCHAR(80) NULL,
  last_name VARCHAR(80) NULL,
  nickname VARCHAR(80) NULL,
  phone VARCHAR(40) NULL,
  address VARCHAR(255) NULL,
  pool VARCHAR(120) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  expiration_date DATETIME NULL,
  used_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  whatsapp_opt_out TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subscribers_tenant_username (tenant_id, username),
  KEY idx_subscribers_package (package_id),
  CONSTRAINT fk_subscribers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_subscribers_region FOREIGN KEY (region_id) REFERENCES subscriber_regions(id) ON DELETE SET NULL,
  CONSTRAINT fk_subscribers_nas_device FOREIGN KEY (nas_server_id) REFERENCES nas_devices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_credentials (
  subscriber_id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  password VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sub_cred_sub FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_status_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  subscriber_id CHAR(36) NOT NULL,
  old_status VARCHAR(32) NULL,
  new_status VARCHAR(32) NOT NULL,
  reason VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_packages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  subscriber_id CHAR(36) NOT NULL,
  package_id CHAR(36) NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_static_ips (
  id CHAR(36) PRIMARY KEY,
  subscriber_id CHAR(36) NOT NULL,
  ip_address VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radius_groups (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  priority INT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radius_group_attributes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  group_id CHAR(36) NOT NULL,
  attribute VARCHAR(120) NOT NULL,
  op VARCHAR(8) NOT NULL DEFAULT ':=',
  value VARCHAR(255) NOT NULL,
  target VARCHAR(20) NOT NULL DEFAULT 'reply'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_radius_attributes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  subscriber_id CHAR(36) NOT NULL,
  attribute VARCHAR(120) NOT NULL,
  op VARCHAR(8) NOT NULL DEFAULT ':=',
  value VARCHAR(255) NOT NULL,
  target VARCHAR(20) NOT NULL DEFAULT 'reply'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radius_sync_jobs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id VARCHAR(80) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radius_sync_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id VARCHAR(80) NOT NULL,
  status VARCHAR(32) NOT NULL,
  message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id CHAR(36) NULL,
  subscriber_id CHAR(36) NULL,
  username VARCHAR(128) NOT NULL,
  acctsessionid VARCHAR(128) NOT NULL,
  nas_ip VARCHAR(64) NULL,
  started_at DATETIME NULL,
  stopped_at DATETIME NULL,
  input_octets BIGINT UNSIGNED NOT NULL DEFAULT 0,
  output_octets BIGINT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_sessions_acct (acctsessionid, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_interim_updates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT NOT NULL,
  input_octets BIGINT UNSIGNED NOT NULL DEFAULT 0,
  output_octets BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usage_counters (
  subscriber_id CHAR(36) PRIMARY KEY,
  total_input_octets BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_output_octets BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usage_daily (
  subscriber_id CHAR(36) NOT NULL,
  usage_date DATE NOT NULL,
  input_octets BIGINT UNSIGNED NOT NULL DEFAULT 0,
  output_octets BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (subscriber_id, usage_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usage_monthly (
  subscriber_id CHAR(36) NOT NULL,
  usage_month CHAR(7) NOT NULL,
  input_octets BIGINT UNSIGNED NOT NULL DEFAULT 0,
  output_octets BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (subscriber_id, usage_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_usage_live (
  tenant_id CHAR(36) NOT NULL,
  username VARCHAR(128) NOT NULL,
  total_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, username),
  KEY idx_user_usage_live_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_usage_daily (
  tenant_id CHAR(36) NOT NULL,
  username VARCHAR(128) NOT NULL,
  day DATE NOT NULL,
  total_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, username, day),
  KEY idx_user_usage_daily_tenant_day (tenant_id, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NULL,
  period VARCHAR(16) NOT NULL DEFAULT 'monthly',
  invoice_no VARCHAR(80) NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status VARCHAR(32) NOT NULL DEFAULT 'sent',
  meta JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_invoices_tenant_subscriber_status (tenant_id, subscriber_id, status),
  CONSTRAINT fk_invoices_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_items (
  id CHAR(36) PRIMARY KEY,
  invoice_id CHAR(36) NOT NULL,
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
  total DECIMAL(14,2) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NULL,
  subscriber_id CHAR(36) NULL,
  amount DECIMAL(14,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  method VARCHAR(64) NOT NULL DEFAULT 'manual',
  status VARCHAR(32) NOT NULL DEFAULT 'posted',
  paid_at DATETIME(3) NOT NULL,
  KEY idx_payments_tenant_paid (tenant_id, paid_at),
  KEY idx_payments_invoice (invoice_id),
  CONSTRAINT fk_payments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NULL,
  amount DECIMAL(14,2) NOT NULL,
  direction VARCHAR(16) NOT NULL,
  reason VARCHAR(160) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wallet_tx_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_wallet_transactions (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  staff_user_id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) DEFAULT NULL,
  amount DECIMAL(14,2) NOT NULL,
  tx_type VARCHAR(48) NOT NULL,
  note VARCHAR(255) DEFAULT NULL,
  related_subscriber_id CHAR(36) DEFAULT NULL,
  currency VARCHAR(8) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_staff_wallet_tx_staff (tenant_id, staff_user_id, created_at),
  KEY idx_staff_wallet_tx_actor (tenant_id, actor_user_id, created_at),
  CONSTRAINT fk_staff_wallet_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_staff_wallet_staff FOREIGN KEY (staff_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_methods (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_templates (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  channel VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  body TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NULL,
  channel VARCHAR(40) NOT NULL,
  subject VARCHAR(190) NULL,
  body TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  direction VARCHAR(16) NOT NULL DEFAULT 'outbound',
  provider_message_id VARCHAR(128) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_whatsapp_tenant_created (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS background_jobs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  queue VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  payload JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_bg_jobs_queue_status (queue, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_health_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id CHAR(36) NULL,
  severity VARCHAR(32) NOT NULL,
  source VARCHAR(80) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_health_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backups (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NULL,
  filename VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  bytes BIGINT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_tokens (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS server_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  level ENUM('error','warn','info','debug') NOT NULL DEFAULT 'info',
  source VARCHAR(64) NOT NULL DEFAULT 'api',
  category VARCHAR(96) DEFAULT NULL,
  message VARCHAR(8000) NOT NULL,
  stack MEDIUMTEXT DEFAULT NULL,
  meta JSON DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_server_logs_level_created (level, created_at),
  KEY idx_server_logs_source_created (source, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS server_log_alerts (
  id CHAR(36) NOT NULL,
  log_id BIGINT UNSIGNED NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  status ENUM('sent','failed','skipped') NOT NULL DEFAULT 'skipped',
  error_message VARCHAR(4000) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_server_log_alerts_log (log_id),
  KEY idx_server_log_alerts_tenant_created (tenant_id, created_at),
  CONSTRAINT fk_server_log_alerts_log FOREIGN KEY (log_id) REFERENCES server_logs (id) ON DELETE CASCADE,
  CONSTRAINT fk_server_log_alerts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_role_permissions (
  tenant_id CHAR(36) NOT NULL,
  role ENUM('admin','manager','accountant','viewer') NOT NULL,
  permissions_json JSON DEFAULT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, role),
  CONSTRAINT fk_staff_role_permissions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wireguard_peers (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  username VARCHAR(128) NOT NULL,
  public_key VARCHAR(64) NOT NULL,
  private_key_encrypted VARBINARY(512) NOT NULL,
  tunnel_ip VARCHAR(64) DEFAULT NULL,
  allowed_ips VARCHAR(255) DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  note VARCHAR(255) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_wireguard_peers_tenant (tenant_id),
  KEY idx_wireguard_peers_username (username),
  CONSTRAINT fk_wireguard_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
