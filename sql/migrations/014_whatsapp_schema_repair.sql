-- Critical WhatsApp schema repair (run once if templates/logs API return 500).
-- New columns (company_name, emoji_image_url, …) are added automatically by the API on startup.

ALTER TABLE whatsapp_templates
  MODIFY COLUMN template_key
    ENUM('new_account','expiry_soon','payment_due','usage_threshold','invoice_paid') NOT NULL;

ALTER TABLE whatsapp_message_logs
  MODIFY COLUMN template_key VARCHAR(64) NULL;
