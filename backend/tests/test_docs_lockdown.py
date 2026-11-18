"""/docs, /redoc and /openapi.json exist in development and 404 in production.

`main` reads SENTRY_ENVIRONMENT once at import, so each mode runs in a fresh
interpreter. Both environments get an empty SENTRY_DSN and fake Supabase settings,
so nothing contacts Sentry or a database.
"""

import functools
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
PROBE = """
import json
from fastapi.testclient import TestClient
import main
with TestClient(main.app) as client:
    print(json.dumps({
        path: client.get(path).status_code
        for path in ("/docs", "/redoc", "/openapi.json", "/")
    } | {"sentry_test_mounted": any(r.path == "/api/__sentry-test" for r in main.app.routes)}))
"""


@functools.cache
def _probe(environment: str) -> dict:
    env = {
        **os.environ,
        "SENTRY_ENVIRONMENT": environment,
        "SENTRY_DSN": "",
        "SUPABASE_URL": "https://example.invalid",
        "SUPABASE_KEY": "unused",
        "SUPABASE_SERVICE_ROLE_KEY": "",
    }
    done = subprocess.run(
        [sys.executable, "-c", PROBE], check=False, cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120,
    )
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_documentation_routes_are_404_in_production(path):
    result = _probe("production")
    assert result[path] == 404
    assert result["/"] == 200, "the health check must stay up in production"
    assert result["sentry_test_mounted"] is False


def test_documentation_routes_exist_in_development():
    result = _probe("development")
    assert [result[p] for p in ("/docs", "/redoc", "/openapi.json")] == [200, 200, 200]
    assert result["sentry_test_mounted"] is True
