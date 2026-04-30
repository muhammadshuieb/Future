#!/bin/bash
set -euo pipefail

export MYSQL_HOST="${MYSQL_HOST:-mysql}"
export MYSQL_USER="${MYSQL_USER:-radius}"
export MYSQL_PASSWORD="${MYSQL_PASSWORD:-radius123}"

TEMPLATE="/etc/freeradius/3.0/mods-available/sql.template"
OUT="/etc/freeradius/3.0/mods-available/sql"

envsubst '$MYSQL_HOST $MYSQL_USER $MYSQL_PASSWORD' < "$TEMPLATE" > "$OUT"

# After a large SQL restore, MySQL can accept TCP while still busy with recovery; starting
# FreeRADIUS too early causes SQL pool failures and a tight Docker restart loop (high CPU,
# container looks "stopped" in the UI). Wait for the port, then a short settle delay.
wait_for_mysql_port() {
  local host="$MYSQL_HOST" port="${MYSQL_PORT:-3306}"
  local max_attempts="${MYSQL_WAIT_MAX_ATTEMPTS:-90}"
  local sleep_s="${MYSQL_WAIT_SLEEP_SEC:-2}"
  local attempt=1
  echo "[freeradius] waiting for MySQL ${host}:${port} (up to $((max_attempts * sleep_s))s)..."
  while (( attempt <= max_attempts )); do
    if timeout 2 bash -c "exec 3<>/dev/tcp/${host}/${port}" 2>/dev/null; then
      echo "[freeradius] MySQL TCP is up (attempt ${attempt}). Settling ${MYSQL_SETTLE_SEC:-5}s before radiusd..."
      sleep "${MYSQL_SETTLE_SEC:-5}"
      return 0
    fi
    sleep "${sleep_s}"
    (( attempt++ )) || true
  done
  echo "[freeradius] ERROR: MySQL ${host}:${port} not reachable after ${max_attempts} attempts." >&2
  echo "[freeradius] Hint: after a full dump restore, ensure MySQL is up and user '${MYSQL_USER}' exists with password matching RADIUS_DB_PASSWORD (see docker/mysql/init/z-futureradius-followup.sh)." >&2
  return 1
}

wait_for_mysql_port

if ! freeradius -C; then
  echo "[freeradius] ERROR: freeradius -C (config / SQL) failed." >&2
  echo "[freeradius] Dumping generated SQL module (/etc/freeradius/3.0/mods-available/sql):" >&2
  sed -n '1,140p' "$OUT" >&2 || true
  echo "[freeradius] Running freeradius -XC for detailed parser/runtime error:" >&2
  freeradius -XC >&2 || true
  echo "[freeradius] Typical causes: wrong MYSQL_PASSWORD vs MySQL user '${MYSQL_USER}'; or SQL errors loading NAS clients (Radius Manager nas has no server column — see sql.template client_query)." >&2
  exit 1
fi

if [ "${FREERADIUS_DEBUG:-0}" = "1" ] || [ "${FREERADIUS_DEBUG:-}" = "yes" ]; then
  exec freeradius -X "$@"
else
  exec freeradius -f "$@"
fi
