from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import Settings, cors_options, get_settings

FRONTEND = "https://pheme.vercel.app"
PREVIEW_REGEX = r"https://pheme-[a-z0-9-]+-acme\.vercel\.app"


def _settings(**overrides) -> Settings:
    # Ignore any developer .env so the test sees only these values.
    return Settings(_env_file=None, cors_origins=[FRONTEND], **overrides)


def _client(settings: Settings) -> TestClient:
    app = FastAPI()
    app.add_middleware(CORSMiddleware, **cors_options(settings))

    @app.get("/ping")
    def ping():
        return {"ok": True}

    return TestClient(app)


def _preflight(client: TestClient, origin: str):
    return client.options(
        "/ping",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )


def test_listed_origin_is_allowed_with_credentials():
    response = _preflight(_client(_settings()), FRONTEND)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == FRONTEND
    assert response.headers["access-control-allow-credentials"] == "true"


def test_preview_origins_need_the_regex():
    preview = "https://pheme-git-feature-x-acme.vercel.app"

    assert _preflight(_client(_settings()), preview).status_code == 400
    response = _preflight(_client(_settings(cors_origin_regex=PREVIEW_REGEX)), preview)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == preview


@pytest.mark.parametrize(
    "origin",
    [
        "https://pheme-abc123-other.vercel.app",  # another team
        "http://pheme-abc123-acme.vercel.app",  # not https
        "https://pheme-abc123-acme.vercel.app.evil.com",  # suffix: regex must match whole origin
        "https://evil.com/?https://pheme-abc123-acme.vercel.app",
    ],
)
def test_regex_rejects_lookalike_origins(origin):
    client = _client(_settings(cors_origin_regex=PREVIEW_REGEX))
    response = _preflight(client, origin)

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_regex_is_read_from_environment(monkeypatch):
    monkeypatch.setenv("CORS_ORIGIN_REGEX", f"  {PREVIEW_REGEX}  ")
    assert Settings(_env_file=None).cors_origin_regex == PREVIEW_REGEX

    monkeypatch.setenv("CORS_ORIGIN_REGEX", "")
    assert Settings(_env_file=None).cors_origin_regex is None


def test_invalid_regex_fails_at_startup():
    with pytest.raises(ValidationError, match="CORS_ORIGIN_REGEX"):
        _settings(cors_origin_regex="https://pheme-(unclosed")


def test_app_uses_shared_cors_options():
    from main import app

    cors = [m for m in app.user_middleware if m.cls is CORSMiddleware]
    assert len(cors) == 1
    assert cors[0].kwargs == cors_options(get_settings())
