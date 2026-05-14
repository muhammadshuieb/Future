# Future Radius

## Security and deployment notes

- Copy `.env.example` to `.env` and set strong secrets before running `docker compose`.
- **HTTP entrypoint:** the `web` service (nginx on host port **8080**) serves the UI and reverse-proxies **`/api`** and **`/ws`** to the API container (`api:3000`). The API is not published on the host by default; use `8080` for health checks from the host (`/health` is also proxied).
- **Workers:** BullMQ jobs (usage/quota, accounting-related cycles, WhatsApp, backups, QoE, speed profiles, etc.) run in the single **`worker`** service. MySQL logical dumps for disaster recovery should be handled by your **external** backup tooling or host snapshots—not a sidecar in this compose file.
- `mysql` and `redis` are bound to `127.0.0.1` only in `docker-compose.yml` to reduce public exposure.
- Run `ops/hostinger-hardening.sh` on the VPS to set `vm.overcommit_memory=1` and apply firewall rules.
- WAHA runtime values from environment (`WAHA_API_KEY`, `WAHA_INTERNAL_URL`, `WAHA_SESSION_NAME`) override stale DB settings to prevent post-deploy 401 mismatches.
- On first API startup, a default admin user is auto-created if missing (non-production, or production when `STAFF_BOOTSTRAP_PASSWORD` is set in `.env`):
  - Email: `admin@futureradius.local` (typing `root` in the email field also resolves to this account)
  - Password (dev / `.env.example` default): `muhammadshuieb`

## Update flow on Hostinger

Use this on the VPS after each push:

```bash
cd /path/to/Future-Radius
git pull origin main
docker compose up -d --build
```