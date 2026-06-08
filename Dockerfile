# syntax=docker/dockerfile:1.7

FROM oven/bun:1 AS frontend-build
WORKDIR /app

COPY package.json bun.lock tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts eslint.config.js index.html ./
COPY src ./src

RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1 AS server-build
WORKDIR /app/server

COPY server/package.json server/bun.lock ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
  apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && bun install --frozen-lockfile \
  && apt-get purge -y --auto-remove python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY server/ ./
RUN bun run build
RUN rm -rf node_modules && bun install --frozen-lockfile --production

FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/andromeda.db

COPY --from=frontend-build --chown=node:node /app/dist /app/dist
COPY --from=server-build --chown=node:node /app/server/dist /app/server/dist
COPY --from=server-build --chown=node:node /app/server/package.json /app/server/package.json
COPY --from=server-build --chown=node:node /app/server/node_modules /app/server/node_modules

# Live HLS transcoding uses jellyfin-ffmpeg7, which bundles a current ffmpeg (7.x)
# together with a matched Intel media stack (iHD driver 25.x + oneVPL). Debian's
# own ffmpeg 5.1 + intel-media-va-driver 23.1 segfault on VAAPI surface allocation
# with Arc (DG2) GPUs, so we deliberately avoid the distro packages here.
# LIBVA_DRIVERS_PATH points libva at the bundled iHD driver; the app spawns bare
# "ffmpeg"/"ffprobe", so both are symlinked onto PATH.
ENV LIBVA_DRIVERS_PATH=/usr/lib/jellyfin-ffmpeg/lib/dri \
    LIBVA_DRIVER_NAME=iHD
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl gnupg ca-certificates \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key \
       | gpg --dearmor -o /etc/apt/keyrings/jellyfin.gpg \
  && printf 'Types: deb\nURIs: https://repo.jellyfin.org/debian\nSuites: bookworm\nComponents: main\nSigned-By: /etc/apt/keyrings/jellyfin.gpg\n' \
       > /etc/apt/sources.list.d/jellyfin.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends jellyfin-ffmpeg7 \
  && ln -sf /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/bin/ffmpeg \
  && ln -sf /usr/lib/jellyfin-ffmpeg/ffprobe /usr/bin/ffprobe \
  && apt-get purge -y --auto-remove curl gnupg \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /data && chown -R node:node /data

USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "/app/server/dist/index.js"]
