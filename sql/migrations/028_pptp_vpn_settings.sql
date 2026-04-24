-- PPTP VPN integration settings for linking remote NAS/routers to main server
-- Duplicate column errors are treated as benign by migrator.

ALTER TABLE system_settings
  ADD COLUMN pptp_vpn_enabled TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE system_settings
  ADD COLUMN pptp_server_host VARCHAR(128) DEFAULT NULL;
ALTER TABLE system_settings
  ADD COLUMN pptp_server_port INT NOT NULL DEFAULT 1723;
ALTER TABLE system_settings
  ADD COLUMN pptp_server_username VARCHAR(128) DEFAULT NULL;
ALTER TABLE system_settings
  ADD COLUMN pptp_server_password_encrypted VARBINARY(512) DEFAULT NULL;
ALTER TABLE system_settings
  ADD COLUMN pptp_local_network_cidr VARCHAR(64) DEFAULT NULL;
ALTER TABLE system_settings
  ADD COLUMN pptp_client_pool_cidr VARCHAR(64) DEFAULT NULL;
