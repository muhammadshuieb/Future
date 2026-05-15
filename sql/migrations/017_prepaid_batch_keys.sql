-- Idempotency + series on prepaid card batches (ISP finance phase 2)

ALTER TABLE prepaid_card_batches ADD COLUMN client_batch_key VARCHAR(64) NULL;
ALTER TABLE prepaid_card_batches ADD COLUMN series VARCHAR(64) NULL;

CREATE UNIQUE INDEX uq_pcb_tenant_client_key ON prepaid_card_batches (tenant_id, client_batch_key);
