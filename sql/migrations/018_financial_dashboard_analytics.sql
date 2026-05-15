-- Financial dashboard analytics, EOD closings, alert dismissals, asset location extensions.
-- Safe to re-run: ignore duplicate column errors in migration runner.

CREATE TABLE IF NOT EXISTS financial_day_closings (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  business_date DATE NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'closed',
  expected_cash DECIMAL(14,2) NULL,
  actual_cash DECIMAL(14,2) NULL,
  variance_amount DECIMAL(14,2) NULL,
  notes TEXT NULL,
  signature_name VARCHAR(160) NULL,
  closed_by CHAR(36) NULL,
  closed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  admin_override_noted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fdc_tenant_date (tenant_id, business_date),
  KEY idx_fdc_tenant_closed (tenant_id, closed_at),
  CONSTRAINT fk_fdc_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_alert_dismissals (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  staff_id CHAR(36) NOT NULL,
  alert_key VARCHAR(160) NOT NULL,
  dismissed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_fad_staff_key (tenant_id, staff_id, alert_key),
  KEY idx_fad_tenant (tenant_id),
  CONSTRAINT fk_fad_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE company_assets ADD COLUMN tower_label VARCHAR(120) NULL;
ALTER TABLE company_assets ADD COLUMN assigned_manager_id CHAR(36) NULL;
ALTER TABLE company_assets ADD COLUMN maintenance_status VARCHAR(32) NULL DEFAULT 'ok';
