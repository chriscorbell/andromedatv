# andromedatv

This is a single-page livestream webapp with schedule + chat, deployable as a single container

## Frontend

### Stack

Typescript + React + Vite + TailwindCSS + Bun

### Runtime routing

The app is served from one origin and one process:

- `/` -> SPA frontend
- `/chat/*` -> chat API + SSE
- `/iptv/*` -> reverse proxy to external ErsatzTV

### Local frontend scripts

- `bun run dev`
- `bun run build`
- `bun run preview`
- `bun run lint`

## Backend

### Stack

Node + Express + SQLite

### Notes

- Simple username/password auth
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

CORS_ORIGIN=https://yourdomain.com # Optional - default is "*"

JWT_SECRET=replace_me # Optional - if omitted, the app will generate and persist one under /data

```

The admin bootstrap only runs when there are no admin users in the database. After the first admin exists, those variables are ignored unless you reset the chat DB.

If `JWT_SECRET` is omitted, the app writes a generated secret to `/data/jwt-secret` on first boot and reuses it on later starts. Keep the `/data` volume persistent so chat sessions remain valid across restarts.

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

Chat DB is persisted via host bind mount:

- `./chat-data:/data`

## Health and checks

- App health: `/health`
- Chat health: `/chat/health`
- XMLTV via proxy: `/iptv/xmltv.xml`
- HLS via proxy: `/iptv/session/1/hls.m3u8`
