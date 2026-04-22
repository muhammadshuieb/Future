-- Future Radius — align legacy `packages` rows with schema_extensions.sql
-- Run once on database `radius` if INSERT fails on missing columns.
-- If MySQL reports "Duplicate column name", that line already applied — continue with the rest.

ALTER TABLE packages
  ADD COLUMN default_framed_pool VARCHAR(64) DEFAULT NULL COMMENT 'Framed-Pool default for radreply';
