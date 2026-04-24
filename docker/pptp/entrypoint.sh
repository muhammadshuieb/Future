#!/bin/sh
set -eu

RUNTIME_DIR="${PPTP_RUNTIME_DIR:-/var/lib/futureradius/pptp}"
STATE_FILE="$RUNTIME_DIR/pptp-state.env"
PID_FILE="/var/run/pptpd.pid"

mkdir -p /etc/ppp

PPTP_ENABLED="0"
PPTP_PORT="1723"
PPTP_PID=""
LAST_HASH=""

load_state() {
  PPTP_ENABLED="0"
  PPTP_PORT="1723"
  if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$STATE_FILE"
  fi
}

copy_runtime_files() {
  [ -f "$RUNTIME_DIR/pptpd.conf" ] && cp "$RUNTIME_DIR/pptpd.conf" /etc/pptpd.conf
  [ -f "$RUNTIME_DIR/pptpd-options" ] && cp "$RUNTIME_DIR/pptpd-options" /etc/ppp/pptpd-options
  [ -f "$RUNTIME_DIR/chap-secrets" ] && cp "$RUNTIME_DIR/chap-secrets" /etc/ppp/chap-secrets
  chmod 600 /etc/ppp/chap-secrets || true
}

stop_pptpd() {
  if [ -n "$PPTP_PID" ] && kill -0 "$PPTP_PID" 2>/dev/null; then
    kill "$PPTP_PID" 2>/dev/null || true
    wait "$PPTP_PID" 2>/dev/null || true
  fi
  PPTP_PID=""
}

start_pptpd() {
  if [ "$PPTP_ENABLED" != "1" ]; then
    echo "[pptp] disabled by runtime state"
    return
  fi
  if [ ! -f /etc/pptpd.conf ] || [ ! -f /etc/ppp/pptpd-options ] || [ ! -f /etc/ppp/chap-secrets ]; then
    echo "[pptp] runtime files not ready yet"
    return
  fi
  echo "[pptp] starting server on port $PPTP_PORT"
  /usr/sbin/pptpd --fg --option /etc/ppp/pptpd-options --pidfile "$PID_FILE" &
  PPTP_PID="$!"
}

calc_hash() {
  local files=""
  [ -f "$RUNTIME_DIR/pptpd.conf" ] && files="$files $RUNTIME_DIR/pptpd.conf"
  [ -f "$RUNTIME_DIR/pptpd-options" ] && files="$files $RUNTIME_DIR/pptpd-options"
  [ -f "$RUNTIME_DIR/chap-secrets" ] && files="$files $RUNTIME_DIR/chap-secrets"
  [ -f "$STATE_FILE" ] && files="$files $STATE_FILE"
  if [ -z "$files" ]; then
    echo "no-files"
    return
  fi
  # shellcheck disable=SC2086
  md5sum $files 2>/dev/null | md5sum | awk '{print $1}'
}

trap 'stop_pptpd; exit 0' INT TERM

echo "[pptp] runtime watcher started"
while true; do
  HASH="$(calc_hash)"
  if [ "$HASH" != "$LAST_HASH" ]; then
    load_state
    copy_runtime_files
    stop_pptpd
    start_pptpd
    LAST_HASH="$HASH"
  fi
  if [ -n "$PPTP_PID" ] && ! kill -0 "$PPTP_PID" 2>/dev/null; then
    echo "[pptp] process exited, restarting"
    load_state
    start_pptpd
  fi
  sleep 3
done
