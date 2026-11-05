# syntax=docker/dockerfile:1
FROM node:22.22.0-bookworm-slim
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
COPY . .
# Cache mounts survive rebuilds: packages are downloaded once and Next reuses its compile cache,
# so a source change does not re-download dependencies or recompile the web app from scratch.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --package-import-method copy
ENV API_URL=http://api:3001
RUN --mount=type=cache,id=next-cache,target=/workspace/apps/web/.next/cache \
    pnpm build
ENV NODE_ENV=production
EXPOSE 3000 3001
CMD ["pnpm", "--filter", "@platform/api", "start"]
