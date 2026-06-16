# andromedatv

This is a single-page livestream webapp with schedule + chat, deployable as a single container

## Tooling

- Bun is the package manager for both the root app and the `server/` package.
- Node 24 remains the production runtime for the backend container.

## Frontend

### Stack

Typescript + React + Vite + TailwindCSS + Bun

### Runtime routing

The app is served from one origin and one process:

- `/` -> SPA frontend
- `/api/chat/*` -> chat API + SSE
- `/api/schedule` -> normalized schedule API
- `/iptv/*` -> reverse proxy to external ErsatzTV

### Local frontend scripts

- `bun run dev:frontend`
- `bun run build`
- `bun run preview`
- `bun run lint`
- `bun run test:client`
- `bun run test:e2e`

### Local backend scripts

- `bun run --cwd server dev`
- `bun run --cwd server build`
- `bun run --cwd server test`

### Run the full app locally

Configure the root `.env`, then start the Vite frontend and Express backend
together:

```bash
bun run dev
```

Open `http://localhost:5173`. Vite proxies `/api` and `/iptv` requests to the
backend at `http://127.0.0.1:3001`.

For browser smoke tests, install Chromium once locally with:

```bash
bunx playwright install chromium
```

## Backend

### Stack

Node + Express + SQLite

### Notes

- Simple username/password auth
- Auth endpoints are rate limited per client IP: login allows 10 failed
  attempts per 15 minutes, register allows 5 accounts per hour (set `TRUST_PROXY`
  behind a reverse proxy so these see real client addresses)
- Security response headers (Content-Security-Policy, X-Frame-Options: DENY,
  X-Content-Type-Options, Referrer-Policy, Cross-Origin-Opener-Policy,
  Permissions-Policy, and HSTS over HTTPS) are sent on app responses; the `/iptv`
  proxy is left as a clean pass-through
- 100-message history cap
- Username must be 3-24 chars: letters, numbers, underscore, hyphen
- Password length: 6-72 chars
- Message length: 1-500 chars
- Messages are trimmed to the latest 100 after each insert

## Deployment

### 1) Configure environment

In a dedicated directory, create `.env` from `.env.example` and set:

```
ERSATZTV_BASE_URL=http://your-ersatztv-host:8409 # Required - replace this with your ErsatzTV host URL

INITIAL_ADMIN_NICKNAME=andromedatv # Required - bootstraps the first admin if none exists

INITIAL_ADMIN_PASSWORD=replace_me # Required - must be set together with INITIAL_ADMIN_NICKNAME

CORS_ORIGIN=https://yourdomain.com # Optional - default is same-origin only. Set a specific origin (or comma-separated list) to let a separate first-party frontend use cookie auth. "*" allows any origin but disables credentials.

PUBLIC_APP_ORIGIN=https://yourdomain.com # Recommended behind a reverse proxy and for IPTV playlist rewriting

STATUS_API_MODE=admin # Optional - "admin" (default), "public", or "disabled"

TRUST_PROXY=true # Optional - only set when running behind a trusted reverse proxy

JWT_SECRET=replace_me # Optional - if omitted, the app will generate and persist one under /data

DB_PATH=/data/andromeda.db # Optional - default database path

MAX_STREAM_CLIENTS=1000 # Optional - global cap on concurrent chat (SSE) connections; raise the container's open-file limit if you increase this

MAX_STREAM_CLIENTS_PER_IP=20 # Optional - per-IP cap on concurrent chat (SSE) connections

```

The admin bootstrap only runs when there are no admin users in the database. After the first admin exists, those variables are ignored unless you reset the chat DB.

If `JWT_SECRET` is omitted, the app writes a generated secret to `/data/jwt-secret` on first boot and reuses it on later starts. Keep the `/data` volume persistent so chat sessions remain valid across restarts.

Set `PUBLIC_APP_ORIGIN` whenever the app is served through a reverse proxy or public hostname that differs from the backend listener. That keeps rewritten IPTV playlist URLs stable without trusting arbitrary forwarded headers. Only set `TRUST_PROXY` if the app is actually behind a proxy you control.

### 2) Start

Create `compose.yaml` in the same directory:

```yaml
services:
  andromedatv:
    container_name: andromedatv
    image: ghcr.io/chriscorbell/andromedatv:latest
    restart: unless-stopped
    ports:
      - "3834:3001"
    env_file:
      - .env
    volumes:
      - ./data:/data
```

Then run:

```bash
docker compose up -d
```

### 3) Data Persistence

App data is persisted via host bind mount:

- `./data:/data`

## Health and checks

- App health: `/health`
- Chat health: `/api/chat/health`
- Diagnostics: `/api/status` (admin-authenticated by default; configure with `STATUS_API_MODE`)
- Schedule API: `/api/schedule`
- XMLTV via proxy: `/iptv/xmltv.xml`
- HLS via proxy: `/iptv/session/1/hls.m3u8`
