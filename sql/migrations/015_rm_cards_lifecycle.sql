-- Prepaid card central lifecycle tracking (usage, termination, audit fields).
-- Re-runnable: duplicate column/index errors are benign on re-apply.

ALTER TABLE rm_cards
  ADD COLUMN lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'available'
    COMMENT 'available|active|consumed|expired|disabled' AFTER revoked;

ALTER TABLE rm_cards
  ADD COLUMN used_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER lifecycle_status;

ALTER TABLE rm_cards
  ADD COLUMN used_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER used_bytes;

ALTER TABLE rm_cards
  ADD COLUMN first_used_at DATETIME NULL AFTER used_seconds;

ALTER TABLE rm_cards
  ADD COLUMN last_used_at DATETIME NULL AFTER first_used_at;

ALTER TABLE rm_cards
  ADD COLUMN expired_at DATETIME NULL AFTER last_used_at;

ALTER TABLE rm_cards
  ADD COLUMN finished_at DATETIME NULL AFTER expired_at;

ALTER TABLE rm_cards
  ADD COLUMN terminate_reason VARCHAR(64) NULL AFTER finished_at;

ALTER TABLE rm_cards
  ADD COLUMN last_disconnect_status VARCHAR(255) NULL AFTER terminate_reason;

UPDATE rm_cards
SET lifecycle_status = CASE
  WHEN active = 0 OR revoked = 1 THEN 'disabled'
  WHEN expiration < CURDATE() THEN 'expired'
  ELSE 'available'
END
WHERE lifecycle_status = 'available';

CREATE INDEX idx_rm_cards_tenant_lifecycle ON rm_cards (tenant_id, lifecycle_status, active, revoked);
