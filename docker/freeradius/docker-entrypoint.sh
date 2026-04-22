#!/bin/bash
set -euo pipefail

export MYSQL_HOST="${MYSQL_HOST:-mysql}"
export MYSQL_USER="${MYSQL_USER:-radius}"
export MYSQL_PASSWORD="${MYSQL_PASSWORD:-radius123}"

TEMPLATE="/etc/freeradius/3.0/mods-available/sql.template"
OUT="/etc/freeradius/3.0/mods-available/sql"

envsubst '$MYSQL_HOST $MYSQL_USER $MYSQL_PASSWORD' < "$TEMPLATE" > "$OUT"

if [ "${FREERADIUS_DEBUG:-0}" = "1" ] || [ "${FREERADIUS_DEBUG:-}" = "yes" ]; then
  exec freeradius -X "$@"
else
  exec freeradius -f "$@"
fi
