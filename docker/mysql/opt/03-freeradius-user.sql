-- Dedicated DB user for FreeRADIUS (rlm_sql). Applied after DMA + extensions.
-- Change password in production; keep in sync with docker-compose freeradius env.

CREATE USER IF NOT EXISTS 'radius'@'%' IDENTIFIED BY 'radius123';
GRANT ALL PRIVILEGES ON `radius`.* TO 'radius'@'%';
FLUSH PRIVILEGES;
