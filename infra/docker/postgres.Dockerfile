# syntax=docker/dockerfile:1
# Init script baked in (not bind-mounted): works where Docker cannot read the project folder (e.g. snap Docker).
FROM postgres:16.11-bookworm
COPY --chmod=755 postgres-init.sh /docker-entrypoint-initdb.d/10-init.sh
