FROM node:22-slim AS base
RUN corepack enable pnpm

# ── Dependencies ──
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/donkeygo/package.json packages/donkeygo/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile || pnpm install

# ── Build library ──
FROM deps AS build-lib
WORKDIR /app
COPY packages/donkeygo/ packages/donkeygo/
RUN pnpm --filter donkeygo build

# ── Build SvelteKit app ──
FROM deps AS build-app
WORKDIR /app
COPY --from=build-lib /app/packages/donkeygo/dist packages/donkeygo/dist
COPY apps/web/ apps/web/
RUN pnpm --filter @donkeygo/web build

# ── Production ──
FROM node:22-slim AS production
RUN corepack enable pnpm
WORKDIR /app

COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/donkeygo/node_modules packages/donkeygo/node_modules
COPY --from=build-lib /app/packages/donkeygo/dist packages/donkeygo/dist
COPY --from=build-lib /app/packages/donkeygo/package.json packages/donkeygo/package.json
COPY --from=build-app /app/apps/web/build apps/web/build
COPY --from=build-app /app/apps/web/package.json apps/web/package.json

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Graceful shutdown
STOPSIGNAL SIGTERM

CMD ["node", "apps/web/build/index.js"]
