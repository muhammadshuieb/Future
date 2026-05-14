-- Prepaid-style integration test cards (independent of legacy RM prepaid tables).
-- Used by api/src/scripts/radius-nas-integration-test.ts for E2E recharge flows.

CREATE TABLE IF NOT EXISTS prepaid_integration_test_cards (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  card_code VARCHAR(64) NOT NULL,
  package_id CHAR(36) NOT NULL,
  validity_hours INT NOT NULL DEFAULT 24,
  status VARCHAR(32) NOT NULL DEFAULT 'available',
  redeemed_by_subscriber_id CHAR(36) NULL,
  redeemed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_prepaid_card_code (tenant_id, card_code),
  KEY idx_prepaid_tenant_status (tenant_id, status),
  CONSTRAINT fk_prepaid_card_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_prepaid_card_pkg FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
