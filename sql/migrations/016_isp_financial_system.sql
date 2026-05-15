-- ISP company financial module: manager wallets ledger, commissions, settlements,
-- prepaid print batches, expenses, assets, cashbox, subscriber manager assignment.
-- Safe/idempotent: duplicate column/table errors are ignored by migrations runner.

-- ---------------------------------------------------------------------------
-- users: manager financial flags (staff rows)
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN commission_type VARCHAR(16) NOT NULL DEFAULT 'none';
ALTER TABLE users ADD COLUMN commission_value DECIMAL(14,4) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN commission_prepaid_fixed DECIMAL(14,2) NULL DEFAULT NULL;
ALTER TABLE users ADD COLUMN can_collect_payments TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN can_sell_prepaid_cards TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN can_print_prepaid_cards TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN can_renew_subscribers TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN manager_obligation_balance DECIMAL(14,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- subscribers: responsibility / ownership
-- ---------------------------------------------------------------------------
ALTER TABLE subscribers ADD COLUMN created_by_manager_id CHAR(36) NULL;
ALTER TABLE subscribers ADD COLUMN responsible_manager_id CHAR(36) NULL;
ALTER TABLE subscribers ADD COLUMN assigned_manager_id CHAR(36) NULL;
ALTER TABLE subscribers ADD COLUMN last_renewed_by_manager_id CHAR(36) NULL;
ALTER TABLE subscribers ADD COLUMN manager_assigned_at DATETIME(3) NULL;
ALTER TABLE subscribers ADD COLUMN manager_assignment_source VARCHAR(32) NULL;
ALTER TABLE subscribers ADD KEY idx_subscribers_responsible_manager (tenant_id, responsible_manager_id);

-- ---------------------------------------------------------------------------
-- Immutable manager wallet ledger (do not delete rows)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manager_wallet_ledger (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  manager_id CHAR(36) NOT NULL,
  type VARCHAR(48) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  balance_before DECIMAL(14,2) NOT NULL,
  balance_after DECIMAL(14,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  reference_type VARCHAR(64) NULL,
  reference_id VARCHAR(128) NULL,
  description VARCHAR(512) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  meta JSON NULL,
  PRIMARY KEY (id),
  KEY idx_mwl_tenant_mgr_time (tenant_id, manager_id, created_at),
  KEY idx_mwl_ref (tenant_id, reference_type, reference_id),
  CONSTRAINT fk_mwl_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_mwl_manager FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Commission records (separate from wallet balance)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manager_commission_entries (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  manager_id CHAR(36) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_id VARCHAR(128) NULL,
  subscriber_id CHAR(36) NULL,
  package_id CHAR(36) NULL,
  gross_amount DECIMAL(14,2) NOT NULL,
  commission_amount DECIMAL(14,2) NOT NULL,
  company_amount DECIMAL(14,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  ledger_entry_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mce_tenant_mgr (tenant_id, manager_id, created_at),
  KEY idx_mce_pkg (tenant_id, package_id),
  CONSTRAINT fk_mce_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_mce_manager FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS manager_package_commission_rules (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  manager_id CHAR(36) NOT NULL,
  package_id CHAR(36) NOT NULL,
  commission_type VARCHAR(16) NOT NULL DEFAULT 'none',
  commission_value DECIMAL(14,4) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mpc_mgr_pkg (tenant_id, manager_id, package_id),
  CONSTRAINT fk_mpc_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_mpc_manager FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mpc_package FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Settlements (جباية من المدير)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manager_settlements (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  manager_id CHAR(36) NOT NULL,
  note VARCHAR(512) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'open',
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_ms_tenant_mgr (tenant_id, manager_id, created_at),
  CONSTRAINT fk_ms_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_ms_manager FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS manager_settlement_payments (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  settlement_id CHAR(36) NULL,
  manager_id CHAR(36) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  payment_method VARCHAR(64) NOT NULL DEFAULT 'cash',
  note VARCHAR(512) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ledger_entry_id CHAR(36) NULL,
  PRIMARY KEY (id),
  KEY idx_msp_tenant_mgr (tenant_id, manager_id, created_at),
  KEY idx_msp_settlement (settlement_id),
  CONSTRAINT fk_msp_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_msp_settlement FOREIGN KEY (settlement_id) REFERENCES manager_settlements(id) ON DELETE SET NULL,
  CONSTRAINT fk_msp_manager FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Prepaid card print / sale batches
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prepaid_card_batches (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  batch_total_amount DECIMAL(14,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  printed_by CHAR(36) NULL,
  wallet_transaction_id CHAR(36) NULL,
  kind VARCHAR(24) NOT NULL DEFAULT 'print',
  note VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pcb_tenant (tenant_id, created_at),
  CONSTRAINT fk_pcb_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_pcb_user FOREIGN KEY (printed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prepaid_card_batch_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id CHAR(36) NOT NULL,
  rm_card_id BIGINT UNSIGNED NOT NULL,
  card_value DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_pcbi_batch (batch_id),
  CONSTRAINT fk_pcbi_batch FOREIGN KEY (batch_id) REFERENCES prepaid_card_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Company expenses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_assets (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  asset_type VARCHAR(64) NOT NULL,
  serial_number VARCHAR(120) NULL,
  purchase_price DECIMAL(14,2) NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  purchase_date DATE NULL,
  current_location VARCHAR(200) NULL,
  assigned_to VARCHAR(200) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'available',
  depreciation_note VARCHAR(255) NULL,
  notes TEXT NULL,
  linked_expense_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ca_tenant_type (tenant_id, asset_type),
  KEY idx_ca_linked_expense (linked_expense_id),
  CONSTRAINT fk_ca_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_expenses (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  category VARCHAR(64) NOT NULL,
  vendor VARCHAR(160) NULL,
  invoice_number VARCHAR(120) NULL,
  payment_method VARCHAR(64) NOT NULL DEFAULT 'cash',
  expense_date DATE NOT NULL,
  note TEXT NULL,
  attachment_path VARCHAR(512) NULL,
  linked_asset_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ce_tenant_date (tenant_id, expense_date),
  KEY idx_ce_category (tenant_id, category),
  KEY idx_ce_linked_asset (linked_asset_id),
  CONSTRAINT fk_ce_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_ce_asset FOREIGN KEY (linked_asset_id) REFERENCES company_assets(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE company_assets ADD CONSTRAINT fk_ca_expense FOREIGN KEY (linked_expense_id) REFERENCES company_expenses(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Cashbox / daily closing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cashbox_shifts (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  opened_by CHAR(36) NOT NULL,
  closed_by CHAR(36) NULL,
  opening_balance DECIMAL(14,2) NOT NULL DEFAULT 0,
  closing_balance_actual DECIMAL(14,2) NULL,
  collected_cash DECIMAL(14,2) NOT NULL DEFAULT 0,
  expenses_paid DECIMAL(14,2) NOT NULL DEFAULT 0,
  expected_balance DECIMAL(14,2) NULL,
  difference_amount DECIMAL(14,2) NULL,
  note VARCHAR(512) NULL,
  opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at DATETIME(3) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'open',
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  PRIMARY KEY (id),
  KEY idx_cs_tenant_open (tenant_id, opened_at),
  CONSTRAINT fk_cs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Subscriber manager assignment audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriber_manager_audit (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  subscriber_id CHAR(36) NOT NULL,
  old_manager_id CHAR(36) NULL,
  new_manager_id CHAR(36) NULL,
  reason VARCHAR(255) NULL,
  source VARCHAR(32) NULL,
  changed_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_sma_sub (subscriber_id, created_at),
  CONSTRAINT fk_sma_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_sma_sub FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Dedup guard for prepaid batch card links
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prepaid_card_batch_dedup (
  tenant_id CHAR(36) NOT NULL,
  rm_card_id BIGINT UNSIGNED NOT NULL,
  batch_id CHAR(36) NOT NULL,
  PRIMARY KEY (tenant_id, rm_card_id),
  CONSTRAINT fk_pcdd_batch FOREIGN KEY (batch_id) REFERENCES prepaid_card_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
