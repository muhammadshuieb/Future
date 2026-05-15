-- Allow any template_key in message logs (e.g. financial_report) without ENUM errors.
ALTER TABLE whatsapp_message_logs
  MODIFY COLUMN template_key VARCHAR(64) NULL;
