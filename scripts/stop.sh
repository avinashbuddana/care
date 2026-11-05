#!/bin/sh
# Stop and remove the app containers. Postgres keeps running (and all volumes are kept).
# To stop Postgres as well: docker compose down
set -eu
cd "$(dirname "$0")/.."
docker compose rm --stop --force $(docker compose config --services | grep -vx postgres)
