-- FreeRADIUS / SaaS accounting performance (safe to run once; ignore errors if indexes exist)
-- MySQL 8+: you may use ALGORITHM=INPLACE, LOCK=NONE on large tables under maintenance window.

SET NAMES utf8mb4;

CREATE INDEX idx_radacct_user ON radacct (username);
CREATE INDEX idx_radacct_active ON radacct (acctstoptime);
CREATE INDEX idx_radacct_session ON radacct (acctsessionid);
