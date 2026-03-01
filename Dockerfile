FROM oven/bun:1 AS frontend-build
WORKDIR /app

COPY package.json bun.lock tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts eslint.config.js index.html ./
COPY src ./src

RUN bun install --frozen-lockfile
RUN bun run build

FROM node:20-slim AS chat-build
WORKDIR /app/chat

COPY chat/package.json ./

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm install \
  && apt-get purge -y --auto-remove python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY chat/ ./
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/chat.db

COPY --from=frontend-build /app/dist /app/dist
COPY --from=chat-build /app/chat /app/chat

EXPOSE 3001
CMD ["node", "/app/chat/dist/index.js"]
