-- Future Radius — admin UI, finance audit, notifications, prepaid print templates.
-- Idempotent: safe to re-run on MySQL 8+.

CREATE TABLE IF NOT EXISTS financial_audit_logs (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  staff_id CHAR(36) NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NULL,
  entity_id VARCHAR(128) NULL,
  payload JSON NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_fin_audit_tenant_created (tenant_id, created_at),
  CONSTRAINT fk_fin_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_notifications (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  staff_id CHAR(36) NULL,
  type VARCHAR(48) NOT NULL DEFAULT 'info',
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  read_at DATETIME(3) NULL,
  meta JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_admin_notif_tenant_read (tenant_id, read_at, created_at),
  CONSTRAINT fk_admin_notif_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prepaid_card_templates (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  config_json JSON NOT NULL,
  background_path VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_card_tpl_tenant (tenant_id),
  CONSTRAINT fk_card_tpl_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
