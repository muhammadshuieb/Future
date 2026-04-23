-- RADIUS operation hints, subscription license note, PPTP tunnel IP for NAS, accountant contact for public portal
-- Duplicate column errors are treated as benign by the migrator.

ALTER TABLE system_settings
  ADD COLUMN user_idle_timeout_minutes INT NOT NULL DEFAULT 4;
ALTER TABLE system_settings
  ADD COLUMN mikrotik_interim_update_minutes INT NOT NULL DEFAULT 1;
ALTER TABLE system_settings
  ADD COLUMN disconnect_on_activation TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE system_settings
  ADD COLUMN disconnect_on_update TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE system_settings
  ADD COLUMN subscription_license_note VARCHAR(512) DEFAULT NULL;
ALTER TABLE system_settings
  ADD COLUMN accountant_contact_phone VARCHAR(32) DEFAULT NULL;

ALTER TABLE nas_servers
  ADD COLUMN pptp_tunnel_ip VARCHAR(64) DEFAULT NULL COMMENT 'Static address for PPTP/tunnel to MikroTik (optional)';
