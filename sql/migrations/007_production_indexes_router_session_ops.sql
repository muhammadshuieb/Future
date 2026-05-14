-- Production indexes, session engine columns, MikroTik router ops audit tables.
-- Re-runnable: duplicate index/column errors are treated as benign by the migration runner.

CREATE TABLE IF NOT EXISTS router_commands_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id CHAR(36) NULL,
  router_id CHAR(36) NULL COMMENT 'nas_devices.id when known',
  nas_ip VARCHAR(64) NULL,
  command_type VARCHAR(64) NOT NULL,
  payload JSON NULL,
  result JSON NULL,
  error_message TEXT NULL,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_router_cmd_created (created_at),
  KEY idx_router_cmd_router (router_id),
  KEY idx_router_cmd_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS router_sync_jobs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  job_kind VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  payload JSON NULL,
  error_message TEXT NULL,
  scheduled_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  KEY idx_router_sync_jobs_tenant_status (tenant_id, status, scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS router_sync_status (
  nas_device_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  last_sync_at DATETIME(3) NULL,
  last_ok TINYINT(1) NOT NULL DEFAULT 0,
  last_message VARCHAR(512) NULL,
  last_session_count INT NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (nas_device_id),
  KEY idx_router_sync_status_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS router_sync_errors (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id CHAR(36) NULL,
  nas_device_id CHAR(36) NULL,
  nas_ip VARCHAR(64) NULL,
  error_message VARCHAR(1024) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_router_sync_err_created (created_at),
  KEY idx_router_sync_err_nas (nas_device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE sessions ADD COLUMN session_state VARCHAR(32) NOT NULL DEFAULT 'OFFLINE';
ALTER TABLE sessions ADD COLUMN radacct_radacctid BIGINT NULL;
ALTER TABLE sessions ADD COLUMN terminate_cause VARCHAR(64) NULL;
ALTER TABLE sessions ADD COLUMN last_reconcile_at DATETIME(3) NULL;
ALTER TABLE sessions ADD KEY idx_sessions_subscriber_state (subscriber_id, session_state);
ALTER TABLE sessions ADD KEY idx_sessions_username_state (username, session_state);

ALTER TABLE subscribers ADD KEY idx_subscribers_username (username);
ALTER TABLE subscribers ADD KEY idx_subscribers_status (status);
ALTER TABLE subscribers ADD KEY idx_subscribers_expiration (expiration_date);

ALTER TABLE radacct ADD KEY idx_radacct_acctsessionid (acctsessionid);
ALTER TABLE radacct ADD KEY idx_radacct_stoptime (acctstoptime);

ALTER TABLE nas ADD KEY idx_nas_nasname_lookup (nasname);

-- MikroTik session cache: store `nas_devices.id` (CHAR(36)), not legacy FreeRADIUS nas integer id.
DROP TABLE IF EXISTS mikrotik_session_cache;
CREATE TABLE mikrotik_session_cache (
  nas_id VARCHAR(36) NOT NULL,
  username VARCHAR(128) NOT NULL,
  uptime VARCHAR(64) DEFAULT NULL,
  last_seen DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (nas_id, username),
  KEY idx_mikrotik_session_cache_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
