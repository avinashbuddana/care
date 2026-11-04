FROM node:22.22.0-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
ENV API_URL=http://api:3001
RUN pnpm build
ENV NODE_ENV=production
EXPOSE 3000 3001
CMD ["pnpm", "--filter", "@platform/api", "start"]
