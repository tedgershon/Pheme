"""Mounted-route inventory for AUTHZ_MATRIX section 7 and issue #12's sweep.

These checks verify dependency wiring and HTTP rejection, not SQL enforcement.
Creator/bettor/voter invariants remain covered by disposable database tests.
"""

from unittest.mock import Mock

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from dependencies import (
    get_current_user,
    get_current_user_optional,
    get_supabase_client,
    require_admin,
    require_super_admin,
)

# Explicit policy expectations: adding a mounted route requires a review here.
PUBLIC = {
    ("GET", path) for path in (
        "/api/markets", "/api/markets/hot", "/api/markets/trending", "/api/markets/top",
        "/api/markets/{market_id}", "/api/markets/{market_id}/dispute",
        "/api/markets/{market_id}/dispute/votes", "/api/markets/{market_id}/dispute/submissions",
        "/api/markets/{market_id}/bets",
        "/api/markets/resolutions", "/api/markets/{market_id}/community-votes",
        "/api/rewards/badges/{user_id}", "/api/leaderboard", "/api/leaderboard/weekly",
    )
}
AUTHENTICATED = {
    ("GET", "/api/auth/me"), ("POST", "/api/auth/profile"),
    ("PATCH", "/api/auth/profile"), ("POST", "/api/auth/claim-daily"),
    ("POST", "/api/markets"), ("POST", "/api/markets/{market_id}/resolve"),
    ("POST", "/api/markets/{market_id}/community-resolution"),
    ("POST", "/api/markets/{market_id}/dispute"),
    ("POST", "/api/markets/{market_id}/dispute/vote"),
    ("GET", "/api/markets/{market_id}/dispute/eligibility"),
    ("POST", "/api/markets/{market_id}/community-vote"),
    ("POST", "/api/markets/{market_id}/bets"),
    ("POST", "/api/markets/{market_id}/bets/option"),
    ("GET", "/api/notifications"), ("GET", "/api/notifications/unread-count"),
    ("POST", "/api/notifications/read"), ("POST", "/api/notifications/{notification_id}/read"),
    ("DELETE", "/api/notifications/{notification_id}"),
    ("GET", "/api/portfolio"), ("GET", "/api/transactions"),
    ("GET", "/api/portfolio/proposed-markets"),
    ("GET", "/api/rewards"), ("POST", "/api/rewards/check"),
}
ADMIN = {
    ("POST", "/api/admin/markets/resolution-reminders/run"),
    ("GET", "/api/admin/stats"), ("GET", "/api/admin/markets/review"),
    ("POST", "/api/admin/markets/{market_id}/backroll"),
    ("POST", "/api/admin/markets/{market_id}/review"),
    ("POST", "/api/admin/markets/{market_id}/resolve"),
    ("GET", "/api/admin/markets/admin-review"),
    ("GET", "/api/admin/markets/disputes"),
}
SUPER_ADMIN = {
    ("GET", "/api/admin/users/search"), ("PUT", "/api/admin/users/{user_id}/role"),
}
def test_all_mounted_routes_have_reviewed_auth_dependencies():
    import main

    expected = {
        **dict.fromkeys(PUBLIC, get_current_user_optional),
        **dict.fromkeys(AUTHENTICATED, get_current_user),
        **dict.fromkeys(ADMIN, require_admin),
        **dict.fromkeys(SUPER_ADMIN, require_super_admin),
        ("GET", "/"): None,
    }
    if main.get_settings().sentry_environment == "development":
        expected[("POST", "/api/__sentry-test")] = require_admin
    actual = {}
    guards = {get_current_user, get_current_user_optional, require_admin, require_super_admin}
    for route in main.app.routes:
        if not isinstance(route, APIRoute):
            continue  # Framework docs/schema routes are gated by environment.
        auth = [dep.call for dep in route.dependant.dependencies if dep.call in guards]
        assert len(auth) <= 1
        for method in route.methods:
            actual[(method, route.path)] = auth[0] if auth else None
    assert actual == expected


@pytest.mark.parametrize("method,path", sorted(AUTHENTICATED | ADMIN | SUPER_ADMIN))
def test_every_protected_route_rejects_anonymous_before_data_access(monkeypatch, method, path):
    import main

    database = Mock()
    monkeypatch.setattr(main.app, "dependency_overrides", {get_supabase_client: lambda: database})
    with TestClient(main.app) as client:
        response = client.request(method, path)
    assert response.status_code == 401
    assert response.json() == {"detail": {"code": "UNAUTHORIZED", "message": "Not authenticated."}}
    database.table.assert_not_called()
    database.rpc.assert_not_called()


@pytest.mark.parametrize("method,path", sorted(ADMIN | SUPER_ADMIN))
def test_admin_routes_reject_regular_user_before_data_access(monkeypatch, method, path):
    import main

    database = Mock()
    monkeypatch.setattr(main.app, "dependency_overrides", {
        get_supabase_client: lambda: database,
        get_current_user: lambda: {"id": "u1", "role": "user", "is_admin": False},
    })
    with TestClient(main.app) as client:
        response = client.request(method, path)
    assert response.status_code == 403
    expected = (
        {"code": "SUPER_ADMIN_REQUIRED", "message": "Super admin access required."}
        if (method, path) in SUPER_ADMIN else
        {"code": "ADMIN_REQUIRED", "message": "Admin access required."}
    )
    assert response.json() == {"detail": expected}
    database.table.assert_not_called()
    database.rpc.assert_not_called()
