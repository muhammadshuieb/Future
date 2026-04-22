# Future Radius

## Security and deployment notes

- Copy `.env.example` to `.env` and set strong secrets before running `docker compose`.
- `mysql` and `redis` are bound to `127.0.0.1` only in `docker-compose.yml` to reduce public exposure.
- Run `ops/hostinger-hardening.sh` on the VPS to set `vm.overcommit_memory=1` and apply firewall rules.

## Update flow on Hostinger

Use this on the VPS after each push:

```bash
cd /path/to/Future-Radius
git pull origin main
docker compose up -d --build
```