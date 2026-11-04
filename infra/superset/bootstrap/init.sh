#!/bin/sh
set -eu
superset db upgrade
# Use a separate local administrator. Supply credentials through .env.
if ! superset fab list-users | grep -F "username:${SUPERSET_ADMIN_USERNAME}" >/dev/null; then
  superset fab create-admin --username "$SUPERSET_ADMIN_USERNAME" --firstname Local --lastname Admin --email "$SUPERSET_ADMIN_EMAIL" --password "$SUPERSET_ADMIN_PASSWORD"
fi
superset init
