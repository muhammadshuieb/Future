-- radacct grows without bound on busy ISPs. Partitioning is a DBA/maintenance task — NOT auto-applied.
-- Review MySQL version, PRIMARY KEY requirements for partitioning, and backup before ALTER.
--
-- Example pattern (adapt dates / engine / PK to your schema):
--
-- ALTER TABLE radacct PARTITION BY RANGE (YEAR(acctstarttime)) (
--   PARTITION p2024 VALUES LESS THAN (2025),
--   PARTITION p2025 VALUES LESS THAN (2026),
--   PARTITION pmax VALUES LESS THAN MAXVALUE
-- );
--
-- For RANGE COLUMNS (common in 8.0):
-- ALTER TABLE radacct PARTITION BY RANGE COLUMNS (acctstarttime) (...);
--
-- Prefer archiver jobs (see docker/mysql/opt scripts) + indexes (npm run apply:dma-indexes) before partitioning.

SELECT 'radacct-partitioning-template: read comments only — no DDL executed' AS note;
