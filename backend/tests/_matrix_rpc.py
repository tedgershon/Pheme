"""Stored-function emulation for the endpoint matrix tests.

Each handler copies the *precondition order and error messages* of the current
migration for one RPC the API calls, so seeded rows (market status, creator,
bets, votes) decide the outcome the way they do in Postgres. They return the
shape the real function returns, but do not move balances or write ledger rows.

This keeps the HTTP contract honest (route -> RPC call -> mapped status/code),
not the SQL itself. Balances, pools, locking, concurrency and RLS stay covered
by the disposable-database suite (scripts/db/test_migrations.py). When an RPC's
messages change in a migration, update the handler here and the route's mapping.
"""

from datetime import UTC, datetime
from uuid import uuid4

from postgrest.exceptions import APIError

FAR_FUTURE = "2099-01-01T00:00:00+00:00"
CLAIM_CAP = 5000


def sql_error(message, code="P0001"):
    """The error PostgREST raises for RAISE EXCEPTION (P0001) or a constraint."""
    return APIError({"code": code, "message": message, "details": None, "hint": None})


def _find(db, table, **where):
    return next((row for row in db.rows[table] if all(row.get(k) == v for k, v in where.items())), None)


def _market(db, market_id):
    market = _find(db, "markets", id=market_id)
    if market is None:
        raise sql_error("Market not found")
    return market


def _past(value):
    return datetime.fromisoformat(value) <= datetime.now(tz=UTC)


def place_bet(db, p):
    if p["p_amount"] <= 0:
        raise sql_error("Bet amount must be positive")
    market = _market(db, p["p_market_id"])
    if p["p_user_id"] == market["creator_id"]:
        raise sql_error("Market creators cannot place bets on their own markets")
    if market["status"] != "open":
        raise sql_error("Market is not open for betting")
    balance = _find(db, "profiles", id=p["p_user_id"])["banana_balance"]
    if balance < p["p_amount"]:
        raise sql_error("Insufficient balance")
    return {"bet_id": str(uuid4()), "new_balance": balance - p["p_amount"]}


def place_multichoice_bet(db, p):
    if p["p_amount"] <= 0:
        raise sql_error("Bet amount must be positive")
    option = _find(db, "market_options", id=p["p_option_id"])
    if option is None:
        raise sql_error("Option not found")
    if option["market_id"] != p["p_market_id"]:
        raise sql_error("Option does not belong to this market")
    market = _market(db, p["p_market_id"])
    if market["status"] != "open":
        raise sql_error("Market is not open for betting")
    if market.get("market_type") != "multichoice":
        raise sql_error("Market is not multichoice")
    if p["p_user_id"] == market["creator_id"]:
        raise sql_error("Market creators cannot place bets on their own markets")
    balance = _find(db, "profiles", id=p["p_user_id"])["banana_balance"]
    if balance < p["p_amount"]:
        raise sql_error("Insufficient balance")
    return {"bet_id": str(uuid4()), "new_balance": balance - p["p_amount"]}


def propose_resolution(db, p):
    market = _market(db, p["p_market_id"])
    if market["status"] != "closed":
        raise sql_error("Market must be closed before proposing resolution")
    if p["p_proposer_id"] != market["creator_id"]:
        raise sql_error("Only the market creator can propose a resolution")
    return {
        "market_id": p["p_market_id"],
        "status": "pending_resolution",
        "proposed_outcome": p["p_outcome"],
        "dispute_deadline": FAR_FUTURE,
    }


def file_dispute(db, p):
    market = _market(db, p["p_market_id"])
    if p["p_disputer_id"] == market["creator_id"]:
        raise sql_error("Market creator cannot file disputes")
    if market["status"] == "pending_resolution":
        if not market.get("proposed_outcome") or not market.get("dispute_deadline"):
            raise sql_error("A creator proposal and dispute deadline are required")
        if _past(market["dispute_deadline"]):
            raise sql_error("Dispute window has expired")
        dispute_id, opened = str(uuid4()), True
    elif market["status"] == "disputed":
        dispute = _find(db, "disputes", market_id=p["p_market_id"])
        if dispute is None:
            raise sql_error("Dispute not found")
        if _past(dispute["voting_deadline"]):
            raise sql_error("Dispute submission window has expired")
        if _find(db, "dispute_submissions", dispute_id=dispute["id"], submitter_id=p["p_disputer_id"]):
            raise sql_error("You have already submitted a concern for this market")
        dispute_id, opened = dispute["id"], False
    else:
        raise sql_error("Market is not in pending_resolution or disputed status")
    return {
        "id": str(uuid4()),
        "dispute_id": dispute_id,
        "market_id": p["p_market_id"],
        "submitter_id": p["p_disputer_id"],
        "explanation": p["p_explanation"],
        "voting_deadline": FAR_FUTURE,
        "opened_case": opened,
        "created_at": "2026-01-01T00:00:00+00:00",
    }


