from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from notification_service import notify_market_closed, notify_market_denied
from supabase import Client

logger = logging.getLogger(__name__)

DISPUTE_VOTE_QUORUM = 3
COMMUNITY_VOTE_QUORUM = 3


@dataclass(frozen=True)
class TransitionRule:
    trigger: str
    requires_dispute_lookup: bool = False
    requires_community_tally: bool = False


# postgres can return fractional seconds with anywhere from 1-6 digits
# python 3.10's fromisoformat only accepts 0/3/6, so pad to 6 first
_FRACTIONAL_RE = re.compile(r"\.(\d{1,6})")


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    s = value.replace("Z", "+00:00")
    s = _FRACTIONAL_RE.sub(lambda m: "." + m.group(1).ljust(6, "0"), s, count=1)
    parsed = datetime.fromisoformat(s)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


def _log_transition(market_id: str, from_status: str | None, to_status: str, trigger: str, now: datetime) -> None:
    logger.info(
        "market_state_transition market_id=%s from_status=%s to_status=%s trigger=%s timestamp=%s",
        market_id,
        from_status,
        to_status,
        trigger,
        now.isoformat(),
    )


def _check_badges_for_market_participants(supabase: Client, market_id: str) -> None:
    try:
        bets = supabase.table("bets").select("user_id").eq("market_id", market_id).execute()
        user_ids = {b["user_id"] for b in (bets.data or [])}
        market = supabase.table("markets").select("creator_id").eq("id", market_id).single().execute()
        if market.data:
            user_ids.add(market.data["creator_id"])
        for user_id in user_ids:
            try:
                supabase.rpc("check_and_award_badges", {"p_user_id": user_id}).execute()
            except Exception:
                logger.warning("Badge check failed for user %s", user_id, exc_info=True)
    except Exception:
        logger.warning("Failed to check badges for market %s participants", market_id, exc_info=True)


def apply_transition_rules(market_row: dict[str, Any], now: datetime) -> list[TransitionRule]:
    status = market_row.get("status")
    if status == "denied":
        return []

    rules: list[TransitionRule] = []

    if status == "pending_review":
        close_at = _parse_dt(market_row.get("close_at"))
        if close_at and close_at <= now:
            rules.append(TransitionRule(trigger="pending_review_expired_auto_close"))

    elif status == "open":
        close_at = _parse_dt(market_row.get("close_at"))
        if close_at and close_at <= now:
            rules.append(TransitionRule(trigger="close_at_elapsed"))

    elif status == "pending_resolution":
        dispute_deadline = _parse_dt(market_row.get("dispute_deadline"))
        resolution_window_end = _parse_dt(market_row.get("resolution_window_end"))
        if market_row.get("proposed_outcome") and dispute_deadline and dispute_deadline <= now:
            rules.append(TransitionRule(trigger="dispute_deadline_elapsed_finalize_creator"))
        elif (not market_row.get("proposed_outcome")) and resolution_window_end and resolution_window_end <= now:
            rules.append(TransitionRule(trigger="community_resolution_window_elapsed", requires_community_tally=True))

    elif status == "disputed":
        rules.append(TransitionRule(trigger="dispute_voting_deadline_check", requires_dispute_lookup=True))

    return rules


def _execute_close_transition(supabase: Client, market: dict[str, Any], now: datetime) -> dict[str, Any]:
    updated = (
        supabase.table("markets")
        .update({"status": "closed"})
        .eq("id", market["id"])
        .execute()
    )
    if updated.data:
        market = updated.data[0]
    _log_transition(market["id"], "open", "closed", "close_at_elapsed", now)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(notify_market_closed(supabase, market))
    except RuntimeError:
        asyncio.run(notify_market_closed(supabase, market))

    return market


