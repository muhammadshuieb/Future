#!/bin/bash
mysql_note "futureradius: runtime database grants"
: "${RADIUS_DB_USER:=radius}"
: "${RADIUS_DB_PASSWORD:?RADIUS_DB_PASSWORD is required}"
_fr_sql_escape() { printf '%s' "$1" | sed "s/'/''/g"; }
_fr_u="$(_fr_sql_escape "${RADIUS_DB_USER}")"
_fr_p="$(_fr_sql_escape "${RADIUS_DB_PASSWORD}")"
docker_process_sql --database="${MYSQL_DATABASE}" <<SQL
CREATE USER IF NOT EXISTS '${_fr_u}'@'%' IDENTIFIED BY '${_fr_p}';
ALTER USER '${_fr_u}'@'%' IDENTIFIED BY '${_fr_p}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO '${_fr_u}'@'%';
FLUSH PRIVILEGES;
SQL
