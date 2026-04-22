# Future Radius

## Security and deployment notes

- Copy `.env.example` to `.env` and set strong secrets before running `docker compose`.
- `mysql` and `redis` are bound to `127.0.0.1` only in `docker-compose.yml` to reduce public exposure.
- Run `ops/hostinger-hardening.sh` on the VPS to set `vm.overcommit_memory=1` and apply firewall rules.
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