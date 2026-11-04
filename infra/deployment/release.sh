#!/bin/sh
# Release gate. Run from the repository root, ONCE per deployment (never per API replica):
#   build -> run pending migrations (compiled JS) -> verify none pending -> caller rolls out.
# Overlapping invocations are serialised by a PostgreSQL advisory lock inside migrate.js.
# Any failure exits non-zero, so the caller must not roll out the new version.
set -eu
: "${DATABASE_URL:?set DATABASE_URL}"
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @platform/api migration:run:prod
if ! pnpm --silent --filter @platform/api migration:show:prod | grep -q '"pending":false'; then
  printf '%s\n' 'Migrations still pending after run; blocking rollout.' >&2
  exit 1
fi
printf '%s\n' 'Migrations succeeded. Release artifact is ready for rollout.'
