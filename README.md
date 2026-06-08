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
- `/iptv/*` -> HLS/IPTV compatibility route backed by internal playout (default) or the legacy ErsatzTV proxy

### Local frontend scripts

- `bun run dev`
- `bun run build`
- `bun run preview`
- `bun run lint`
- `bun run test:client`
- `bun run test:e2e`

### Local backend scripts

- `bun run --cwd server dev`
- `bun run --cwd server build`
- `bun run --cwd server test`

For browser smoke tests, install Chromium once locally with:

```bash
bunx playwright install chromium
```

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
PLAYOUT_MODE=internal # Optional - "internal" (default, self-hosted playout) or "ersatztv" (legacy proxy)

ANDROMEDA_SERIES_ROOT=/nas/media/andromeda/series # Series root scanned for Episode Assets

ANDROMEDA_BUMPS_ROOT=/nas/media/andromeda/bumps # Bumps root scanned for filename-sorted Bump Assets

ANDROMEDA_SERIES_ALLOWLIST= # Optional comma-separated Series Allowlist; leave empty for full-library production

INTERNAL_HLS_OUTPUT_ROOT=/data/hls # Optional HLS playlist/segment output root for internal playout

TRANSCODE_ACCEL=disabled # Optional - "disabled" (default), "preferred", or "required"

TRANSCODE_ACCEL_DEVICE=/dev/dri/renderD128 # Intel render device used when TRANSCODE_ACCEL is preferred or required

ERSATZTV_BASE_URL= # Required only when PLAYOUT_MODE=ersatztv (legacy proxy mode)

INITIAL_ADMIN_NICKNAME=andromedatv # Required - bootstraps the first admin if none exists

INITIAL_ADMIN_PASSWORD=replace_me # Required - must be set together with INITIAL_ADMIN_NICKNAME

CORS_ORIGIN=https://yourdomain.com # Optional - default is "*"

PUBLIC_APP_ORIGIN=https://yourdomain.com # Recommended behind a reverse proxy and for IPTV playlist rewriting

STATUS_API_MODE=admin # Optional - "admin" (default), "public", or "disabled"

TRUST_PROXY=true # Optional - only set when running behind a trusted reverse proxy

JWT_SECRET=replace_me # Optional - if omitted, the app will generate and persist one under /data

DB_PATH=/data/andromeda.db # Optional - default database path

```

AndromedaTV defaults to internal playout mode and has no external runtime dependency on ErsatzTV or Jellyfin. Internal mode owns the schedule, transcode, and Live HLS output directly from the local media Library. The legacy ErsatzTV proxy is opt-in via `PLAYOUT_MODE=ersatztv` (which then requires `ERSATZTV_BASE_URL`); Jellyfin is only read by the one-time offline metadata seed below, never at runtime.

The admin bootstrap only runs when there are no admin users in the database. After the first admin exists, those variables are ignored unless you reset the chat DB.

Set `PLAYOUT_MODE=internal` to serve `/api/schedule` from the internal schedule preview and `/iptv/session/1/hls.m3u8` from AndromedaTV-owned Live HLS output. In internal mode, AndromedaTV scans the full Andromeda Library under `ANDROMEDA_SERIES_ROOT` for Episode Assets that resolve to a trusted Chronological Episode Order (via the AniDB Metadata Cache or Sidecar Overrides), scans `ANDROMEDA_BUMPS_ROOT` for filename-sorted Bump Assets, persists discovered media facts and Channel State in SQLite, and starts ffmpeg HLS output for the current Media Asset under `INTERNAL_HLS_OUTPUT_ROOT`. Each scan reconciles Channel State with the Library: newly Schedulable Series are appended after the current Rotation Cycle, removed or unschedulable Series are dropped from the rotation, and existing Episode Cursors are preserved unless their media is gone. `ANDROMEDA_SERIES_ALLOWLIST` is an optional override that limits the scan to named Series; leave it empty for normal full-library production. Internal mode does not require `ERSATZTV_BASE_URL` — that variable is only used by the legacy ErsatzTV proxy mode. `/api/status` reports scanner state, unresolved Episode Assets, excluded Series, current Channel State, and Playout Engine/ffmpeg health.

#### One-time Jellyfin metadata seed

Before the first internal production run, operators may seed AndromedaTV's AniDB Metadata Cache from the existing Jellyfin database at `/docker/data/jellyfin/config/data/jellyfin.db`. This is an offline maintenance command; normal app startup, schedule scans, and live playout never invoke Jellyfin.

From a development checkout:

```bash
bun run --cwd server seed:jellyfin-metadata -- --jellyfin-db /docker/data/jellyfin/config/data/jellyfin.db --db /data/andromeda.db
```

From a built container or image, run the compiled command with both the AndromedaTV data volume and the Jellyfin config directory mounted:

```bash
node /app/server/dist/scripts/seed-anidb-from-jellyfin.js --jellyfin-db /docker/data/jellyfin/config/data/jellyfin.db --db /data/andromeda.db
```

The command reads Jellyfin `BaseItems` and `BaseItemProviders` rows with AniDB provider IDs, upserts them into `anidb_series` and `anidb_episodes`, and marks the cache rows successful. If the Jellyfin database path is missing or unreadable, the command exits non-zero and leaves normal AndromedaTV startup unchanged. After a successful seed, AndromedaTV can run with only its SQLite database and media Library mounted.

`TRANSCODE_ACCEL` controls the Live HLS transcode path:

- `disabled`: CPU-only `libx264` output. This is the default for development and automated tests.
- `preferred`: try Intel VAAPI hardware encoding first when `TRANSCODE_ACCEL_DEVICE` is available, then fall back to CPU if ffmpeg cannot produce the HLS playlist.
- `required`: require Intel VAAPI hardware encoding and fail startup in internal playout mode when `TRANSCODE_ACCEL_DEVICE` is unavailable. This is the intended production setting once the host is validated.

The container includes ffmpeg, VAAPI runtime libraries, `intel-media-va-driver`, and `vainfo`. On an Intel Arc A310 host, mount the render device and give the container user access to the render/video groups:

```yaml
services:
  andromedatv:
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - "render"
      - "video"
```

Host validation is still required for Intel Arc A310 production use. Before setting `TRANSCODE_ACCEL=required`, confirm the host exposes `/dev/dri/renderD128`, the container user can read/write it, and `vainfo --display drm --device /dev/dri/renderD128` reports the Intel media driver. `/api/status` reports `internalPlayout.transcodeAccelerationMode`, `hardwareAccelerationAvailable`, `hardwareAccelerationActive`, and `hardwareDevicePath`.

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
    user: "1000:1000" # must own the /data bind mount
    ports:
      - "3834:3001"
    env_file:
      - .env
    # Internal playout needs read access to the media library. Hardware transcoding
    # (TRANSCODE_ACCEL=preferred|required) also needs the Intel render device — drop
    # the devices/group_add block if you run TRANSCODE_ACCEL=disabled.
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - "27" # host group that owns /dev/dri/renderD128 (check with: getent group render)
    volumes:
      - ./data:/data
      - /nas/media/andromeda:/nas/media/andromeda:ro
```

The container runs as UID 1000, so the host `./data` directory must be owned by `1000:1000` (`sudo chown -R 1000:1000 ./data`). The media bind mount is read-only.

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
- HLS compatibility route: `/iptv/session/1/hls.m3u8`
