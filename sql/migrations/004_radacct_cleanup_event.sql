-- Purge ended sessions older than 30 days. Requires event_scheduler = ON (see my.cnf).
SET NAMES utf8mb4;

DROP EVENT IF EXISTS `cleanup_radacct`;

CREATE EVENT `cleanup_radacct`
ON SCHEDULE EVERY 1 DAY
COMMENT 'Delete radacct rows where acctstoptime IS NOT NULL and older than 30 days'
DO
  DELETE FROM `radacct`
  WHERE `acctstoptime` IS NOT NULL
    AND `acctstoptime` < NOW() - INTERVAL 30 DAY;
