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
    payload["title"] = "T" * 161

    with pytest.raises(ValidationError):
        CreateMarketRequest(**payload)


def test_create_market_rejects_oversized_description():
    payload = _valid_create_payload()
    payload["description"] = "D" * 2001

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
