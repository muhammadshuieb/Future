# Future Radius Install Method (Ubuntu)

This guide covers a full installation on Ubuntu server, starting from Docker installation to running all services successfully.

## 1) System Update

```bash
sudo apt update
sudo apt upgrade -y
```

Optional but recommended after kernel/systemd updates:

```bash
sudo reboot
```

## 2) Install Docker Engine (Official Repository)

Install prerequisites:

```bash
sudo apt install -y apt-transport-https ca-certificates curl software-properties-common
```

Add Docker GPG key and repository:

```bash
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"
sudo apt update
```

Install Docker + Compose plugin (v2):

```bash
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Verify:

```bash
docker --version
docker compose version
sudo docker run hello-world
```

## 3) (Important) Use Compose v2 Only

Use `docker compose` (with space), not legacy `docker-compose`.

If old binary was manually installed, remove it:

```bash
sudo rm -f /usr/local/bin/docker-compose
```

## 4) Clone Project

```bash
cd /home/<your-user>
git clone https://github.com/muhammadshuieb/Future.git
cd Future
```

## 5) Prepare Environment File

Create `.env` from example (if not already created):

```bash
cp .env.example .env
```

Edit required values in `.env` (at minimum):

- `MYSQL_ROOT_PASSWORD`
- `JWT_SECRET`
- `AES_SECRET_KEY`
- `WAHA_API_KEY`
- `WAHA_DASHBOARD_USERNAME`
- `WAHA_DASHBOARD_PASSWORD`
- `WHATSAPP_SWAGGER_USERNAME`
- `WHATSAPP_SWAGGER_PASSWORD`
- `RADIUS_DB_PASSWORD`

## 6) First Start

Start all services:

```bash
docker compose up -d
```

Check status:

```bash
docker compose ps
```

You should eventually see containers in `Up` state and core services healthy (especially `mysql`, `redis`, `api`).

## 7) If Build Fails with IPv6/Docker Hub Error

If you see an error like:

`connect: network is unreachable` with IPv6 address (`2600:...`) while pulling images.

Apply this fix:

```bash
sudo sed -i 's/^#precedence ::ffff:0:0\/96  100/precedence ::ffff:0:0\/96  100/' /etc/gai.conf
sudo mkdir -p /etc/docker
cat <<'EOF' | sudo tee /etc/docker/daemon.json
{
  "ipv6": false,
  "dns": ["8.8.8.8", "1.1.1.1"]
}
EOF
sudo systemctl restart docker
```

Then retry failed build/start:

```bash
docker compose build worker
docker compose up -d worker
docker compose up -d
```

## 8) Health and Logs Validation

Quick checks:

```bash
docker compose ps
docker compose logs --tail=200 api
docker compose logs --tail=200 worker
docker compose logs --tail=200 freeradius
```

API health endpoint:

```bash
curl -s http://127.0.0.1:3000/health
```

Expected response:

```json
{"ok":true}
```

## 9) Useful Operations

Restart specific service:

```bash
docker compose restart api
```

Rebuild specific service:

```bash
docker compose up -d --build api
```

Stop all:

```bash
docker compose down
```

Stop all and remove volumes (danger: deletes persistent data):

```bash
docker compose down -v
```

## 10) Final Success Criteria

Installation is considered complete when:

- `docker compose ps` shows all required services running.
- `mysql` and `redis` are healthy.
- `api` responds with `{"ok":true}` on `/health`.
- `worker` is up without crash loop.
- Frontend/UI is reachable on configured port.

## 11) RADIUS + NAS (required for MikroTik auth)

FreeRADIUS loads NAS clients from the MySQL table `nas`. The **`nasname`** column (shown as **IP** in the admin UI) must be the **source IP of RADIUS packets as seen by the server**, not the RADIUS server address you type in the router.

- **Plain routing / LAN:** usually the MikroTik interface IP that faces the RADIUS host.
- **WireGuard in this stack:** often the peer address (example `10.20.0.2`) while the server listens on `10.20.0.1`. If this row is missing or wrong, `/var/log/freeradius/radius.log` shows `unknown client` and the router sees **timeouts** (no Accept/Reject).

After adding or changing a NAS in the DB, restart RADIUS:

```bash
docker compose restart freeradius
```

Quick verification while a PPPoE user tries to connect:

```bash
sudo tcpdump -ni wg0 udp port 1812 -c 5
docker compose exec freeradius tail -n 40 /var/log/freeradius/radius.log
```

Use `FREERADIUS_DEBUG=1` in `.env` for verbose output, then recreate the `freeradius` service.

## 12) PPPoE speed / MikroTik queue (RADIUS reply)

DMA mode maps **`rm_services.downrate` / `uprate`** (bytes per second, Radius Manager convention) into the RADIUS attribute **`Mikrotik-Rate-Limit`**. Services with **both rates zero** (e.g. template “Access list” profiles) send **no** rate attribute, so the router queue stays empty.

After changing a subscriber’s package or fixing service rates in `rm_services`, **push RADIUS again** from the admin UI (subscriber “sync RADIUS” / save) or `PATCH` the subscriber so `radreply` is rebuilt. Then reconnect the PPPoE session (or disconnect) so MikroTik applies the new reply.

