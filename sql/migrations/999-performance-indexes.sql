-- Applied only on fresh installs without rm_users (see migrations.service.ts).
-- For Radius Manager / DMA restores, run: npm run apply:dma-indexes (from api/).

CREATE INDEX idx_radacct_username_stop ON radacct (username, acctstoptime);
CREATE INDEX idx_radacct_nas_session ON radacct (nasipaddress, acctsessionid);
CREATE INDEX idx_radacct_start_time ON radacct (acctstarttime);

CREATE INDEX idx_radcheck_username_attr ON radcheck (username, attribute);
CREATE INDEX idx_radreply_username_attr ON radreply (username, attribute);

CREATE INDEX idx_rm_users_srvid ON rm_users (srvid);
CREATE INDEX idx_rm_users_expiration ON rm_users (expiration);

CREATE INDEX idx_subscribers_username ON subscribers (username);
CREATE INDEX idx_subscribers_package ON subscribers (package_id);
CREATE INDEX idx_subscribers_expiration ON subscribers (expiration_date);

CREATE INDEX idx_invoices_status_date ON invoices (status, created_at);
CREATE INDEX idx_invoices_subscriber ON invoices (subscriber_id);

CREATE INDEX idx_payments_invoice_paid_at ON payments (invoice_id, paid_at);
