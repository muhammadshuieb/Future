-- Encoding health: mojibake scan results, repair backups, scan runs (idempotent).

CREATE TABLE IF NOT EXISTS encoding_scan_runs (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  rows_scanned BIGINT NOT NULL DEFAULT 0,
  issues_found INT NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'running',
  params_json JSON NULL,
  error_message VARCHAR(512) NULL,
  PRIMARY KEY (id),
  KEY idx_enc_scan_tenant_started (tenant_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS encoding_issues (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NULL,
  scan_run_id CHAR(36) NOT NULL,
  table_name VARCHAR(128) NOT NULL,
  column_name VARCHAR(128) NOT NULL,
  row_id VARCHAR(512) NOT NULL,
  primary_key_json JSON NOT NULL,
  original_preview VARCHAR(600) NOT NULL,
  proposed_preview VARCHAR(600) NULL,
  issue_type VARCHAR(64) NOT NULL,
  confidence_score DECIMAL(7,5) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  repair_strategy VARCHAR(64) NULL,
  detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  repaired TINYINT(1) NOT NULL DEFAULT 0,
  repaired_at DATETIME(3) NULL,
  repaired_by CHAR(36) NULL,
  notes VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_enc_issues_tenant_status (tenant_id, status, detected_at),
  KEY idx_enc_issues_scan (scan_run_id),
  KEY idx_enc_issues_table (table_name, column_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS encoding_repair_backups (
  id CHAR(36) NOT NULL,
  issue_id CHAR(36) NOT NULL,
  original_value MEDIUMTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_enc_backup_issue (issue_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
