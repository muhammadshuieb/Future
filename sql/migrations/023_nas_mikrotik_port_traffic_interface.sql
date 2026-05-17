ALTER TABLE nas_devices
  ADD COLUMN mikrotik_api_port INT UNSIGNED NULL DEFAULT 8728 AFTER mikrotik_api_password,
  ADD COLUMN traffic_monitor_interface VARCHAR(64) NULL AFTER mikrotik_api_port;
