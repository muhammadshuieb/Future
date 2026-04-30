-- Placeholder after 01-radius.sql. Your Radius Manager environment may ship a separate
-- cumulation schema or `rm_cumulate` via a full SQL restore — do not run the legacy
-- year-rollup `cumulate.sql` here (it mutates radacct). Import official dumps via Maintenance.

SET NAMES utf8mb4;
SELECT 1 AS futureradius_dma_init_cumulate_ok;
