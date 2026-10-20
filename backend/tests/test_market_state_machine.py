from __future__ import annotations

import sys
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

# Make backend modules importable when tests run from repository root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import market_state_machine as msm


@dataclass
class FakeResult:
    data: Any


class FakeRpc:
    def __init__(self, supabase: FakeSupabase, fn_name: str, args: dict[str, Any]):
        self.supabase = supabase
        self.fn_name = fn_name
        self.args = args

    def execute(self):
        self.supabase.rpc_calls.append((self.fn_name, deepcopy(self.args)))

        if self.fn_name == "finalize_resolution":
            market = self.supabase.markets[self.args["p_market_id"]]
            market["status"] = "resolved"
            market["resolved_outcome"] = self.args["p_outcome"]

        if self.fn_name == "deny_market":
            market = self.supabase.markets[self.args["p_market_id"]]
            market["status"] = "denied"
            market["reviewed_by"] = self.args["p_admin_id"]
            market["review_notes"] = self.args["p_notes"]

        return FakeResult({})


class FakeQuery:
    def __init__(self, supabase: FakeSupabase, table_name: str):
        self.supabase = supabase
        self.table_name = table_name
        self._filters_eq: dict[str, Any] = {}
        self._filters_in: dict[str, list[Any]] = {}
        self._single = False
        self._update_payload: dict[str, Any] | None = None

    def select(self, _fields: str):
        return self

    def eq(self, field: str, value: Any):
        self._filters_eq[field] = value
        return self

    def in_(self, field: str, values: list[Any]):
        self._filters_in[field] = values
        return self

    def single(self):
        self._single = True
        return self

    def update(self, payload: dict[str, Any]):
        self._update_payload = payload
        return self

    def execute(self):
        rows = self.supabase._tables[self.table_name]()

        for field, value in self._filters_eq.items():
            rows = [row for row in rows if row.get(field) == value]
        for field, values in self._filters_in.items():
            rows = [row for row in rows if row.get(field) in values]

        if self._update_payload is not None:
            updated_rows = []
            for row in rows:
                target = self.supabase.markets[row["id"]]
                target.update(deepcopy(self._update_payload))
                updated_rows.append(deepcopy(target))
            rows = updated_rows

        if self._single:
            return FakeResult(deepcopy(rows[0]) if rows else None)
        return FakeResult(deepcopy(rows))


class FakeSupabase:
    def __init__(
        self,
        markets: list[dict[str, Any]],
        disputes: list[dict[str, Any]] | None = None,
        resolution_votes: list[dict[str, Any]] | None = None,
        community_votes: list[dict[str, Any]] | None = None,
    ):
        self.markets = {m["id"]: deepcopy(m) for m in markets}
        self.disputes = disputes or []
        self.resolution_votes = resolution_votes or []
        self.community_votes = community_votes or []
        self.rpc_calls: list[tuple[str, dict[str, Any]]] = []

        self._tables = {
            "markets": lambda: list(self.markets.values()),
            "disputes": lambda: self.disputes,
            "resolution_votes": lambda: self.resolution_votes,
            "community_votes": lambda: self.community_votes,
            "bets": list,
        }

    def table(self, name: str):
        if name not in self._tables:
            raise AssertionError(f"Unsupported table in test fake: {name}")
        return FakeQuery(self, name)

    def rpc(self, fn_name: str, args: dict[str, Any]):
        return FakeRpc(self, fn_name, args)


def _iso(value: datetime) -> str:
    return value.isoformat()


def test_apply_transition_rules_close_at_boundary():
    now = datetime.now(tz=UTC)
    market = {
        "status": "open",
        "close_at": _iso(now),
    }
    rules = msm.apply_transition_rules(market, now)
    assert [r.trigger for r in rules] == ["close_at_elapsed"]


def test_apply_transition_rules_pending_review_auto_deny_boundary():
    now = datetime.now(tz=UTC)
    market = {
        "status": "pending_review",
        "close_at": _iso(now),
    }
    rules = msm.apply_transition_rules(market, now)
    assert [r.trigger for r in rules] == ["pending_review_expired_auto_close"]


