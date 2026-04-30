-- Future Radius: no extension DDL. Radius Manager schema comes only from your full SQL dump (e.g. radius.sql).
-- Do not use SOURCE here: when this file is piped into `mysql` from the API container, paths like /opt/... are not mounted.
-- Docker MySQL init uses /docker-entrypoint-initdb.d/radius.sql instead.
SELECT 1;
