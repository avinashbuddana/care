#!/bin/sh
# Build and start everything: redis, migrations, admin seed, api, worker, web (admin panel), superset.
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  # First run: .env from the template, with random DB passwords and secret keys.
  rnd() { od -An -N24 -tx1 /dev/urandom | tr -d ' \n'; }
  sed -e "s/CHANGE_ME_app/$(rnd)/g" -e "s/CHANGE_ME_reporting/$(rnd)/g" -e "s/CHANGE_ME_superset/$(rnd)/g" \
      -e "s/^SECRET_ENCRYPTION_KEY=.*/SECRET_ENCRYPTION_KEY=$(rnd)$(rnd | cut -c1-16)/" \
      -e "s/^SUPERSET_SECRET_KEY=.*/SUPERSET_SECRET_KEY=$(rnd)/" .env.example > .env
  echo "Created .env from .env.example (random DB passwords and secrets)."
fi
placeholders=$(grep -nE 'CHANGE_ME|REPLACE_|your-db-host|replace-with' .env | grep -v '^[0-9]*:#' || true)
[ -z "$placeholders" ] || printf 'Warning: .env still has placeholder values:\n%s\n' "$placeholders" >&2
if ! docker compose up -d --build "$@"; then
  echo >&2
  echo "Startup failed. Logs of the services that failed:" >&2
  docker compose ps -a --format '{{.Service}}|{{.State}}|{{.ExitCode}}|{{.Health}}' |
    while IFS='|' read -r svc state code health; do
      if { [ "$state" = exited ] && [ "$code" != 0 ]; } || [ "$state" = restarting ] || [ "$health" = unhealthy ]; then
        echo "===== $svc: $state exit=$code $health =====" >&2
        docker compose logs --no-color --tail 40 "$svc" >&2
      fi
    done
  exit 1
fi
docker compose ps
# Read ports without sourcing .env (URLs in it may contain & or ?).
env_val() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }
echo
echo "Web app:     http://localhost:${WEB_PORT:-$(env_val WEB_PORT)}/   (log in; admin pages are under /admin/...)"
echo "API docs:    http://localhost:${API_PORT:-$(env_val API_PORT)}/api/docs"
echo "Superset:    http://localhost:${SUPERSET_PORT:-$(env_val SUPERSET_PORT)}"
echo "Logs:        docker compose logs -f api worker web superset"
