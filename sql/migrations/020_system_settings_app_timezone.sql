ALTER TABLE system_settings
  ADD COLUMN app_timezone VARCHAR(64) DEFAULT NULL
  AFTER billing_currency;
