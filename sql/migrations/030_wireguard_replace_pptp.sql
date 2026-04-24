-- Replace PPTP integration with WireGuard.

ALTER TABLE system_settings
  ADD COLUMN wireguard_vpn_enabled TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE system_settings
  ADD COLUMN wireguard_server_host VARCHAR(128) DEFAULT NULL;
ALTER TABLE system_settings
  ADD COLUMN wireguard_server_port INT NOT NULL DEFAULT 51820;
ALTER TABLE system_settings
  ADD COLUMN wireguard_interface_cidr VARCHAR(64) DEFAULT NULL;
ALTER TABLE system_settings
  ADD COLUMN wireguard_client_dns VARCHAR(128) DEFAULT NULL;
ALTER TABLE system_settings
  ADD COLUMN wireguard_persistent_keepalive INT NOT NULL DEFAULT 25;
ALTER TABLE system_settings
  ADD COLUMN wireguard_server_public_key VARCHAR(64) DEFAULT NULL;
ALTER TABLE system_settings
  ADD COLUMN wireguard_server_private_key_encrypted VARBINARY(512) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS wireguard_peers (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  username VARCHAR(128) NOT NULL,
  public_key VARCHAR(64) NOT NULL,
  private_key_encrypted VARBINARY(512) NOT NULL,
  tunnel_ip VARCHAR(64) NOT NULL,
  allowed_ips VARCHAR(255) DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  note VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wireguard_peer_tenant_username (tenant_id, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @has_pptp_tunnel_ip := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nas_servers' AND COLUMN_NAME = 'pptp_tunnel_ip'
);
SET @has_wireguard_tunnel_ip := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nas_servers' AND COLUMN_NAME = 'wireguard_tunnel_ip'
);
SET @sql := IF(
  @has_pptp_tunnel_ip > 0 AND @has_wireguard_tunnel_ip = 0,
  'ALTER TABLE nas_servers CHANGE COLUMN pptp_tunnel_ip wireguard_tunnel_ip VARCHAR(64) DEFAULT NULL COMMENT ''Static WireGuard tunnel address for NAS (optional)''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE nas_servers
  ADD COLUMN wireguard_tunnel_ip VARCHAR(64) DEFAULT NULL COMMENT 'Static WireGuard tunnel address for NAS (optional)';

DROP TABLE IF EXISTS pptp_active_connections;
DROP TABLE IF EXISTS pptp_secrets;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_settings' AND COLUMN_NAME = 'pptp_vpn_enabled') > 0, 'ALTER TABLE system_settings DROP COLUMN pptp_vpn_enabled', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_settings' AND COLUMN_NAME = 'pptp_server_host') > 0, 'ALTER TABLE system_settings DROP COLUMN pptp_server_host', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_settings' AND COLUMN_NAME = 'pptp_server_port') > 0, 'ALTER TABLE system_settings DROP COLUMN pptp_server_port', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_settings' AND COLUMN_NAME = 'pptp_server_username') > 0, 'ALTER TABLE system_settings DROP COLUMN pptp_server_username', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_settings' AND COLUMN_NAME = 'pptp_server_password_encrypted') > 0, 'ALTER TABLE system_settings DROP COLUMN pptp_server_password_encrypted', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_settings' AND COLUMN_NAME = 'pptp_local_network_cidr') > 0, 'ALTER TABLE system_settings DROP COLUMN pptp_local_network_cidr', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_settings' AND COLUMN_NAME = 'pptp_client_pool_cidr') > 0, 'ALTER TABLE system_settings DROP COLUMN pptp_client_pool_cidr', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nas_servers' AND COLUMN_NAME = 'pptp_tunnel_ip') > 0, 'ALTER TABLE nas_servers DROP COLUMN pptp_tunnel_ip', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
