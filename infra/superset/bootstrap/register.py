"""Registers the read-only reporting connection, approved datasets and SYNTHETIC example charts.

Uses only the supported Superset REST API (never the metadata tables). Idempotent: objects are
looked up by name and created only when missing. Credentials come from the environment and are
never printed.
"""
import json
import os
import sys
import time

import requests

BASE = os.environ.get("SUPERSET_INTERNAL_URL", "http://superset:8088").rstrip("/")
DATABASE_NAME = "Reporting (read-only)"
# Only explicitly approved reporting views are registered; never every column or table.
DATASETS = [v for v in os.environ.get(
    "REPORTING_DATASETS", "synthetic_department_headcount,departments").split(",") if v]
SYNTHETIC_DASHBOARD = "[SYNTHETIC] Example reporting dashboard"


def wait_for_superset(session: requests.Session) -> None:
    for _ in range(60):
        try:
            if session.get(f"{BASE}/health", timeout=5).ok:
                return
        except requests.RequestException:
            pass
        time.sleep(5)
    sys.exit("Superset did not become healthy")


def login(session: requests.Session) -> None:
    token = session.post(f"{BASE}/api/v1/security/login", timeout=30, json={
        "username": os.environ["SUPERSET_ADMIN_USERNAME"],
        "password": os.environ["SUPERSET_ADMIN_PASSWORD"],
        "provider": "db",
        "refresh": True,
    })
    token.raise_for_status()
    session.headers["Authorization"] = f"Bearer {token.json()['access_token']}"
    csrf = session.get(f"{BASE}/api/v1/security/csrf_token/", timeout=30)
    csrf.raise_for_status()
    session.headers.update({"X-CSRFToken": csrf.json()["result"], "Referer": BASE})


def find(session: requests.Session, resource: str, column: str, value: str) -> int | None:
    query = f"(filters:!((col:{column},opr:eq,value:'{value}')))"
    response = session.get(f"{BASE}/api/v1/{resource}/", params={"q": query}, timeout=30)
    response.raise_for_status()
    result = response.json()["result"]
    return result[0]["id"] if result else None


def create(session: requests.Session, resource: str, body: dict) -> int:
    response = session.post(f"{BASE}/api/v1/{resource}/", json=body, timeout=60)
    if not response.ok:
        sys.exit(f"Creating {resource} failed with HTTP {response.status_code}")
    return response.json()["id"]


def main() -> None:
    session = requests.Session()
    wait_for_superset(session)
    login(session)

    database = find(session, "database", "database_name", DATABASE_NAME) or create(session, "database", {
        "database_name": DATABASE_NAME,
        "sqlalchemy_uri": os.environ["REPORTING_DATABASE_URI"],
        "expose_in_sqllab": True,
        "allow_dml": False,
        "allow_ctas": False,
        "allow_cvas": False,
        "allow_file_upload": False,
        "extra": json.dumps({
            # Defence in depth on top of the reporting_reader grants.
            "engine_params": {"connect_args": {
                "options": "-c statement_timeout=60000 -c default_transaction_read_only=on"}},
            "schemas_allowed_for_file_upload": [],
        }),
    })

    dataset_ids = {}
    for view in DATASETS:
        existing = find(session, "dataset", "table_name", view)
        dataset_ids[view] = existing or create(session, "dataset", {
            "database": database, "schema": "reporting", "table_name": view})

    synthetic = dataset_ids.get("synthetic_department_headcount")
    if synthetic:
        dashboard = find(session, "dashboard", "dashboard_title", SYNTHETIC_DASHBOARD) or create(
            session, "dashboard", {"dashboard_title": SYNTHETIC_DASHBOARD, "published": False})
        charts = {
            "[SYNTHETIC] Headcount by department": {
                "viz_type": "echarts_timeseries_bar",
                "x_axis": "department_name",
                "metrics": [{"expressionType": "SIMPLE", "column": {"column_name": "headcount"},
                             "aggregate": "SUM", "label": "Headcount"}],
                "groupby": [],
                "row_limit": 100,
            },
            "[SYNTHETIC] Department table": {
                "viz_type": "table",
                "query_mode": "raw",
                "all_columns": ["department_code", "department_name", "headcount", "data_origin"],
                "row_limit": 100,
            },
        }
        for name, params in charts.items():
            if find(session, "chart", "slice_name", name):
                continue
            create(session, "chart", {
                "slice_name": name,
                "viz_type": params["viz_type"],
                "datasource_id": synthetic,
                "datasource_type": "table",
                "params": json.dumps({**params, "datasource": f"{synthetic}__table"}),
                "description": "SYNTHETIC example data. Not business data.",
                "dashboards": [dashboard],
            })
    print(json.dumps({"event": "superset_registered", "database": DATABASE_NAME, "datasets": sorted(dataset_ids)}))


if __name__ == "__main__":
    main()
