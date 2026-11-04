#!/bin/sh
# Stop and remove containers. Uploads and redis volumes are kept; your external Postgres is untouched.
set -eu
cd "$(dirname "$0")/.."
docker compose down "$@"
