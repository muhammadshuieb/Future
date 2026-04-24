#!/bin/sh
set -eu

RUNTIME_DIR="${WIREGUARD_RUNTIME_DIR:-/var/lib/futureradius/wireguard}"
STATE_FILE="$RUNTIME_DIR/wireguard-state.env"
CONFIG_FILE="$RUNTIME_DIR/wg0.conf"
TARGET_DIR="/etc/wireguard"
TARGET_CONFIG="$TARGET_DIR/wg0.conf"

WIREGUARD_ENABLED="0"
LAST_HASH=""
WG_UP="0"

load_state() {
  WIREGUARD_ENABLED="0"
  if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$STATE_FILE"
  fi
}

calc_hash() {
  local files=""
  [ -f "$CONFIG_FILE" ] && files="$files $CONFIG_FILE"
  [ -f "$STATE_FILE" ] && files="$files $STATE_FILE"
  if [ -z "$files" ]; then
    echo "no-files"
    return
  fi
  # shellcheck disable=SC2086
  md5sum $files 2>/dev/null | md5sum | awk '{print $1}'
}

stop_wireguard() {
  if [ "$WG_UP" = "1" ] || ip link show wg0 >/dev/null 2>&1; then
    echo "[wireguard] stopping wg0"
    wg-quick down wg0 || true
  fi
  WG_UP="0"
}

start_wireguard() {
  if [ "$WIREGUARD_ENABLED" != "1" ]; then
    echo "[wireguard] disabled by runtime state"
    return
  fi
  if [ ! -f "$CONFIG_FILE" ]; then
    echo "[wireguard] runtime config not ready yet"
    return
  fi
  mkdir -p "$TARGET_DIR"
  cp "$CONFIG_FILE" "$TARGET_CONFIG"
  chmod 600 "$TARGET_CONFIG" || true
  echo "[wireguard] starting wg0"
  if wg-quick up wg0; then
    WG_UP="1"
    wg show wg0 || true
  else
    echo "[wireguard] failed to start wg0"
    WG_UP="0"
  fi
}

trap 'stop_wireguard; exit 0' INT TERM

echo "[wireguard] runtime watcher started"
while true; do
  HASH="$(calc_hash)"
  if [ "$HASH" != "$LAST_HASH" ]; then
    load_state
    stop_wireguard
    start_wireguard
    LAST_HASH="$HASH"
  fi
  if [ "$WIREGUARD_ENABLED" = "1" ] && [ "$WG_UP" = "1" ] && ! ip link show wg0 >/dev/null 2>&1; then
    echo "[wireguard] interface disappeared, restarting"
    start_wireguard
  fi
  sleep 3
done
