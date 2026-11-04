# Local development

Use Node 22.12+ and `corepack enable`. The pinned package manager is pnpm 10.28.2. The workspace uses Next 16 with React 19, Nest 11, TypeORM 0.3, PostgreSQL 16 and Redis 7.4 in Compose. Exact dependency resolution is committed in `pnpm-lock.yaml`.

Copy `.env.example` to `.env`, set passwords and the 64-hex encryption key. Start only infrastructure with `docker compose up -d postgres redis`. Install dependencies and build shared packages:

```sh
pnpm install --frozen-lockfile
pnpm --filter @platform/contracts build
pnpm --filter @platform/ingestion build
pnpm migration:run
pnpm --filter @platform/api seed
pnpm dev
```

Export the root `.env` values into the process environment before using package commands; package working directories differ. Prefer absolute `STORAGE_ROOT` for host processes. `DATABASE_URL` points at localhost for host processes; Compose overrides it to postgres. The seed command requires `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the environment. Use a long unique password.

Web runs on 3000 and proxies `/api` to `API_URL` (default API localhost:3001). API exposes Swagger at `/api/docs`. Worker is independently runnable with `pnpm --filter @platform/worker dev`.

Compose runs compiled API/worker with development environment validation to support local HTTP cookies; this is explicitly a local setup. Production uses `NODE_ENV=production`, `COOKIE_SECURE=true`, HTTPS and an actual release orchestrator.

Tests need an isolated PostgreSQL 16 database (never operational data) and Redis:

```sh
TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/platform_test \
TEST_REDIS_URL=redis://127.0.0.1:6379 pnpm test     # unit, integration, release gate
WEB_URL=http://127.0.0.1:3000 TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... pnpm test:e2e
```

The API test suite builds `apps/api` first (`pretest`), because it executes the compiled migration command. The migration test creates and drops its own `migration_probe_<pid>` database, so the test role needs CREATEDB.

Create operator and viewer accounts and grant dataset access in **Settings → Users & access**. Admins see every dataset; other users see only granted ones.

Docker initialization scripts run only on a fresh database volume. Changing passwords in `.env` does not change roles in an existing volume. Apply credential rotations explicitly. Do not remove volumes to fix an operational migration error.
