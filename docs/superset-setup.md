# Separate Superset analytics

Set `SUPERSET_SECRET_KEY`, `SUPERSET_ADMIN_*`, `REPORTING_PASSWORD` and `SUPERSET_DB_PASSWORD` in `.env`, then run `docker compose --profile analytics up --build -d superset superset-register`. The roles are created by `infra/docker/postgres-init.sh` on the **first** initialisation of the postgres volume only. Superset has a dedicated `superset` metadata database, its own administrator credentials and separate authentication/authorization. Application roles do not carry over. The platform Analytics link opens Superset as a separate application.

Superset's metadata lives in its own `superset` database owned by a dedicated `superset_meta` role (`SUPERSET_DB_PASSWORD`), never the platform role. `superset-init` runs the supported `superset db upgrade`, `fab create-admin` and `superset init` commands. `superset-register` then calls the supported REST API (`infra/superset/bootstrap/register.py`). It never writes metadata tables directly, is idempotent by name, and:

- creates the **Reporting (read-only)** connection as `reporting_reader` with DML, CTAS/CVAS and file upload disabled, plus `statement_timeout=60s` and `default_transaction_read_only=on` connection options;
- registers only the views listed in `REPORTING_DATASETS` (default `synthetic_department_headcount,departments`);
- creates an unpublished **[SYNTHETIC] Example reporting dashboard** with a bar chart and a table over `reporting.synthetic_department_headcount`. Every row carries `data_origin = 'SYNTHETIC'`.

To register a later approved view, add it to `REPORTING_DATASETS` and run `docker compose --profile analytics run --rm superset-register`. Alternatively use the UI: **Data → Datasets → + Dataset**, choose database **Reporting (read-only)**, schema `reporting`, then the view. The manual connection URI, if you prefer the UI, is:

```
postgresql+psycopg2://reporting_reader:<REPORTING_PASSWORD>@postgres:5432/platform
```

Only approved reporting views are granted. Register them in **Data → Datasets**, select the `reporting` schema, then select the approved view. Leave DML, CTAS/CVAS, uploads, SQL Lab and unsafe functions unavailable to ordinary roles. Do not grant Alpha/Admin or database-wide permissions to ordinary analysts. File uploads are disabled in configuration; omit the upload permissions when assigning Gamma-based roles.

The synthetic view is created by repository migration `Reporting1760000002000`. Delete the synthetic charts and drop the view in a later migration once real reporting views exist. Until then, keep every demonstration chart labelled synthetic.

Reporting views explicitly select reviewed fields; no automatic `SELECT *` exposure. Migration `Reporting1760000002000` grants `reporting_reader` USAGE on `reporting` and SELECT on its views, including future views created by the migration role (default privileges), and revokes everything on `platform`, `app` and `staging`. Views run with their owner's privileges, so the reader never needs business-table access. The API integration test logs in as `reporting_reader` and asserts that reads of `app`/`platform` and INSERT/DELETE/CREATE all fail with _permission denied_. In production a DBA creates the `reporting_reader` LOGIN role (the migration only creates a NOLOGIN role if none exists) and must not add broader grants.

Data/chart caches default to 300 seconds in the supplied local config; dashboard refresh and cache expiry are different controls. A normal PostgreSQL view sees committed imports at query time. After a view signature changes, synchronize dataset columns in Superset and review charts. No materialized views are provisioned; if added, schedule `REFRESH MATERIALIZED VIEW` in a trusted job, not under the read-only role.

Compose is local infrastructure. Production requires HTTPS, external secret injection, independent metadata backups, shared Redis cache where replicas require it, proper workers for asynchronous features, supported image patching and organization-specific permissions.
