# Build and release

Production release order is **build → run pending migrations once → verify success → roll out applications**. Run `infra/deployment/release.sh` from the repository root using a migration credential supplied by the release orchestrator. The script fails on installation, compilation or migration errors. It then runs `migration:show:prod` and fails unless it reports `{"pending":false}`. Only after that does it print its rollout gate. `scripts/verification/release-gate.test.sh` proves all three cases: a failed run blocks, remaining pending migrations block, and success opens the gate. The orchestrator must deploy the same built artifact only after exit 0; it must not run rollout in an unconditional finally/cleanup stage.

Commands and actual paths:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @platform/api migration:show
pnpm --filter @platform/api migration:run
pnpm --filter @platform/api migration:run:prod
pnpm --filter @platform/api migration:show:prod   # must print {"pending":false}
```

Local commands use `tsx src/database/migrate.ts`; production executes `node dist/database/migrate.js` within `apps/api`. DataSource is `apps/api/src/database/data-source.ts`, compiled to `apps/api/dist/database/data-source.js`. Migrations are explicitly registered. TypeORM's history ensures repeated runs apply only pending migrations. A PostgreSQL advisory lock prevents overlapping migration runners. `apps/api/test/migrations.spec.ts` starts two compiled runners concurrently against a fresh database and asserts each migration is applied exactly once and a third run applies nothing. Run a dedicated migration job once per release, never in every API replica.

Create a migration with `pnpm --filter @platform/api migration:create src/database/migrations/MeaningfulName`. Generate from registered entity differences with `pnpm --filter @platform/api migration:generate src/database/migrations/MeaningfulName`; manually review generated DDL and register it. The platform entities mirror the migrations exactly, including constraint and index names. Generation therefore reports only genuinely new entities, and an integration test fails if the entities and migrations drift apart. Revert with `pnpm migration:revert` only after explicit operator review. Never automatically revert destructive changes, or edit an already deployed migration to introduce a new change. Synchronization stays false.

Keep rollout changes backward compatible while old instances run. Expand/contract destructive schema changes across releases. If migration fails, hold the current release and investigate; do not roll out code assuming unapplied columns exist.

Set production `NODE_ENV=production`, `COOKIE_SECURE=true`, HTTPS origin and external secrets. Scope credentials: the developer migration job owns DDL; normal API/worker roles should receive only required platform DML/business DML/catalog privileges. The AI has neither credentials nor DDL tools. The supplied Compose platform owner is a local convenience, not a production role policy.

Bound pools across replicas: API `DB_POOL_MAX`, worker pool/concurrency, dedicated migration connection and Superset metadata/reporting pools must fit the database connection budget. Set ingress upload/time limits, database statement/lock timeouts and persistent storage capacity. Use durable shared upload storage across API/worker hosts.

Compose's `migrate` service gates API/worker startup. Re-run it explicitly on every local release; `docker compose up` alone can retain a previously successful one-shot container. Example: `docker compose run --rm migrate` followed only on success by `docker compose up -d api worker web`. Production should use its orchestrator's one-shot job and rollout gate.