def test_creator_resolution_without_dispute_auto_finalizes(monkeypatch):
    async def _noop_notify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(msm, "notify_market_closed", _noop_notify)

    now = datetime.now(tz=UTC)
    supabase = FakeSupabase(
        markets=[
            {
                "id": "m1",
                "status": "pending_resolution",
                "proposed_outcome": "YES",
                "dispute_deadline": _iso(now - timedelta(minutes=1)),
            }
        ]
    )

    market = msm.normalize_market_state(supabase, "m1", now=now)

    assert market is not None
    assert market["status"] == "resolved"
    assert market["resolved_outcome"] == "YES"
    assert any(call[0] == "finalize_resolution" for call in supabase.rpc_calls)


def test_creator_resolution_with_dispute_auto_tallies_to_resolution(monkeypatch):
    async def _noop_notify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(msm, "notify_market_closed", _noop_notify)

    now = datetime.now(tz=UTC)
    supabase = FakeSupabase(
        markets=[
            {
                "id": "m2",
                "status": "disputed",
            }
        ],
        disputes=[
            {
                "id": "d1",
                "market_id": "m2",
                "voting_deadline": _iso(now - timedelta(minutes=1)),
            }
        ],
        resolution_votes=[
            {"dispute_id": "d1", "selected_outcome": "YES"},
            {"dispute_id": "d1", "selected_outcome": "YES"},
            {"dispute_id": "d1", "selected_outcome": "NO"},
            {"dispute_id": "d1", "selected_outcome": "YES"},
        ],
    )

    market = msm.normalize_market_state(supabase, "m2", now=now)

    assert market is not None
    assert market["status"] == "resolved"
    assert market["resolved_outcome"] == "YES"


def test_explicit_community_resolution_flow_tallies_after_window(monkeypatch):
    async def _noop_notify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(msm, "notify_market_closed", _noop_notify)

    now = datetime.now(tz=UTC)
    supabase = FakeSupabase(
        markets=[
            {
                "id": "m3",
                "status": "pending_resolution",
                "proposed_outcome": None,
                "resolution_window_end": _iso(now - timedelta(seconds=1)),
            }
        ],
        community_votes=[
            {"market_id": "m3", "selected_outcome": "NO"},
            {"market_id": "m3", "selected_outcome": "NO"},
            {"market_id": "m3", "selected_outcome": "YES"},
            {"market_id": "m3", "selected_outcome": "NO"},
        ],
    )

    market = msm.normalize_market_state(supabase, "m3", now=now)

    assert market is not None
    assert market["status"] == "resolved"
    assert market["resolved_outcome"] == "NO"
    assert any(call[0] == "distribute_voter_rewards" for call in supabase.rpc_calls)


def test_closed_open_race_path_is_normalized_before_action(monkeypatch):
    async def _noop_notify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(msm, "notify_market_closed", _noop_notify)

    now = datetime.now(tz=UTC)
    supabase = FakeSupabase(
        markets=[
            {
                "id": "m4",
                "status": "open",
                "close_at": _iso(now - timedelta(seconds=1)),
            }
        ]
    )

    market = msm.normalize_market_state(supabase, "m4", now=now)

    assert market is not None
    assert market["status"] == "closed"


def test_pending_review_market_is_auto_denied_after_close(monkeypatch):
    async def _noop_notify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(msm, "notify_market_closed", _noop_notify)
    monkeypatch.setattr(msm, "notify_market_denied", _noop_notify)

    now = datetime.now(tz=UTC)
    supabase = FakeSupabase(
        markets=[
            {
                "id": "m5",
                "status": "pending_review",
                "close_at": _iso(now - timedelta(seconds=1)),
                "review_notes": None,
            }
        ]
    )

    market = msm.normalize_market_state(supabase, "m5", now=now)

    assert market is not None
    assert market["status"] == "denied"
    assert market["review_notes"] == "Market expired before review. Sorry we could not review your market in time. For best results, propose markets at least 72 hours before close time."
