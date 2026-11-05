# syntax=docker/dockerfile:1
FROM apache/superset:5.0.0
USER root
RUN . /app/.venv/bin/activate && uv pip install psycopg2-binary==2.9.10
# Explicit modes: the container runs as "superset", so files must be readable whatever
# permissions they had on the host (e.g. after unzipping).
COPY --chmod=644 superset_config.py /app/pythonpath/superset_config.py
COPY --chmod=755 bootstrap /app/bootstrap
USER superset
