CREATE TABLE IF NOT EXISTS user_quota_state (
  tenant_id CHAR(36) NOT NULL,
  username VARCHAR(64) NOT NULL,
  quota_date DATE NOT NULL,
  enforced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, username, quota_date),
  KEY idx_uqs_tenant_date (tenant_id, quota_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
