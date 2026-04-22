#!/usr/bin/env bash
set -euo pipefail

echo "[1/4] Enable vm.overcommit_memory=1 for Redis"
sudo sysctl -w vm.overcommit_memory=1
echo "vm.overcommit_memory=1" | sudo tee /etc/sysctl.d/99-redis.conf >/dev/null
sudo sysctl --system >/dev/null

echo "[2/4] Ensure UFW is installed"
if ! command -v ufw >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y ufw
fi

echo "[3/4] Open required ports only (SSH, HTTP, HTTPS, RADIUS, CoA)"
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 1812/udp
sudo ufw allow 1813/udp
sudo ufw allow 3799/udp

echo "[4/4] Deny external MySQL/Redis ports"
sudo ufw deny 3306/tcp || true
sudo ufw deny 6379/tcp || true
sudo ufw --force enable
sudo ufw status

echo "Hardening completed."