def _execute_pending_review_expired_auto_close_transition(
    supabase: Client,
    market: dict[str, Any],
    now: datetime,
) -> dict[str, Any]:
    auto_deny_notes = (
        "Market expired before review. Sorry we could not review your market in time. "
        "For best results, propose markets at least 72 hours before close time."
    )
    transitioned = False
    reviewer_id = market.get("reviewed_by") or market.get("creator_id")

    # Prefer SECURITY DEFINER RPC so auto-deny works even when row-level updates are blocked.
    if reviewer_id:
        try:
            supabase.rpc(
                "deny_market",
                {
                    "p_market_id": market["id"],
                    "p_admin_id": reviewer_id,
                    "p_notes": auto_deny_notes,
                },
            ).execute()
            transitioned = True
        except Exception:
            logger.warning(
                "deny_market RPC failed during auto-deny for market %s",
                market["id"],
                exc_info=True,
            )

    if not transitioned:
        updated = (
            supabase.table("markets")
            .update(
                {
                    "status": "denied",
                    "review_date": now.isoformat(),
                    "review_notes": auto_deny_notes,
                }
            )
            .eq("id", market["id"])
            .eq("status", "pending_review")
            .execute()
        )
        transitioned = bool(updated.data)

    if transitioned:
        refreshed = supabase.table("markets").select("*").eq("id", market["id"]).single().execute()
        if refreshed.data:
            market = refreshed.data
        _log_transition(
            market["id"],
            "pending_review",
            "denied",
            "pending_review_close_at_elapsed_auto_close",
            now,
        )

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(notify_market_denied(supabase, market, auto_deny_notes))
        except RuntimeError:
            try:
                asyncio.run(notify_market_denied(supabase, market, auto_deny_notes))
            except Exception:
                logger.warning(
                    "Failed to send auto-denied notification for market %s",
                    market["id"],
                    exc_info=True,
                )
        except Exception:
            logger.warning(
                "Failed to send auto-denied notification for market %s",
                market["id"],
                exc_info=True,
            )
    return market


def _execute_finalize_creator_transition(supabase: Client, market: dict[str, Any], now: datetime) -> dict[str, Any]:
    from_status = market.get("status")
    outcome = market.get("proposed_outcome")
    supabase.rpc(
        "finalize_resolution",
        {
            "p_market_id": market["id"],
            "p_outcome": outcome,
        },
    ).execute()
    market["status"] = "resolved"
    market["resolved_outcome"] = outcome
    _check_badges_for_market_participants(supabase, market["id"])
    _log_transition(market["id"], from_status, "resolved", "dispute_deadline_elapsed_finalize_creator", now)
    return market


def _execute_disputed_tally_transition(supabase: Client, market: dict[str, Any], now: datetime) -> dict[str, Any]:
    dispute = (
        supabase.table("disputes")
        .select("id, voting_deadline")
        .eq("market_id", market["id"])
        .single()
        .execute()
    )
    if not dispute.data:
        return market

    voting_deadline = _parse_dt(dispute.data.get("voting_deadline"))
    if not voting_deadline or voting_deadline > now:
        return market

    votes = (
        supabase.table("resolution_votes")
        .select("selected_outcome")
        .eq("dispute_id", dispute.data["id"])
        .execute()
    )
    yes_count = sum(1 for v in (votes.data or []) if v["selected_outcome"] == "YES")
    no_count = sum(1 for v in (votes.data or []) if v["selected_outcome"] == "NO")
    total = yes_count + no_count

    if total >= DISPUTE_VOTE_QUORUM and yes_count != no_count:
        winning = "YES" if yes_count > no_count else "NO"
        supabase.rpc(
            "finalize_resolution",
            {
                "p_market_id": market["id"],
                "p_outcome": winning,
            },
        ).execute()
        market["status"] = "resolved"
        market["resolved_outcome"] = winning
        _check_badges_for_market_participants(supabase, market["id"])
        _log_transition(market["id"], "disputed", "resolved", "dispute_voting_deadline_elapsed", now)
    else:
        supabase.table("markets").update({"status": "admin_review"}).eq("id", market["id"]).execute()
        market["status"] = "admin_review"
        _log_transition(market["id"], "disputed", "admin_review", "dispute_voting_deadline_elapsed", now)

    return market


