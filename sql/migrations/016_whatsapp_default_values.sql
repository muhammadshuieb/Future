ALTER TABLE whatsapp_settings
  MODIFY COLUMN reminder_days INT NOT NULL DEFAULT 5,
  MODIFY COLUMN message_interval_seconds INT NOT NULL DEFAULT 30;

UPDATE whatsapp_settings
SET reminder_days = 5
WHERE reminder_days = 7;

UPDATE whatsapp_settings
SET message_interval_seconds = 30
WHERE message_interval_seconds = 5;
