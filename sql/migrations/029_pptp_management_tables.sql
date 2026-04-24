-- PPTP management tables (secrets/accounts + active connections snapshot)

CREATE TABLE IF NOT EXISTS pptp_secrets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  username VARCHAR(128) NOT NULL,
  password_encrypted VARBINARY(512) NOT NULL,
  static_ip VARCHAR(64) DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  note VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pptp_secret_tenant_username (tenant_id, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pptp_active_connections (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  username VARCHAR(128) DEFAULT NULL,
  client_ip VARCHAR(64) DEFAULT NULL,
  server_ip VARCHAR(64) DEFAULT NULL,
  vpn_ip VARCHAR(64) DEFAULT NULL,
  interface_name VARCHAR(64) DEFAULT NULL,
  connected_since DATETIME DEFAULT NULL,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_pptp_active_tenant (tenant_id, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
