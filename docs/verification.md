# Verification record

What was actually executed on 30 October 2026, on an Apple M4 laptop with Node 24.22.1, PostgreSQL 16.13 (isolated local test cluster) and Redis 8.0. Re-run these after every change; this file is a record, not a guarantee.

## Automated checks (all passed)

| Command                                                    | Result                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm typecheck`                                           | 5 workspaces, strict TypeScript, no errors                                |
| `pnpm lint`                                                | ESLint type-aware rules, including test files, no errors                  |
| `pnpm build`                                               | API, worker, shared packages and the Next.js production build (15 routes) |
| `pnpm --filter @platform/contracts test`                   | 8 passed                                                                  |
| `pnpm --filter @platform/ingestion test` (real PostgreSQL) | 13 passed                                                                 |
| `pnpm --filter @platform/api test` (real PostgreSQL)       | 12 passed                                                                 |
| `sh scripts/verification/release-gate.test.sh`             | passed (3 scenarios)                                                      |
| `pnpm test:e2e` (Playwright, Chromium, seeded admin)       | 5 passed                                                                  |
| `docker compose --profile analytics config`                | valid (9 services)                                                        |

## Requirement → evidence

| Requirement                                                                   | Test                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import fails without a deployed compatible schema                             | ingestion `schema availability blocks execution…`; API `approval and handoff create no table…` (POST /imports → 400)                                              |
| Approval alone creates no table and does not enable import                    | API `approval and handoff create no table…` (`to_regclass` is null after approval and after handoff)                                                              |
| Handoff artifacts use configured paths and valid templates                    | `templates.spec.ts` (paths; every TS file transpiles); API test compiles and runs the generated migration `up`/`down` and checks the catalog against the contract |
| Entity registration and compiled migrations work                              | API test: schema builder reports zero pending DDL (entities mirror migrations); `migrations.spec.ts` runs `node dist/database/migrate.js`                         |
| Repeated or overlapping deployment runs do not reapply migrations             | `migrations.spec.ts`: two concurrent compiled runners apply each migration once; a third run applies nothing; `show` → `{"pending":false}`                        |
| Migration failure blocks rollout                                              | `release-gate.test.sh`: failed run blocks, pending migrations block, success opens the gate                                                                       |
| Re-imports preserve id/created_at; updated_at changes only on business change | ingestion `changed and unchanged reimports…` and `source timestamp-only updates…`; API generated-trigger assertions                                               |
| Duplicate and invalid references produce accurate row errors                  | ingestion `duplicate keys, invalid decimals, missing references…` (rows 2–5)                                                                                      |
| Strict validation failures leave targets unchanged                            | same test: target rows identical before and after                                                                                                                 |
| Worker retries do not duplicate committed imports                             | ingestion `concurrent redelivery of one job…` plus re-running a completed job                                                                                     |
| Bedrock failures still allow manual proposals                                 | API Bedrock test (malformed JSON, wrong table, throttling, access denied → 400; manual proposal → 201)                                                            |
| Only masked metadata is sent to Bedrock                                       | API Bedrock test inspects the actual Converse request body                                                                                                        |
| Secrets absent from responses, logs, audit and artifacts                      | API `never returns, audits, logs or generates saved credentials` (captures stdout/stderr)                                                                         |
| Superset credentials cannot modify application tables                         | API test logs in as `reporting_reader`; app/platform reads and INSERT/DELETE/CREATE are denied                                                                    |
| Value-based relationship analysis and mismatch detection                      | API `verifies the deployed Departments dataset…`; ingestion `schema mismatch detection…`                                                                          |

The Bedrock tests use the real AWS SDK against a local HTTP/2 stand-in reached via `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`. No real AWS account was called.

## Manual end-to-end run

The compiled API and worker were started against a fresh migrated database with a separate Redis database index. Over HTTP the following was driven:

1. Log in.
2. Check Schema Availability for Departments (`ready: true`).
3. Upload a CSV.
4. Create an import: validation was queued through BullMQ, and the worker reported `validated`, 2 valid.
5. Start publication: the worker reported `completed`, 2 inserted.
6. Read the paginated records (2 rows).

This run found and fixed a bug: the API ignored the Redis database index and username in `REDIS_URL`, while the worker honoured them. Both now share `redisConnection()`.

Benchmark results are in [performance.md](performance.md).

## Not verified here

- **Docker images and Compose runtime.** The Docker daemon was not running, so the images (including `apache/superset:5.0.0` with `psycopg2-binary`) were not built, and `superset-init`/`superset-register` were not executed against a live Superset. `register.py` is syntax-checked only; chart `params` may need adjustment for your Superset version.
- **Real Amazon Bedrock.** No AWS account or inference profile was used.
- **Production deployment.** `release.sh` is exercised with a mocked `pnpm`; your orchestrator integration still needs a dry run.
