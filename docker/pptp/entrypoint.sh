#!/bin/sh
set -eu

RUNTIME_DIR="${PPTP_RUNTIME_DIR:-/var/lib/futureradius/pptp}"
STATE_FILE="$RUNTIME_DIR/pptp-state.env"
PID_FILE="/var/run/pptpd.pid"
START_LOG="/tmp/pptpd-start.log"
PPP_LOG="/var/log/pppd.log"

mkdir -p /etc/ppp

PPTP_ENABLED="0"
PPTP_PORT="1723"
PPTP_PID=""
LOG_TAIL_PID=""
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

ensure_ppp_device() {
  if [ ! -c /dev/ppp ]; then
    echo "[pptp] /dev/ppp missing, creating character device"
    mkdir -p /dev
    mknod /dev/ppp c 108 0 || true
    chmod 600 /dev/ppp || true
  fi
}

ensure_ppp_log() {
  mkdir -p /var/log
  touch "$PPP_LOG"
  chmod 600 "$PPP_LOG" || true
  if [ -z "$LOG_TAIL_PID" ] || ! kill -0 "$LOG_TAIL_PID" 2>/dev/null; then
    tail -n 0 -F "$PPP_LOG" &
    LOG_TAIL_PID="$!"
  fi
}

is_pptp_listening() {
  ss -lnt 2>/dev/null | awk -v p=":$PPTP_PORT" '$4 ~ (p "$") { found=1 } END { exit !found }'
}

stop_pptpd() {
  if [ -f "$PID_FILE" ]; then
    FILE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$FILE_PID" ] && kill -0 "$FILE_PID" 2>/dev/null; then
      kill "$FILE_PID" 2>/dev/null || true
      wait "$FILE_PID" 2>/dev/null || true
    fi
    rm -f "$PID_FILE" || true
  fi
  if [ -n "$PPTP_PID" ] && kill -0 "$PPTP_PID" 2>/dev/null; then
    kill "$PPTP_PID" 2>/dev/null || true
    wait "$PPTP_PID" 2>/dev/null || true
  fi
  pkill -x pptpd 2>/dev/null || true
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
  ensure_ppp_device
  ensure_ppp_log
  rm -f "$PID_FILE" || true
  : > "$START_LOG"
  /usr/sbin/pptpd --option /etc/ppp/pptpd-options --pidfile "$PID_FILE" >"$START_LOG" 2>&1 || true
  i=0
  while [ "$i" -lt 6 ]; do
    if is_pptp_listening; then
      PPTP_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
      if [ -z "$PPTP_PID" ]; then
        PPTP_PID="$(pgrep -xo pptpd 2>/dev/null || true)"
      fi
      break
    fi
    sleep 1
    i=$((i + 1))
  done
  if ! is_pptp_listening; then
    echo "[pptp] failed to start: pptpd is not running"
    if [ -s "$START_LOG" ]; then
      echo "[pptp] start output:"
      cat "$START_LOG"
    fi
    echo "[pptp] /dev/ppp status:"
    ls -l /dev/ppp 2>/dev/null || echo "/dev/ppp is missing"
    echo "[pptp] pppd log:"
    if [ -s "$PPP_LOG" ]; then
      tail -n 80 "$PPP_LOG"
    else
      echo "pppd log is empty"
    fi
    PPTP_PID=""
    return
  fi
  if [ -n "$PPTP_PID" ]; then
    echo "[pptp] started with pid $PPTP_PID"
  else
    echo "[pptp] started (pid unavailable, listener is up)"
  fi
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

trap 'stop_pptpd; [ -n "$LOG_TAIL_PID" ] && kill "$LOG_TAIL_PID" 2>/dev/null || true; exit 0' INT TERM

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
  if ! is_pptp_listening; then
    echo "[pptp] process exited, restarting"
    load_state
    start_pptpd
  fi
  sleep 3
done
