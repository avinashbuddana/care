#!/bin/sh
# Build and start everything: redis, migrations, admin seed, api, worker, web (admin panel), superset.
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Missing .env - copy .env.example to .env and fill it in." >&2; exit 1; }
if grep -qE 'CHANGE_ME|REPLACE_|your-db-host|replace-with' .env; then
  echo "Warning: .env still has placeholder values:" >&2
  grep -nE 'CHANGE_ME|REPLACE_|your-db-host|replace-with' .env | grep -v '^[0-9]*:#' >&2 || true
fi
docker compose up -d --build "$@"
docker compose ps
# Read ports without sourcing .env (URLs in it may contain & or ?).
env_val() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }
echo
echo "Admin panel: http://localhost:${WEB_PORT:-$(env_val WEB_PORT)}/admin"
echo "API docs:    http://localhost:${API_PORT:-$(env_val API_PORT)}/api/docs"
echo "Superset:    http://localhost:${SUPERSET_PORT:-$(env_val SUPERSET_PORT)}"
echo "Logs:        docker compose logs -f api worker web superset"
