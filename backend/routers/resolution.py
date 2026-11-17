from typing import Annotated

from fastapi import APIRouter, Depends
from postgrest.exceptions import APIError

from dependencies import (
    get_current_user,
    get_current_user_optional,
    get_supabase_client,
)
from observability import AppError, ErrorCode
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
        raise AppError(404, ErrorCode.MARKET_NOT_FOUND, "Market not found.")
    if market.get("status") != "pending_resolution" or market.get("proposed_outcome") is not None:
        raise AppError(400, ErrorCode.MARKET_NOT_PENDING_RESOLUTION, "Market is not in community resolution.")

    try:
        result = supabase.rpc("cast_community_vote", {
            "p_market_id": market_id,
            "p_voter_id": current_user["id"],
            "p_vote": body.vote,
        }).execute()
        return result.data
    except APIError as e:
        msg = e.message.lower() if e.code == "P0001" else ""
        extras = {"market_id": market_id, "vote": body.vote}
        if "not in the resolution" in msg:
            raise AppError(
                400,
                ErrorCode.MARKET_NOT_PENDING_RESOLUTION,
                'Market is not in the resolution period.',
                original=e,
                extras=extras,
            ) from e
        if "expired" in msg:
            raise AppError(
                409,
                ErrorCode.RESOLUTION_WINDOW_EXPIRED,
                'Resolution voting window has expired.',
                original=e,
                extras=extras,
            ) from e
        if e.code == "23505" or "unique" in msg or "duplicate" in msg:
            raise AppError(
                409,
                ErrorCode.COMMUNITY_VOTE_DUPLICATE,
                "You have already voted on this market's resolution.",
                original=e,
                extras=extras,
            ) from e
        if "creator" in msg:
            raise AppError(
                403,
                ErrorCode.COMMUNITY_VOTE_CREATOR_RESTRICTED,
                'Market creators cannot cast community votes on their own market.',
                original=e,
                extras=extras,
            ) from e
        raise AppError(500, ErrorCode.INTERNAL_ERROR, "Failed to cast vote.", original=e, extras=extras) from e


@router.get("/{market_id}/community-votes")
async def list_community_votes(
    market_id: str,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    _current_user: Annotated[dict | None, Depends(get_current_user_optional)],
):
    """List all community resolution votes for a market."""
    try:
        result = (
            supabase.table("community_votes")
            .select("*")
            .eq("market_id", market_id)
            .order("created_at")
            .execute()
        )
    except Exception as exc:
        raise AppError(
            500,
            ErrorCode.INTERNAL_ERROR,
            'Failed to load community votes.',
            original=exc,
            extras={'market_id': market_id},
        ) from exc
    return result.data or []
