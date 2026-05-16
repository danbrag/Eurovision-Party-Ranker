# Docker Deployment Walkthrough

This app is ready to deploy as a Docker service. It runs one Node container that serves the built Vite frontend, the Express API, Socket.IO realtime updates, and a SQLite database stored in a Docker volume.

## What You Need

- A server with SSH access.
- A domain pointed at the server's public IP address.
- Docker and Docker Compose installed on the server.
- This repository pushed to GitHub or copied to the server.

## 1. Install Docker On The Server

On Ubuntu/Debian, the quickest path is Docker's official install script:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
```

Log out and back in after `usermod`, then confirm Docker works:

```bash
docker --version
docker compose version
```

## 2. Put The App On The Server

Clone the repo into a stable location:

```bash
mkdir -p ~/apps
cd ~/apps
git clone YOUR_GIT_REPO_URL eurovision-2026
cd eurovision-2026
```

If the repo is already there later, update it with:

```bash
cd ~/apps/eurovision-2026
git pull
```

## 3. Create The Private Environment File

Copy the example file:

```bash
cp .env.example .env
nano .env
```

Set `ROOM_CODE` and `ADMIN_PIN` to private values:

```bash
ROOM_CODE=choose-a-private-room-code
ADMIN_PIN=
HOST_PORT=3000
MAX_PARTICIPANTS=6
OFFICIAL_WATCH_ENABLED=false
OFFICIAL_WATCH_INTERVAL_MS=45000
```

Set `ROOM_CODE` to the code you will share directly with participants, and set `ADMIN_PIN` to a value that is not shared publicly. The `.env` file is ignored by Git so your private settings do not get committed. Docker Compose passes these values into the container through `env_file`. If `ROOM_CODE` is missing, the server will not start. If `ADMIN_PIN` is missing or left as a known placeholder, the app still starts, but admin actions are disabled until you fix `.env`.

## 4. Start The App

Build and run the container:

```bash
docker compose up -d --build
```

Check that it is running:

```bash
docker compose ps
docker compose logs -f
```

In another SSH session, test the local health endpoint:

```bash
curl http://127.0.0.1:3000/api/health
```

You should see JSON with `"ok":true`.

## 5. Put A Domain In Front Of It

The compose file binds the app to `127.0.0.1:3000`, which means it is only reachable from the server itself. Put Caddy, Nginx, or another reverse proxy in front of it for HTTPS.

### Caddy Example

Install Caddy, then create or edit `/etc/caddy/Caddyfile`:

```caddyfile
your-domain.com {
  reverse_proxy 127.0.0.1:3000
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

Caddy will request and renew HTTPS certificates automatically.

## 6. Deploy Updates Later

When you push changes to GitHub, SSH into the server and run:

```bash
cd ~/apps/eurovision-2026
git pull
docker compose up -d --build
```

Or use the included deploy script:

```bash
cd ~/apps/eurovision-2026
./deploy.sh
```

Your app data survives rebuilds because SQLite lives in the named Docker volume `eurovision-data`.

## Useful Commands

View logs:

```bash
docker compose logs -f
```

Restart:

```bash
docker compose restart
```

Stop:

```bash
docker compose down
```

Check the database volume exists:

```bash
docker volume ls | grep eurovision
```

## Notes

- Keep `OFFICIAL_WATCH_ENABLED=false` unless you specifically want the app polling Eurovision's official pages.
- If port `3000` is already taken on your server, change `HOST_PORT` in `.env`, then update your reverse proxy to match.
- Do not delete the `eurovision-data` Docker volume unless you intentionally want to wipe room participants, scores, rankings, and admin-entered official results.
