from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

# Make backend modules importable when tests run from repository root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from schemas.market import CreateMarketRequest, ReviewMarketRequest


def _future_iso() -> datetime:
    return datetime.now(tz=UTC) + timedelta(days=3)


def _valid_create_payload() -> dict:
    return {
        "title": "Will CMU announce a new AI initiative by June 2026?",
        "description": "This market resolves based on official CMU announcements.",
        "close_at": _future_iso(),
        "resolution_criteria": "Resolved YES if an official CMU announcement confirms the initiative.",
        "category": "Academics",
        "official_source": "https://www.cmu.edu/news",
        "yes_criteria": "An official announcement explicitly confirms the initiative.",
        "no_criteria": "No official announcement by the close date.",
        "ambiguity_criteria": "If announcement language is unclear, admins review context and intent.",
        "link": "https://www.cmu.edu/news",
    }


def test_create_market_rejects_oversized_title():
    payload = _valid_create_payload()
    payload["title"] = "T" * 121

    with pytest.raises(ValidationError):
        CreateMarketRequest(**payload)


def test_create_market_rejects_oversized_description():
    payload = _valid_create_payload()
    payload["description"] = "D" * 801

    with pytest.raises(ValidationError):
        CreateMarketRequest(**payload)


def test_create_market_rejects_oversized_multichoice_option():
    payload = _valid_create_payload()
    payload["market_type"] = "multichoice"
    payload["multichoice_type"] = "exclusive"
    payload["options"] = ["A", "B" * 81]

    with pytest.raises(ValidationError):
        CreateMarketRequest(**payload)


def test_review_market_rejects_invalid_link_and_long_notes():
    with pytest.raises(ValidationError):
        ReviewMarketRequest(action="approve", link="javascript:alert(1)")

    with pytest.raises(ValidationError):
        ReviewMarketRequest(action="deny", notes="N" * 1001)


def test_create_market_rejects_oversized_resolution_criteria():
    payload = _valid_create_payload()
    payload["resolution_criteria"] = "R" * 801

    with pytest.raises(ValidationError):
        CreateMarketRequest(**payload)


def test_create_market_rejects_oversized_official_source():
    payload = _valid_create_payload()
    payload["official_source"] = "S" * 201

    with pytest.raises(ValidationError):
        CreateMarketRequest(**payload)


def test_create_market_rejects_oversized_optional_criteria():
    for field in ("yes_criteria", "no_criteria", "ambiguity_criteria"):
        payload = _valid_create_payload()
        payload[field] = "C" * 401

        with pytest.raises(ValidationError):
            CreateMarketRequest(**payload)


def test_create_market_rejects_oversized_link():
    payload = _valid_create_payload()
    payload["link"] = "https://example.com/" + "a" * 481

    with pytest.raises(ValidationError):
        CreateMarketRequest(**payload)


def test_create_market_accepts_limits_at_boundary():
    payload = _valid_create_payload()
    payload["title"] = "T" * 120
    payload["description"] = "D" * 800
    payload["resolution_criteria"] = "R" * 800
    payload["official_source"] = "S" * 200
    payload["yes_criteria"] = "C" * 400
    payload["link"] = "https://example.com/" + "a" * 480

    CreateMarketRequest(**payload)


def test_create_market_rejects_close_at_too_soon():
    payload = _valid_create_payload()
    payload["close_at"] = datetime.now(tz=UTC) + timedelta(minutes=30)

    with pytest.raises(ValidationError):
        CreateMarketRequest(**payload)


def test_create_market_rejects_close_at_too_far():
    payload = _valid_create_payload()
    payload["close_at"] = datetime.now(tz=UTC) + timedelta(days=200)

    with pytest.raises(ValidationError):
        CreateMarketRequest(**payload)


def test_create_market_accepts_close_at_at_lower_bound():
    payload = _valid_create_payload()
    payload["close_at"] = datetime.now(tz=UTC) + timedelta(hours=2)

    CreateMarketRequest(**payload)


def test_create_market_accepts_close_at_near_upper_bound():
    payload = _valid_create_payload()
    payload["close_at"] = datetime.now(tz=UTC) + timedelta(days=179)

    CreateMarketRequest(**payload)


def test_create_market_close_at_window_boundaries(monkeypatch):
    fixed_now = datetime(2026, 1, 1, tzinfo=UTC)

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now if tz is None else fixed_now.astimezone(tz)

    monkeypatch.setattr("schemas.market.datetime", FixedDatetime)

    for close_at in (fixed_now + timedelta(hours=1), fixed_now + timedelta(days=180)):
        payload = _valid_create_payload()
        payload["close_at"] = close_at
        CreateMarketRequest(**payload)

    for close_at in (
        fixed_now + timedelta(hours=1) - timedelta(seconds=1),
        fixed_now + timedelta(days=180) + timedelta(seconds=1),
    ):
        payload = _valid_create_payload()
        payload["close_at"] = close_at
        with pytest.raises(ValidationError):
            CreateMarketRequest(**payload)


def test_review_market_rejects_close_at_too_far():
    with pytest.raises(ValidationError):
        ReviewMarketRequest(
            action="approve", close_at=datetime.now(tz=UTC) + timedelta(days=200)
        )


def test_review_market_rejects_close_at_too_soon():
    with pytest.raises(ValidationError):
        ReviewMarketRequest(
            action="approve", close_at=datetime.now(tz=UTC) + timedelta(minutes=30)
        )


def test_review_market_accepts_close_at_in_window_or_omitted():
    ReviewMarketRequest(action="approve", close_at=datetime.now(tz=UTC) + timedelta(days=3))
    ReviewMarketRequest(action="approve")