def cast_dispute_vote(db, p):
    dispute = _find(db, "disputes", id=p["p_dispute_id"])
    if dispute is None:
        raise sql_error("Dispute not found")
    if _past(dispute["voting_deadline"]):
        raise sql_error("Voting window has expired")
    market = _market(db, dispute["market_id"])
    if market["status"] != "disputed":
        raise sql_error("Market is not in disputed status")
    if p["p_voter_id"] == market["creator_id"]:
        raise sql_error("Market creator cannot vote on disputes")
    if _find(db, "bets", market_id=market["id"], user_id=p["p_voter_id"]) or _find(
        db, "transactions", market_id=market["id"], user_id=p["p_voter_id"], transaction_type="bet_placement"
    ):
        raise sql_error("Users who placed bets cannot vote on disputes")
    if _find(db, "resolution_votes", dispute_id=dispute["id"], voter_id=p["p_voter_id"]):
        raise sql_error('duplicate key value violates unique constraint "resolution_votes_dispute_id_voter_id_key"', "23505")
    return {
        "id": str(uuid4()),
        "dispute_id": dispute["id"],
        "market_id": market["id"],
        "voter_id": p["p_voter_id"],
        "selected_outcome": p["p_vote"],
        "created_at": "2026-01-01T00:00:00+00:00",
    }


def cast_community_vote(db, p):
    market = _market(db, p["p_market_id"])
    if market["status"] != "pending_resolution" or market.get("proposed_outcome"):
        raise sql_error("Market is not in the resolution period")
    if _past(market["resolution_window_end"]):
        raise sql_error("Resolution voting window has expired")
    if p["p_voter_id"] == market["creator_id"]:
        raise sql_error("Market creators cannot cast community votes on their own market")
    if _find(db, "community_votes", market_id=market["id"], voter_id=p["p_voter_id"]):
        raise sql_error('duplicate key value violates unique constraint "community_votes_market_id_voter_id_key"', "23505")
    return {"market_id": market["id"], "voter_id": p["p_voter_id"], "selected_outcome": p["p_vote"]}


def admin_resolve_market(db, p):
    market = _market(db, p["p_market_id"])
    if market["status"] == "resolved":
        raise sql_error("Market is already resolved")
    if market["status"] != "admin_review":
        raise sql_error("Market is not in admin_review status")
    if market["creator_id"] == p["p_admin_id"]:
        raise sql_error("Market creators cannot resolve their own markets")
    if p["p_outcome"] != "AMBIGUOUS" and market.get("market_type") == "multichoice":
        raise sql_error("YES/NO admin resolution requires a binary market")
    result = {"market_id": market["id"], "status": "resolved", "outcome": p["p_outcome"]}
    if p["p_outcome"] == "AMBIGUOUS":
        result |= {"refunded_total": 0, "refunded_users": 0}
    return result


def admin_backroll_market(db, p):
    market = _market(db, p["p_market_id"])
    if market["status"] == "resolved":
        raise sql_error("Cannot backroll a resolved market. Resolve must happen after backroll.")
    return {"market_id": market["id"], "bets_cancelled": 0, "total_refunded": 0}


def approve_market(db, p):
    market = _market(db, p["p_market_id"])
    if market["status"] != "pending_review":
        raise sql_error(f"Market is not pending review (current status: {market['status']})")
    market["status"] = "open"
    return {"market_id": market["id"], "status": "open"}


def claim_daily_bananas(db, p):
    profile = _find(db, "profiles", id=p["p_user_id"])
    if _find(db, "transactions", user_id=p["p_user_id"], transaction_type="daily_claim"):
        raise sql_error("Already claimed today")
    if profile["banana_balance"] >= CLAIM_CAP:
        raise sql_error("Balance is at or above the daily claim cap of 5000")
    return {"new_balance": profile["banana_balance"] + 1000, "claimed_at": "2026-01-01T00:00:00+00:00"}


def get_unread_notification_count(db, p):
    return sum(
        1 for row in db.rows["notifications"] if row["user_id"] == p["p_user_id"] and not row.get("is_read")
    )


def list_dispute_submissions(db, p):
    return {"total": 0, "has_submitted": False, "items": []}


def _nothing(_db, _p):
    return None


def _empty_list(_db, _p):
    return []


RPC_HANDLERS = {
    "place_bet": place_bet,
    "place_multichoice_bet": place_multichoice_bet,
    "propose_resolution": propose_resolution,
    "file_dispute": file_dispute,
    "cast_dispute_vote": cast_dispute_vote,
    "cast_community_vote": cast_community_vote,
    "admin_resolve_market": admin_resolve_market,
    "admin_backroll_market": admin_backroll_market,
    "approve_market": approve_market,
    "claim_daily_bananas": claim_daily_bananas,
    "get_unread_notification_count": get_unread_notification_count,
    "list_dispute_submissions": list_dispute_submissions,
    # Side-effect-only or aggregate reads the matrix does not assert on.
    "check_and_award_badges": _empty_list,
    "get_user_badge_stats": _empty_list,
    "get_networth_leaderboard": _empty_list,
    "get_gains_leaderboard": _empty_list,
    "notify_admins_market_submitted": _nothing,
    "create_market_notification": _nothing,
}
