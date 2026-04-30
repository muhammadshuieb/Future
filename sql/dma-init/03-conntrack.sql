-- Optional Radius Manager `conntrack` database (matches classic conntrack.sql layout).
-- Core RADIUS data lives in MYSQL_DATABASE (e.g. radius); this file only adds the
-- historical `conntrack` sidecar DB when present in vendor dumps.

SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS `conntrack` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `conntrack`;

DROP TABLE IF EXISTS `tabidx`;
CREATE TABLE IF NOT EXISTS `tabidx` (
  `date` date NOT NULL,
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
