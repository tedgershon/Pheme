from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError

from dependencies import (
    get_current_user,
    get_current_user_optional,
    get_supabase_client,
)
from observability import report_and_safe_message
from schemas.dispute import CastVoteRequest
from services.market_state_machine import normalize_market_state, normalize_markets
from supabase import Client

router = APIRouter(prefix="/api/markets", tags=["resolution"])


@router.get("/resolutions")
async def list_resolution_markets(
    supabase: Annotated[Client, Depends(get_supabase_client)],
    _current_user: Annotated[dict | None, Depends(get_current_user_optional)],
):
    """List all markets in community resolution or dispute status."""
    normalize_markets(supabase)

    community_result = (
        supabase.table("markets")
        .select("*")
        .eq("status", "pending_resolution")
        .order("created_at", desc=True)
        .execute()
    )

    disputed_result = (
        supabase.table("markets")
        .select("*")
        .eq("status", "disputed")
        .order("created_at", desc=True)
        .execute()
    )
    disputed_markets = disputed_result.data or []
    enriched_disputed: list[dict] = []
    if disputed_markets:
        market_ids = [m["id"] for m in disputed_markets]
        disputes_result = (
            supabase.table("disputes")
            .select("market_id, voting_deadline")
            .in_("market_id", market_ids)
            .execute()
        )
        deadline_by_market = {
            d["market_id"]: d["voting_deadline"] for d in (disputes_result.data or [])
        }
        for market in disputed_markets:
            deadline = deadline_by_market.get(market["id"])
            market["voting_ends_at"] = deadline
            enriched_disputed.append(market)

    return (community_result.data or []) + enriched_disputed


@router.post("/{market_id}/community-vote")
async def cast_community_vote(
    market_id: str,
    body: CastVoteRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
):
    """Cast a community resolution vote during the 24h resolution window."""
    market = normalize_market_state(supabase, market_id)
    if not market:
        raise HTTPException(404, "Market not found.")
    if market.get("status") != "pending_resolution" or market.get("proposed_outcome") is not None:
        raise HTTPException(400, "Market is not in community resolution.")

    try:
        result = supabase.rpc("cast_community_vote", {
            "p_market_id": market_id,
            "p_voter_id": current_user["id"],
            "p_vote": body.vote,
        }).execute()
        return result.data
    except APIError as e:
        msg = e.message.lower() if e.code == "P0001" else ""
        if "not in the resolution" in msg:
            raise HTTPException(400, "Market is not in the resolution period.")
        if "expired" in msg:
            raise HTTPException(400, "Resolution voting window has expired.")
        if e.code == "23505" or "unique" in msg or "duplicate" in msg:
            raise HTTPException(409, "You have already voted on this market's resolution.")
        if "creator" in msg:
            raise HTTPException(403, "Market creators cannot cast community votes on their own market.")
        raise HTTPException(500, report_and_safe_message(e, "Failed to cast vote."))


@router.get("/{market_id}/community-votes")
async def list_community_votes(
    market_id: str,
    supabase: Annotated[Client, Depends(get_supabase_client)],
):
    """List all community resolution votes for a market."""
    result = (
        supabase.table("community_votes")
        .select("*")
        .eq("market_id", market_id)
        .order("created_at")
        .execute()
    )
    return result.data or []
