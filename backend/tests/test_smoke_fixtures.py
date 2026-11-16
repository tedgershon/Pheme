import pytest
from conftest import ROLE_IDS


@pytest.mark.parametrize("role", ["anon", "user", "admin", "super_admin"])
def test_role_fixture_hits_auth_me(as_role, role):
    response = as_role(role).get("/api/auth/me")
    if role == "anon":
        assert response.status_code == 401
    else:
        assert response.status_code == 200
        assert response.json()["id"] == ROLE_IDS[role]
        assert response.json()["role"] == role


def test_market_and_bet_factories_seed_overlay_rows(seed_market, seed_bet):
    market = seed_market(status="closed", creator_role="admin")
    bet = seed_bet(market, "user", "YES", amount=25)
    assert market["status"] == "closed"
    assert market["creator_id"] == ROLE_IDS["admin"]
    assert bet["market_id"] == market["id"]
    assert bet["user_id"] == ROLE_IDS["user"]
