#!/bin/bash
# Runs after 01-radius.sql, 02-cumulate.sql, 03-conntrack.sql (lexical order before 'z-').
# Applies FreeRADIUS grants, events, and InnoDB tuning — not the Radius Manager data model.
mysql_note "futureradius: FreeRADIUS MySQL schema alignment (no baseline re-import)"
docker_process_sql --database="${MYSQL_DATABASE}" < /opt/futureradius/01b-freeradius-mysql-schema.sql
mysql_note "futureradius: freeradius SQL user (from RADIUS_DB_* — must match freeradius container)"
: "${RADIUS_DB_USER:=radius}"
: "${RADIUS_DB_PASSWORD:?RADIUS_DB_PASSWORD is required (same value as api/freeradius .env)}"
# Escape single quotes for SQL string literals (MySQL: ' -> '')
_fr_sql_escape() { printf '%s' "$1" | sed "s/'/''/g"; }
_fr_u="$(_fr_sql_escape "${RADIUS_DB_USER}")"
_fr_p="$(_fr_sql_escape "${RADIUS_DB_PASSWORD}")"
docker_process_sql --database="${MYSQL_DATABASE}" <<SQL
CREATE USER IF NOT EXISTS '${_fr_u}'@'%' IDENTIFIED BY '${_fr_p}';
ALTER USER '${_fr_u}'@'%' IDENTIFIED BY '${_fr_p}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO '${_fr_u}'@'%';
FLUSH PRIVILEGES;
SQL
mysql_note "futureradius: radacct daily cleanup event (30d retention)"
docker_process_sql --database="${MYSQL_DATABASE}" < /opt/futureradius/04-radacct-cleanup-event.sql
mysql_note "futureradius: radacct STATS_AUTO_RECALC + histogram cleanup (MySQL 8.4+ MY-015116 mitigation)"
docker_process_sql --database="${MYSQL_DATABASE}" < /opt/futureradius/05-radacct-stats-autorecalc-off.sql
mysql_note "futureradius: enforce clean-install runtime state (no users/packages/nas)"
docker_process_sql --database="${MYSQL_DATABASE}" < /opt/futureradius/06-clean-install-state.sql
