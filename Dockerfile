# syntax=docker/dockerfile:1.7

FROM oven/bun:1 AS frontend-build
WORKDIR /app

COPY package.json bun.lock tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts eslint.config.js index.html ./
COPY src ./src

RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile
RUN bun run build

FROM node:20-slim AS server-build
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
  apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci \
  && apt-get purge -y --auto-remove python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY server/ ./
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/andromeda.db

COPY --from=frontend-build --chown=node:node /app/dist /app/dist
COPY --from=server-build --chown=node:node /app/server/dist /app/server/dist
COPY --from=server-build --chown=node:node /app/server/package.json /app/server/package.json
COPY --from=server-build --chown=node:node /app/server/node_modules /app/server/node_modules

RUN mkdir -p /data && chown -R node:node /data

USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "/app/server/dist/index.js"]
