"""Hand-translated AUTHZ_MATRIX section 7 (docs/AUTHZ_MATRIX.md) as test cells.

One ``MatrixCell`` per (method, path template, role, context) with a documented
outcome. The tables are written by hand on purpose: the reviewable diff is the
point, and test_route_coverage.py is the guard that keeps this list in step with
the mounted routes. The matrix is the spec: when a cell fails, fix the code, not
the cell, unless the matrix itself is being corrected (say so in the PR).

Overlays are expressed through ``setup``. ``creator="self"`` makes the acting
role the market creator (``creator(M)``); ``creator="other"`` makes someone else
the creator. Setups return the path parameters, and ``check`` receives the
response plus that context for body assertions (ownership filtering, tallies).
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from conftest import ROLE_IDS

FAR = "2099-01-01T00:00:00+00:00"
ALL_ROLES = ("anon", "user", "admin", "super_admin")
MEMBERS = ("user", "admin", "super_admin")
UNKNOWN_ID = "00000000-0000-0000-0000-00000000dead"

Setup = Callable[["World"], dict[str, Any]]
Check = Callable[[Any, dict[str, Any]], None]


@dataclass(frozen=True)
class MatrixCell:
    method: str
    path: str  # route template, e.g. /api/markets/{market_id}/bets
    role: str
    expected_status: int
    expected_code: str | None = None
    body: dict | Callable[[dict], dict] | None = None
    setup: Setup | None = None
    params: dict | None = None
    check: Check | None = None
    note: str = ""

    def __post_init__(self):
        assert self.role in ALL_ROLES, self.role
        # Every refusal must pin the stable code, not just the status.
        assert self.expected_status < 400 or self.expected_code, (self.method, self.path, self.role)


class World:
    """Seeds the rows a cell needs, relative to the acting role."""

    def __init__(self, database, seed_market, seed_bet, role):
        self.db, self._seed_market, self._seed_bet, self.role = database, seed_market, seed_bet, role
        self.seeded_ids: set[str] = set()

    @property
    def other(self) -> str:
        """A real role that is not the actor, used as 'someone else'."""
        return "admin" if self.role == "super_admin" else "super_admin"

    def uid(self, role: str) -> str:
        return ROLE_IDS[role]

    def _role(self, who: str) -> str:
        if who == "other":
            return self.other
        if who == "self":
            return "user" if self.role == "anon" else self.role
        return who

    def market(self, status="open", creator="other", **fields) -> dict:
        row = self._seed_market(status=status, creator_role=self._role(creator), **fields)
        self.seeded_ids.add(row["id"])
        return row

    def bet(self, market, bettor="self", side="YES", amount=10) -> dict:
        row = self._seed_bet(market, self._role(bettor), side, amount)
        self.seeded_ids.add(row["id"])
        return row

    def row(self, table: str, **fields) -> dict:
        return self.db.table(table).insert(fields).execute().data[0]

    def profile(self, role: str) -> dict:
        return next(r for r in self.db.rows["profiles"] if r["id"] == ROLE_IDS[role])


# ── setup builders ───────────────────────────────────────────


def market(status="open", creator="other", **fields) -> Setup:
    return lambda w: {"market_id": w.market(status, creator, **fields)["id"]}


def closed(creator="other") -> Setup:
    return market("closed", creator)


def proposed(creator="other", status="pending_resolution") -> Setup:
    return market(status, creator, proposed_outcome="YES", dispute_deadline=FAR)


def community(creator="other") -> Setup:
    return market("pending_resolution", creator, resolution_window_end=FAR)


def disputed(creator="other", *, bettor=False, voted=False, submitted=False) -> Setup:
    """A market in dispute voting, with its single case and optional overlays."""

    def setup(w: World) -> dict:
        m = w.market("disputed", creator, proposed_outcome="YES")
        case = w.row(
            "disputes", market_id=m["id"], disputer_id=w.uid(w.other), explanation="The source disagrees.",
            voting_deadline=FAR, resolved_by_admin=False,
        )
        if bettor:
            w.bet(m, "self")
        if voted:
            w.row("resolution_votes", dispute_id=case["id"], market_id=m["id"], voter_id=w.uid(w._role("self")),
                  selected_outcome="YES")
        if submitted:
            w.row("dispute_submissions", dispute_id=case["id"], market_id=m["id"],
                  submitter_id=w.uid(w._role("self")), explanation="Already said my piece.")
        return {"market_id": m["id"]}

    return setup


def balance(amount: float, inner: Setup) -> Setup:
    def setup(w: World) -> dict:
        w.profile(w._role("self"))["banana_balance"] = amount
        return inner(w)

    return setup


def multichoice_option(status="open", creator="other") -> Setup:
    def setup(w: World) -> dict:
        m = w.market(status, creator, market_type="multichoice")
        option = w.row("market_options", market_id=m["id"], label="Option A", sort_order=0)
        return {"market_id": m["id"], "option_id": option["id"]}

    return setup


def binary_with_option() -> Setup:
    def setup(w: World) -> dict:
        m = w.market("open", "other")
        return {"market_id": m["id"], "option_id": w.row("market_options", market_id=m["id"], label="A")["id"]}

    return setup


def foreign_option() -> Setup:
    """An option that belongs to a different market than the one in the path."""

    def setup(w: World) -> dict:
        other = w.market("open", "other", market_type="multichoice")
        option = w.row("market_options", market_id=other["id"], label="A")
        return {"market_id": w.market("open", "other", market_type="multichoice")["id"], "option_id": option["id"]}

    return setup


def unknown_option() -> Setup:
    return lambda w: {"market_id": w.market("open", "other", market_type="multichoice")["id"],
                      "option_id": UNKNOWN_ID}


# ── cell builders ────────────────────────────────────────────


def each(roles, method, path, status, code=None, **kw) -> list[MatrixCell]:
    return [MatrixCell(method, path, role, status, code, **kw) for role in roles]


def ids(response) -> list[str]:
    return [row["id"] for row in response.json()]


def expect(predicate: Callable[[Any, dict], bool]) -> Check:
    def check(response, ctx):
        assert predicate(response, ctx), response.text

    return check


def json_is(expected: dict) -> Check:
    def check(response, _ctx):
        body = response.json()
        assert {k: body[k] for k in expected} == expected, body

    return check


def valid_market_body(_ctx=None) -> dict:
    return {
        "title": "Will CMU announce a new AI initiative?",
        "description": "Resolves on official CMU announcements.",
        "close_at": (datetime.now(tz=UTC) + timedelta(days=3)).isoformat(),
        "resolution_criteria": "YES if an official announcement confirms it.",
        "category": "Academics",
        "official_source": "https://www.cmu.edu/news",
    }


# ── 7a auth.py ───────────────────────────────────────────────

_A = "/api/auth"


def _own_profile_updated(response, ctx):
    assert response.json()["display_name"] == "Fixture Name"


MATRIX_CELLS: list[MatrixCell] = [
    *each(["anon"], "GET", f"{_A}/me", 401, "UNAUTHORIZED"),
    *each(MEMBERS, "GET", f"{_A}/me", 200),
    *each(["anon"], "POST", f"{_A}/profile", 401, "UNAUTHORIZED", body={"andrew_id": "x", "display_name": "Name"}),
    *each(MEMBERS, "POST", f"{_A}/profile", 201, body={"andrew_id": "fixture", "display_name": "Fixture Name"},
          check=_own_profile_updated),
    *each(["user"], "POST", f"{_A}/profile", 422, "VALIDATION_FAILED", body={}, note="request-schema validation"),
    *each(["anon"], "PATCH", f"{_A}/profile", 401, "UNAUTHORIZED", body={"display_name": "Name"}),
    *each(MEMBERS, "PATCH", f"{_A}/profile", 200, body={"display_name": "Fixture Name"}, check=_own_profile_updated),
    *each(["user"], "PATCH", f"{_A}/profile", 400, "VALIDATION_FAILED", body={}, note="no fields to update"),
    *each(["user"], "PATCH", f"{_A}/profile", 422, "VALIDATION_FAILED", body={"display_name": 5}),
    *each(["anon"], "POST", f"{_A}/claim-daily", 401, "UNAUTHORIZED"),
    *each(MEMBERS, "POST", f"{_A}/claim-daily", 200),
    *each(MEMBERS, "POST", f"{_A}/claim-daily", 409, "CLAIM_ALREADY_TODAY",
          setup=lambda w: w.row("transactions", user_id=w.uid(w.role), transaction_type="daily_claim", amount=1000) and {}),
    *each(["user"], "POST", f"{_A}/claim-daily", 409, "CLAIM_AT_BALANCE_CAP", setup=balance(5000, lambda w: {})),
]

# ── 7b markets.py ────────────────────────────────────────────

_M = "/api/markets"


def _private_list(visible: str):
    """Setup/check for the pending_review filter; `visible` is none | own | all."""

    def check(response, ctx):
        expected = {"none": [], "own": [ctx["own"]], "all": [ctx["own"], ctx["foreign"]]}[visible]
        assert sorted(ids(response)) == sorted(expected)

    return check


def _private_pair(w: World) -> dict:
    own = w.market("pending_review", "self")["id"]
    foreign = w.market("pending_review", "other")["id"]
    return {"own": own, "foreign": foreign}


def _public_list(w: World) -> dict:
    return {"open": w.market("open", "other")["id"], "hidden": w.market("pending_review", "other")["id"]}


def _only_open(response, ctx):
    assert ids(response) == [ctx["open"]]


def _one_market(w: World) -> dict:
    return {"id": w.market("open", "other", yes_pool_total=10)["id"]}


def _is_that_market(response, ctx):
    assert ids(response) == [ctx["id"]]


MATRIX_CELLS += [
    *each(ALL_ROLES, "GET", _M, 200, setup=_public_list, check=_only_open, note="private states excluded by default"),
    MatrixCell("GET", _M, "anon", 200, params={"status": "pending_review"}, setup=_private_pair,
               check=_private_list("none")),
    MatrixCell("GET", _M, "user", 200, params={"status": "pending_review"}, setup=_private_pair,
               check=_private_list("own")),
    MatrixCell("GET", _M, "admin", 200, params={"status": "pending_review"}, setup=_private_pair,
               check=_private_list("all")),
    MatrixCell("GET", _M, "super_admin", 200, params={"status": "pending_review"}, setup=_private_pair,
               check=_private_list("all")),
    *each(["user"], "GET", _M, 422, "VALIDATION_FAILED", params={"limit": 0}),
    *each(ALL_ROLES, "GET", f"{_M}/hot", 200, setup=_one_market, check=_is_that_market),
    *each(ALL_ROLES, "GET", f"{_M}/trending", 200),
    *each(ALL_ROLES, "GET", f"{_M}/top", 200, setup=_one_market, check=_is_that_market),
    # GET /{id}: 200 / 404
    *each(ALL_ROLES, "GET", f"{_M}/{{market_id}}", 200, setup=market("open")),
    *each(["anon", "user"], "GET", f"{_M}/{{market_id}}", 404, "MARKET_NOT_FOUND",
          setup=market("pending_review", "other"), note="private state, caller is not creator/admin"),
    *each(["admin", "super_admin"], "GET", f"{_M}/{{market_id}}", 200, setup=market("pending_review", "other"),
          note="admin reads any private market"),
    *each(["user", "admin"], "GET", f"{_M}/{{market_id}}", 200, setup=market("pending_review", "self"),
          note="creator(M) reads own pending market"),
    *each(["anon", "user"], "GET", f"{_M}/{{market_id}}", 404, "MARKET_NOT_FOUND", note="missing id"),
    # POST (create)
    *each(["anon"], "POST", _M, 401, "UNAUTHORIZED", body=valid_market_body),
    *each(MEMBERS, "POST", _M, 201, body=valid_market_body,
          check=expect(lambda r, c: r.json()["status"] == "pending_review")),
    *each(["user"], "POST", _M, 422, "VALIDATION_FAILED", body={}, note="request-schema validation"),
    *each(["user"], "POST", _M, 422, "VALIDATION_FAILED",
          body=lambda c: {**valid_market_body(), "title": "T" * 121}, note="title over limit"),
    # POST /{id}/resolve (creator proposes)
    *each(["anon"], "POST", f"{_M}/{{market_id}}/resolve", 401, "UNAUTHORIZED", body={"outcome": "YES"}),
    *each(MEMBERS, "POST", f"{_M}/{{market_id}}/resolve", 403, "RESOLUTION_NOT_CREATOR", body={"outcome": "YES"},
          setup=closed("other")),
    *each(MEMBERS, "POST", f"{_M}/{{market_id}}/resolve", 200, body={"outcome": "YES"}, setup=closed("self"),
          check=json_is({"status": "pending_resolution", "proposed_outcome": "YES"})),
    *each(MEMBERS, "POST", f"{_M}/{{market_id}}/resolve", 400, "MARKET_NOT_CLOSED", body={"outcome": "YES"},
          setup=market("open", "self")),
    *each(["user"], "POST", f"{_M}/{{market_id}}/resolve", 400, "MARKET_NOT_CLOSED", body={"outcome": "YES"},
          setup=proposed("self"), note="already proposed"),
    *each(["user"], "POST", f"{_M}/{{market_id}}/resolve", 404, "MARKET_NOT_FOUND", body={"outcome": "YES"}),
    *each(["user"], "POST", f"{_M}/{{market_id}}/resolve", 422, "VALIDATION_FAILED", body={"outcome": "MAYBE"},
          setup=closed("self")),
    # POST /{id}/community-resolution
    *each(["anon"], "POST", f"{_M}/{{market_id}}/community-resolution", 401, "UNAUTHORIZED"),
    *each(MEMBERS, "POST", f"{_M}/{{market_id}}/community-resolution", 403, "RESOLUTION_NOT_CREATOR",
          setup=closed("other")),
    *each(MEMBERS, "POST", f"{_M}/{{market_id}}/community-resolution", 200, setup=closed("self"),
          check=json_is({"status": "pending_resolution", "proposed_outcome": None})),
    *each(MEMBERS, "POST", f"{_M}/{{market_id}}/community-resolution", 400, "MARKET_NOT_CLOSED",
          setup=market("open", "self")),
    *each(["user"], "POST", f"{_M}/{{market_id}}/community-resolution", 200, setup=community("self"),
          note="idempotent when already in community resolution"),
    *each(["user"], "POST", f"{_M}/{{market_id}}/community-resolution", 404, "MARKET_NOT_FOUND"),
]

# POST /{id}/dispute (file a concern)
_D = f"{_M}/{{market_id}}/dispute"
_EXPLAIN = {"explanation": "The cited source says otherwise."}

MATRIX_CELLS += [
    *each(["anon"], "POST", _D, 401, "UNAUTHORIZED", body=_EXPLAIN),
    *each(MEMBERS, "POST", _D, 200, body=_EXPLAIN, setup=proposed("other"),
          check=json_is({"opened_case": True}), note="first concern opens the case"),
    *each(MEMBERS, "POST", _D, 200, body=_EXPLAIN, setup=disputed("other"),
          check=json_is({"opened_case": False}), note="later concern joins the case"),
    *each(MEMBERS, "POST", _D, 403, "DISPUTE_CREATOR_RESTRICTED", body=_EXPLAIN, setup=proposed("self")),
    *each(MEMBERS, "POST", _D, 409, "DISPUTE_ALREADY_FILED", body=_EXPLAIN, setup=disputed("other", submitted=True)),
    *each(["user"], "POST", _D, 400, "MARKET_NOT_PENDING_RESOLUTION", body=_EXPLAIN, setup=market("open")),
    *each(["user"], "POST", _D, 400, "MARKET_NOT_PENDING_RESOLUTION", body=_EXPLAIN,
          setup=market("pending_resolution", "other"), note="no creator proposal"),
    *each(["user"], "POST", _D, 404, "MARKET_NOT_FOUND", body=_EXPLAIN),
    *each(["user"], "POST", _D, 422, "VALIDATION_FAILED", body={"explanation": "  "}, setup=proposed("other")),
    # GET /{id}/dispute
    *each(ALL_ROLES, "GET", _D, 200, setup=disputed("other"),
          check=expect(lambda r, c: r.json()["market_id"] == c["market_id"])),
    *each(ALL_ROLES, "GET", _D, 404, "DISPUTE_NOT_FOUND", setup=market("open")),
    # GET /{id}/dispute/submissions
    *each(ALL_ROLES, "GET", f"{_D}/submissions", 200, setup=disputed("other"), check=json_is({"total": 0})),
    *each(["user"], "GET", f"{_D}/submissions", 422, "VALIDATION_FAILED", params={"limit": 0}),
    # GET /{id}/dispute/eligibility
    *each(["anon"], "GET", f"{_D}/eligibility", 401, "UNAUTHORIZED"),
    *each(MEMBERS, "GET", f"{_D}/eligibility", 200, setup=disputed("other"),
          check=json_is({"is_creator": False, "is_bettor": False, "vote": None, "can_vote": True}),
          note="neutral caller"),
    *each(MEMBERS, "GET", f"{_D}/eligibility", 200, setup=disputed("self"),
          check=json_is({"is_creator": True, "can_vote": False}), note="creator(M)"),
    *each(MEMBERS, "GET", f"{_D}/eligibility", 200, setup=disputed("other", bettor=True),
          check=json_is({"is_bettor": True, "can_vote": False}), note="bettor(M)"),
    *each(MEMBERS, "GET", f"{_D}/eligibility", 200, setup=disputed("other", voted=True),
          check=json_is({"vote": "YES", "can_vote": False}), note="dispute-voter(D)"),
    *each(["user"], "GET", f"{_D}/eligibility", 404, "MARKET_NOT_FOUND"),
    # POST /{id}/dispute/vote
    *each(["anon"], "POST", f"{_D}/vote", 401, "UNAUTHORIZED", body={"vote": "YES"}),
    *each(MEMBERS, "POST", f"{_D}/vote", 200, body={"vote": "YES"}, setup=disputed("other"),
          check=json_is({"selected_outcome": "YES"})),
    *each(MEMBERS, "POST", f"{_D}/vote", 403, "DISPUTE_CREATOR_RESTRICTED", body={"vote": "YES"},
          setup=disputed("self")),
    *each(MEMBERS, "POST", f"{_D}/vote", 403, "DISPUTE_BETTOR_RESTRICTED", body={"vote": "YES"},
          setup=disputed("other", bettor=True)),
    *each(MEMBERS, "POST", f"{_D}/vote", 409, "DISPUTE_VOTE_DUPLICATE", body={"vote": "YES"},
          setup=disputed("other", voted=True), note="duplicate is 409 Conflict (matrix corrected from 403)"),
    *each(["user"], "POST", f"{_D}/vote", 404, "DISPUTE_NOT_FOUND", body={"vote": "YES"}, setup=market("open")),
    *each(["user"], "POST", f"{_D}/vote", 422, "VALIDATION_FAILED", body={"vote": "MAYBE"}, setup=disputed("other")),
    # GET /{id}/dispute/votes
    *each(ALL_ROLES, "GET", f"{_D}/votes", 200, setup=disputed("other", voted=True), check=expect(lambda r, c: len(r.json()) == 1)),
    *each(["anon", "user"], "GET", f"{_D}/votes", 404, "DISPUTE_NOT_FOUND", setup=market("open"),
          note="no dispute yet"),
]

# ── 7c bets.py ───────────────────────────────────────────────

_BET = {"side": "YES", "amount": 10}
_B = f"{_M}/{{market_id}}/bets"


def _bet_listing(w: World) -> dict:
    m = w.market("open", "other")
    w.bet(m, "other")
    return {"market_id": m["id"]}


MATRIX_CELLS += [
    *each(["anon"], "POST", _B, 401, "UNAUTHORIZED", body=_BET),
    *each(MEMBERS, "POST", _B, 201, body=_BET, setup=market("open", "other"), check=json_is({"new_balance": 990})),
    *each(MEMBERS, "POST", _B, 403, "BET_CREATOR_RESTRICTED", body=_BET, setup=market("open", "self")),
    *each(MEMBERS, "POST", _B, 409, "MARKET_NOT_OPEN", body=_BET, setup=market("closed", "other")),
    *each(["user"], "POST", _B, 409, "BET_INSUFFICIENT_BALANCE", body=_BET, setup=balance(0, market("open", "other"))),
    *each(["user"], "POST", _B, 404, "NOT_FOUND", body=_BET),
    *each(["user"], "POST", _B, 422, "VALIDATION_FAILED", body={"side": "YES", "amount": 0}, setup=market("open"),
          note="amount must be positive"),
    *each(["user"], "POST", _B, 422, "VALIDATION_FAILED", body={"side": "MAYBE", "amount": 5}, setup=market("open"),
          note="side must be YES or NO"),
    *each(["anon"], "POST", f"{_B}/option", 401, "UNAUTHORIZED", body={"option_id": "o", "amount": 10}),
    *each(MEMBERS, "POST", f"{_B}/option", 201, body=lambda c: {"option_id": c["option_id"], "amount": 10},
          setup=multichoice_option("open", "other")),
    *each(MEMBERS, "POST", f"{_B}/option", 403, "BET_CREATOR_RESTRICTED",
          body=lambda c: {"option_id": c["option_id"], "amount": 10}, setup=multichoice_option("open", "self")),
    *each(["user"], "POST", f"{_B}/option", 409, "MARKET_NOT_OPEN",
          body=lambda c: {"option_id": c["option_id"], "amount": 10}, setup=multichoice_option("closed", "other")),
    *each(["user"], "POST", f"{_B}/option", 409, "BET_INSUFFICIENT_BALANCE",
          body=lambda c: {"option_id": c["option_id"], "amount": 10},
          setup=balance(0, multichoice_option("open", "other"))),
    *each(["user"], "POST", f"{_B}/option", 400, "MARKET_NOT_MULTICHOICE",
          body=lambda c: {"option_id": c["option_id"], "amount": 10}, setup=binary_with_option()),
    *each(["user"], "POST", f"{_B}/option", 400, "BET_INVALID_OPTION",
          body=lambda c: {"option_id": c["option_id"], "amount": 10}, setup=foreign_option(),
          note="option belongs to another market"),
    *each(["user"], "POST", f"{_B}/option", 400, "BET_INVALID_OPTION",
          body=lambda c: {"option_id": c["option_id"], "amount": 10}, setup=unknown_option(),
          note="unknown option"),
    *each(ALL_ROLES, "GET", _B, 200, setup=_bet_listing,
          check=expect(lambda r, c: len(r.json()) == 1)),
]

# ── 7d resolution.py ─────────────────────────────────────────


def _resolution_lists(w: World) -> dict:
    return {"community": w.market("pending_resolution", "other", resolution_window_end=FAR)["id"],
            "disputed": disputed("other")(w)["market_id"]}


def _community_listing(response, ctx):
    assert sorted(ids(response)) == sorted([ctx["community"], ctx["disputed"]])


def _voted(creator="other"):
    def setup(w: World) -> dict:
        ctx = community(creator)(w)
        w.row("community_votes", market_id=ctx["market_id"], voter_id=w.uid(w._role("self")), selected_outcome="YES")
        return ctx

    return setup


def _community_votes_listing(w: World) -> dict:
    ctx = community("other")(w)
    w.row("community_votes", market_id=ctx["market_id"], voter_id=w.uid(w.other), selected_outcome="NO")
    return ctx


_CV = {"vote": "YES"}

MATRIX_CELLS += [
    *each(ALL_ROLES, "GET", f"{_M}/resolutions", 200, setup=_resolution_lists, check=_community_listing),
    *each(["anon"], "POST", f"{_M}/{{market_id}}/community-vote", 401, "UNAUTHORIZED", body=_CV),
    *each(MEMBERS, "POST", f"{_M}/{{market_id}}/community-vote", 200, body=_CV, setup=community("other")),
    *each(MEMBERS, "POST", f"{_M}/{{market_id}}/community-vote", 403, "COMMUNITY_VOTE_CREATOR_RESTRICTED", body=_CV,
          setup=community("self")),
    *each(MEMBERS, "POST", f"{_M}/{{market_id}}/community-vote", 409, "COMMUNITY_VOTE_DUPLICATE", body=_CV,
          setup=_voted()),
    *each(["user"], "POST", f"{_M}/{{market_id}}/community-vote", 400, "MARKET_NOT_PENDING_RESOLUTION", body=_CV,
          setup=market("open")),
    *each(["user"], "POST", f"{_M}/{{market_id}}/community-vote", 404, "MARKET_NOT_FOUND", body=_CV),
    *each(["user"], "POST", f"{_M}/{{market_id}}/community-vote", 422, "VALIDATION_FAILED", body={"vote": "MAYBE"},
          setup=community()),
    *each(ALL_ROLES, "GET", f"{_M}/{{market_id}}/community-votes", 200, setup=_community_votes_listing,
          check=expect(lambda r, c: len(r.json()) == 1)),
]

# ── 7e admin.py ──────────────────────────────────────────────

_ADM = "/api/admin"


def _admin_only(method, path, check=None):
    """anon 401, user 403 ADMIN_REQUIRED, admin and super_admin allowed (200)."""
    return [
        *each(["anon"], method, path, 401, "UNAUTHORIZED"),
        *each(["user"], method, path, 403, "ADMIN_REQUIRED"),
        *each(["admin", "super_admin"], method, path, 200, check=check),
    ]


def _extra_target(w: World) -> dict:
    row = w.row("profiles", email="target@andrew.cmu.edu", andrew_id="target", display_name="Target",
                banana_balance=1000, created_at="2026-01-01T00:00:00+00:00", role="user")
    return {"user_id": row["id"]}


def _review_listing(w: World) -> dict:
    w.market("open", "other")
    return {"pending": w.market("pending_review", "other")["id"]}


def _role_changed(response, ctx):
    assert response.json()["role"] == "admin"


MATRIX_CELLS += [
    *_admin_only("POST", f"{_ADM}/markets/resolution-reminders/run"),
    *_admin_only("GET", f"{_ADM}/stats"),
    *each(["anon"], "GET", f"{_ADM}/users/search", 401, "UNAUTHORIZED", params={"q": "test"}),
    *each(["user", "admin"], "GET", f"{_ADM}/users/search", 403, "SUPER_ADMIN_REQUIRED", params={"q": "test"}),
    *each(["super_admin"], "GET", f"{_ADM}/users/search", 200, params={"q": "test"}),
    *each(["super_admin"], "GET", f"{_ADM}/users/search", 422, "VALIDATION_FAILED"),
    *each(["anon"], "PUT", f"{_ADM}/users/{{user_id}}/role", 401, "UNAUTHORIZED", body={"role": "admin"}),
    *each(["user", "admin"], "PUT", f"{_ADM}/users/{{user_id}}/role", 403, "SUPER_ADMIN_REQUIRED",
          body={"role": "admin"}, setup=_extra_target),
    *each(["super_admin"], "PUT", f"{_ADM}/users/{{user_id}}/role", 200, body={"role": "admin"},
          setup=_extra_target, check=_role_changed),
    *each(["super_admin"], "PUT", f"{_ADM}/users/{{user_id}}/role", 400, "ADMIN_CANNOT_CHANGE_OWN_ROLE",
          body={"role": "user"}, setup=lambda w: {"user_id": w.uid("super_admin")}),
    *each(["super_admin"], "PUT", f"{_ADM}/users/{{user_id}}/role", 400, "VALIDATION_FAILED",
          body={"role": "super_admin"}, setup=_extra_target),
    *each(["super_admin"], "PUT", f"{_ADM}/users/{{user_id}}/role", 404, "NOT_FOUND", body={"role": "admin"}),
    # backroll
    *each(["anon"], "POST", f"{_ADM}/markets/{{market_id}}/backroll", 401, "UNAUTHORIZED",
          body={"cutoff_date": "2026-01-01T00:00:00Z"}),
    *each(["user"], "POST", f"{_ADM}/markets/{{market_id}}/backroll", 403, "ADMIN_REQUIRED",
          body={"cutoff_date": "2026-01-01T00:00:00Z"}, setup=market("open")),
    *each(["admin", "super_admin"], "POST", f"{_ADM}/markets/{{market_id}}/backroll", 200,
          body={"cutoff_date": "2026-01-01T00:00:00Z"}, setup=market("open")),
    *each(["admin", "super_admin"], "POST", f"{_ADM}/markets/{{market_id}}/backroll", 400, "MARKET_ALREADY_RESOLVED",
          body={"cutoff_date": "2026-01-01T00:00:00Z"}, setup=market("resolved")),
    *each(["admin"], "POST", f"{_ADM}/markets/{{market_id}}/backroll", 404, "MARKET_NOT_FOUND",
          body={"cutoff_date": "2026-01-01T00:00:00Z"}),
    *each(["admin"], "POST", f"{_ADM}/markets/{{market_id}}/backroll", 422, "VALIDATION_FAILED", body={},
          setup=market("open")),
    # review queue and review action
    *each(["anon"], "GET", f"{_ADM}/markets/review", 401, "UNAUTHORIZED"),
    *each(["user"], "GET", f"{_ADM}/markets/review", 403, "ADMIN_REQUIRED"),
    *each(["admin", "super_admin"], "GET", f"{_ADM}/markets/review", 200, setup=_review_listing,
          check=expect(lambda r, c: [m["id"] for m in r.json()["pending"]] == [c["pending"]])),
    *each(["anon"], "POST", f"{_ADM}/markets/{{market_id}}/review", 401, "UNAUTHORIZED", body={"action": "approve"}),
    *each(["user"], "POST", f"{_ADM}/markets/{{market_id}}/review", 403, "ADMIN_REQUIRED", body={"action": "approve"},
          setup=market("pending_review")),
    *each(["admin", "super_admin"], "POST", f"{_ADM}/markets/{{market_id}}/review", 200, body={"action": "approve"},
          setup=market("pending_review"), note="approve"),
    *each(["admin", "super_admin"], "POST", f"{_ADM}/markets/{{market_id}}/review", 200,
          body={"action": "deny", "notes": "Needs sharper criteria."}, setup=market("pending_review"),
          note="deny with notes"),
    *each(["admin", "super_admin"], "POST", f"{_ADM}/markets/{{market_id}}/review", 400, "MARKET_NOT_PENDING_REVIEW",
          body={"action": "approve"}, setup=market("open")),
    *each(["admin"], "POST", f"{_ADM}/markets/{{market_id}}/review", 404, "MARKET_NOT_FOUND",
          body={"action": "approve"}),
    *each(["admin"], "POST", f"{_ADM}/markets/{{market_id}}/review", 400, "VALIDATION_FAILED",
          body={"action": "deny"}, setup=market("pending_review"), note="deny requires notes"),
    # escalation queues
    *_admin_only("GET", f"{_ADM}/markets/admin-review", check=expect(lambda r, c: r.json() == [])),
    *_admin_only("GET", f"{_ADM}/markets/disputes", check=expect(lambda r, c: r.json()["items"] == [])),
    *each(["admin"], "GET", f"{_ADM}/markets/disputes", 422, "VALIDATION_FAILED", params={"status": "resolved"}),
    # final resolution
    *each(["anon"], "POST", f"{_ADM}/markets/{{market_id}}/resolve", 401, "UNAUTHORIZED", body={"outcome": "YES"}),
    *each(["user"], "POST", f"{_ADM}/markets/{{market_id}}/resolve", 403, "ADMIN_REQUIRED", body={"outcome": "YES"},
          setup=market("admin_review")),
    *each(["admin", "super_admin"], "POST", f"{_ADM}/markets/{{market_id}}/resolve", 200, body={"outcome": "YES"},
          setup=market("admin_review"), check=json_is({"status": "resolved", "outcome": "YES"}),
          note="binary YES"),
    *each(["admin", "super_admin"], "POST", f"{_ADM}/markets/{{market_id}}/resolve", 403,
          "ADMIN_RESOLUTION_CREATOR_RESTRICTED", body={"outcome": "YES"}, setup=market("admin_review", "self")),
    *each(["admin"], "POST", f"{_ADM}/markets/{{market_id}}/resolve", 400, "MARKET_NOT_ADMIN_REVIEW",
          body={"outcome": "YES"}, setup=market("open")),
    *each(["admin"], "POST", f"{_ADM}/markets/{{market_id}}/resolve", 400, "MARKET_ALREADY_RESOLVED",
          body={"outcome": "YES"}, setup=market("resolved")),
    *each(["admin"], "POST", f"{_ADM}/markets/{{market_id}}/resolve", 400, "MARKET_NOT_BINARY",
          body={"outcome": "YES"}, setup=market("admin_review", market_type="multichoice")),
    *each(["admin"], "POST", f"{_ADM}/markets/{{market_id}}/resolve", 200, body={"outcome": "AMBIGUOUS"},
          setup=market("admin_review", market_type="multichoice"), check=json_is({"outcome": "AMBIGUOUS"}),
          note="multichoice refund"),
    *each(["admin"], "POST", f"{_ADM}/markets/{{market_id}}/resolve", 404, "MARKET_NOT_FOUND",
          body={"outcome": "YES"}),
    *each(["admin"], "POST", f"{_ADM}/markets/{{market_id}}/resolve", 422, "VALIDATION_FAILED",
          body={"outcome": "MAYBE"}, setup=market("admin_review")),
]

# ── 7f notifications.py ──────────────────────────────────────

_N = "/api/notifications"


def _notifications(w: World) -> dict:
    mine = w.row("notifications", user_id=w.uid(w._role("self")), is_read=False, type="test", title="Mine", body="b")
    theirs = w.row("notifications", user_id=w.uid(w.other), is_read=False, type="test", title="Theirs", body="b")
    return {"own": mine, "theirs": theirs, "notification_id": mine["id"], "db": w.db}


def _foreign_notification(w: World) -> dict:
    ctx = _notifications(w)
    return {**ctx, "notification_id": ctx["theirs"]["id"]}


def _only_own(response, ctx):
    assert ids(response) == [ctx["own"]["id"]]


def _unread_one(response, ctx):
    assert response.json() == {"count": 1}


def _marked_own_only(response, ctx):
    assert ctx["own"]["is_read"] is True and ctx["theirs"]["is_read"] is False


def _own_deleted_theirs_kept(response, ctx):
    rows = ctx["db"].rows["notifications"]
    assert ctx["own"] not in rows and ctx["theirs"] in rows


def _theirs_kept(response, ctx):
    assert ctx["theirs"] in ctx["db"].rows["notifications"]


def _theirs_untouched(response, ctx):
    assert ctx["theirs"]["is_read"] is False


MATRIX_CELLS += [
    *each(["anon"], "GET", _N, 401, "UNAUTHORIZED"),
    *each(MEMBERS, "GET", _N, 200, setup=_notifications, check=_only_own, note="server-filtered to own rows"),
    *each(["anon"], "GET", f"{_N}/unread-count", 401, "UNAUTHORIZED"),
    *each(MEMBERS, "GET", f"{_N}/unread-count", 200, setup=_notifications, check=_unread_one),
    *each(["anon"], "POST", f"{_N}/read", 401, "UNAUTHORIZED"),
    *each(MEMBERS, "POST", f"{_N}/read", 200, setup=_notifications, check=_marked_own_only),
    *each(["anon"], "POST", f"{_N}/{{notification_id}}/read", 401, "UNAUTHORIZED"),
    *each(MEMBERS, "POST", f"{_N}/{{notification_id}}/read", 200, setup=_notifications, check=_marked_own_only),
    *each(MEMBERS, "POST", f"{_N}/{{notification_id}}/read", 404, "NOTIFICATION_NOT_FOUND",
          setup=_foreign_notification, check=_theirs_untouched, note="non-owner gets 404, not 403"),
    *each(["anon"], "DELETE", f"{_N}/{{notification_id}}", 401, "UNAUTHORIZED"),
    *each(MEMBERS, "DELETE", f"{_N}/{{notification_id}}", 200, setup=_notifications,
          check=_own_deleted_theirs_kept),
    *each(MEMBERS, "DELETE", f"{_N}/{{notification_id}}", 404, "NOTIFICATION_NOT_FOUND",
          setup=_foreign_notification, check=_theirs_kept),
]

# ── 7g portfolio.py ──────────────────────────────────────────


def _proposals(w: World) -> dict:
    mine = w.market("pending_review", "self")["id"]
    w.market("denied", "self")  # also the caller's own proposal
    w.market("pending_review", "other")
    w.market("open", "self")
    return {"mine": mine, "actor": w.uid(w._role("self"))}


def _two_own_proposals(response, ctx):
    assert len(response.json()) == 2 and {m["creator_id"] for m in response.json()} == {ctx["actor"]}


def _positions(w: World) -> dict:
    m = w.market("open", "other")
    return {"own_bet": w.bet(m, "self")["id"], "other_bet": w.bet(m, "other")["id"]}


def _only_own_bet(response, ctx):
    assert ids(response) == [ctx["own_bet"]]


def _ledger(w: World) -> dict:
    mine = w.row("transactions", user_id=w.uid(w._role("self")), transaction_type="payout", amount=5)
    w.row("transactions", user_id=w.uid(w.other), transaction_type="payout", amount=7)
    return {"own_tx": mine["id"]}


def _only_own_tx(response, ctx):
    assert ids(response) == [ctx["own_tx"]]


MATRIX_CELLS += [
    *each(["anon"], "GET", "/api/portfolio/proposed-markets", 401, "UNAUTHORIZED"),
    *each(MEMBERS, "GET", "/api/portfolio/proposed-markets", 200, setup=_proposals, check=_two_own_proposals,
          note="own pending/denied proposals only, never another account's"),
    *each(["anon"], "GET", "/api/portfolio", 401, "UNAUTHORIZED"),
    *each(MEMBERS, "GET", "/api/portfolio", 200, setup=_positions, check=_only_own_bet),
    *each(["anon"], "GET", "/api/transactions", 401, "UNAUTHORIZED"),
    *each(MEMBERS, "GET", "/api/transactions", 200, setup=_ledger, check=_only_own_tx),
]

# ── 7h rewards.py / 7i leaderboard.py ────────────────────────

MATRIX_CELLS += [
    *each(["anon"], "GET", "/api/rewards", 401, "UNAUTHORIZED"),
    *each(MEMBERS, "GET", "/api/rewards", 200,
          check=expect(lambda r, c: set(r.json()) == {"tracks", "badges"})),
    *each(ALL_ROLES, "GET", "/api/rewards/badges/{user_id}", 200),
    *each(["anon"], "POST", "/api/rewards/check", 401, "UNAUTHORIZED"),
    *each(MEMBERS, "POST", "/api/rewards/check", 200, check=json_is({"new_badges": []})),
    *each(ALL_ROLES, "GET", "/api/leaderboard", 200),
    *each(ALL_ROLES, "GET", "/api/leaderboard/weekly", 200, check=json_is({"period": "all_time"})),
]