def _execute_community_tally_transition(supabase: Client, market: dict[str, Any], now: datetime) -> dict[str, Any]:
    votes = (
        supabase.table("community_votes")
        .select("selected_outcome")
        .eq("market_id", market["id"])
        .execute()
    )
    yes_votes = sum(1 for v in (votes.data or []) if v["selected_outcome"] == "YES")
    no_votes = sum(1 for v in (votes.data or []) if v["selected_outcome"] == "NO")
    total_votes = yes_votes + no_votes

    if total_votes >= COMMUNITY_VOTE_QUORUM and yes_votes != no_votes:
        winning = "YES" if yes_votes > no_votes else "NO"
        supabase.rpc(
            "finalize_resolution",
            {
                "p_market_id": market["id"],
                "p_outcome": winning,
            },
        ).execute()
        market["status"] = "resolved"
        market["resolved_outcome"] = winning

        supabase.rpc(
            "distribute_voter_rewards",
            {
                "p_market_id": market["id"],
                "p_winning_outcome": winning,
            },
        ).execute()
        _check_badges_for_market_participants(supabase, market["id"])
        _log_transition(market["id"], "pending_resolution", "resolved", "community_resolution_window_elapsed", now)
    else:
        supabase.table("markets").update({"status": "admin_review"}).eq("id", market["id"]).execute()
        market["status"] = "admin_review"
        _log_transition(market["id"], "pending_resolution", "admin_review", "community_resolution_window_elapsed", now)

    return market


def normalize_market_state(
    supabase: Client,
    market_id: str,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    result = supabase.table("markets").select("*").eq("id", market_id).single().execute()
    market = result.data
    if not market:
        return None

    effective_now = now or datetime.now(tz=UTC)
    rules = apply_transition_rules(market, effective_now)

    for rule in rules:
        try:
            if rule.trigger == "pending_review_expired_auto_close":
                market = _execute_pending_review_expired_auto_close_transition(supabase, market, effective_now)
            elif rule.trigger == "close_at_elapsed":
                market = _execute_close_transition(supabase, market, effective_now)
            elif rule.trigger == "dispute_deadline_elapsed_finalize_creator":
                market = _execute_finalize_creator_transition(supabase, market, effective_now)
            elif rule.trigger == "dispute_voting_deadline_check":
                market = _execute_disputed_tally_transition(supabase, market, effective_now)
            elif rule.trigger == "community_resolution_window_elapsed":
                market = _execute_community_tally_transition(supabase, market, effective_now)
        except Exception:
            logger.warning(
                "market_transition_failed market_id=%s trigger=%s timestamp=%s",
                market_id,
                rule.trigger,
                effective_now.isoformat(),
                exc_info=True,
            )

    refreshed = supabase.table("markets").select("*").eq("id", market_id).single().execute()
    return refreshed.data or market


def normalize_markets(
    supabase: Client,
    market_ids: list[str] | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    if market_ids:
        result = supabase.table("markets").select("*").in_("id", market_ids).execute()
        markets = result.data or []
    else:
        result = (
            supabase.table("markets")
            .select("*")
            .in_("status", ["pending_review", "open", "pending_resolution", "disputed"])
            .execute()
        )
        markets = result.data or []

    effective_now = now or datetime.now(tz=UTC)
    normalized_by_id: dict[str, dict[str, Any]] = {}

    for market in markets:
        normalized_by_id[market["id"]] = market
        rules = apply_transition_rules(market, effective_now)
        if not rules:
            continue
        normalized_market = normalize_market_state(supabase, market["id"], now=effective_now)
        if normalized_market:
            normalized_by_id[market["id"]] = normalized_market

    if market_ids:
        return [normalized_by_id[mid] for mid in market_ids if mid in normalized_by_id]
    return list(normalized_by_id.values())
