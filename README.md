# Future Radius

## Security and deployment notes

- Copy `.env.example` to `.env` and set strong secrets before running `docker compose`.
- `mysql` and `redis` are bound to `127.0.0.1` only in `docker-compose.yml` to reduce public exposure.
- Run `ops/hostinger-hardening.sh` on the VPS to set `vm.overcommit_memory=1` and apply firewall rules.
- WAHA runtime values from environment (`WAHA_API_KEY`, `WAHA_INTERNAL_URL`, `WAHA_SESSION_NAME`) override stale DB settings to prevent post-deploy 401 mismatches.
- On first API startup, a default admin user is auto-created if missing:
  - Email: `admin@local.test`
  - Name (also accepted in login): `admin`
  - Password: `muhammadshuieb`
  - You can override via `.env`: `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, `SEED_ADMIN_PASSWORD`

## Update flow on Hostinger

Use this on the VPS after each push:

```bash
cd /path/to/Future-Radius
git pull origin main
docker compose up -d --build
```

## Optional PPTP VPN integration

If you need to link remote servers/NAS to the main server over VPN, you can run the built-in PPTP service profile:

```bash
docker compose --profile vpn up -d --build pptp-vpn
```

Important host/network requirements:

- Open `TCP 1723` on the VPS firewall.
- Allow `GRE` (IP protocol 47) on the VPS/network firewall.
- Ensure the host kernel supports PPP/PPTP (typical on most VPS images).

After tunnel clients connect, set each NAS `pptp_tunnel_ip` in the app so CoA/disconnect is sent through the tunnel address.