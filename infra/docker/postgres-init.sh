#!/bin/sh
# Runs once, on first initialisation of the postgres volume (local Compose only).
# Grants for reporting_reader are applied by the repository migration Reporting1760000002000.
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
 -v report_password="$REPORTING_PASSWORD" -v superset_password="$SUPERSET_DB_PASSWORD" <<'SQL'
CREATE ROLE reporting_reader LOGIN PASSWORD :'report_password';
CREATE ROLE superset_meta LOGIN PASSWORD :'superset_password';
CREATE DATABASE superset OWNER superset_meta;
REVOKE CONNECT ON DATABASE superset FROM PUBLIC;
SQL
