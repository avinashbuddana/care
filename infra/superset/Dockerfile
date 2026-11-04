FROM apache/superset:5.0.0
USER root
RUN . /app/.venv/bin/activate && uv pip install psycopg2-binary==2.9.10
COPY superset_config.py /app/pythonpath/superset_config.py
COPY bootstrap /app/bootstrap
USER superset
