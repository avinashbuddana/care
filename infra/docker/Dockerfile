# syntax=docker/dockerfile:1
FROM node:22.22.0-bookworm-slim
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
# Manifests first: the slow install layer is reused until a dependency changes, not on every code change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ingestion/package.json packages/ingestion/
# The cache mount keeps downloaded packages between builds.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --package-import-method copy
COPY . .
# Next reuses its compile cache, so a code change does not recompile the web app from scratch.
ENV API_URL=http://api:3001
RUN --mount=type=cache,id=next-cache,target=/workspace/apps/web/.next/cache \
    pnpm build
ENV NODE_ENV=production
EXPOSE 3000 3001
CMD ["pnpm", "--filter", "@platform/api", "start"]
