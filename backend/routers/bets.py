import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from dependencies import (
    get_current_user,
    get_current_user_optional,
    get_supabase_client,
)
from schemas.bet import (
    BetResponse,
    PlaceBetRequest,
    PlaceBetResponse,
    PlaceMultichoiceBetRequest,
)
from supabase import Client

logger = logging.getLogger(__name__)


def _check_badges_safe(supabase: Client, user_id: str) -> None:
    """Fire-and-forget badge check; never let it break the main flow."""
    try:
        supabase.rpc("check_and_award_badges", {"p_user_id": user_id}).execute()
    except Exception:
        logger.warning("Badge check failed for user %s", user_id, exc_info=True)

router = APIRouter(prefix="/api/markets", tags=["bets"])


@router.post(
    "/{market_id}/bets",
    response_model=PlaceBetResponse,
    status_code=status.HTTP_201_CREATED,
)
async def place_bet(
    market_id: str,
    body: PlaceBetRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
):
    """
    Place a YES or NO bet on a market.

    Uses a PostgreSQL function (place_bet) that atomically validates the
    user's balance, checks that the market is open, deducts the balance,
    updates the pool, and records both the bet and the transaction.
    """
    try:
        result = supabase.rpc(
            "place_bet",
            {
                "p_user_id": current_user["id"],
                "p_market_id": market_id,
                "p_side": body.side,
                "p_amount": body.amount,
            },
        ).execute()
    except Exception as exc:
        detail = str(exc)
        if "creators cannot place bets" in detail.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot bet on a market you created.",
            ) from exc
        if "Insufficient balance" in detail:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Insufficient banana balance",
            ) from exc
        if "Market is not open" in detail or "Market has closed" in detail:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Market is not open for betting",
            ) from exc
        if "not found" in detail.lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Market or user not found",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to place bet",
        ) from exc

    _check_badges_safe(supabase, current_user["id"])

    return result.data


@router.post(
    "/{market_id}/bets/option",
    response_model=PlaceBetResponse,
    status_code=status.HTTP_201_CREATED,
)
async def place_multichoice_bet(
    market_id: str,
    body: PlaceMultichoiceBetRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
):
    try:
        result = supabase.rpc(
            "place_multichoice_bet",
            {
                "p_user_id": current_user["id"],
                "p_market_id": market_id,
                "p_option_id": body.option_id,
                "p_amount": body.amount,
            },
        ).execute()
    except Exception as exc:
        detail = str(exc)
        if "Insufficient balance" in detail:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Insufficient banana balance",
            ) from exc
        if "Market is not open" in detail:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Market is not open for betting",
            ) from exc
        if "not found" in detail.lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Market, option, or user not found",
            ) from exc
        if "not multichoice" in detail.lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Market is not a multichoice market",
            ) from exc
        if "does not belong" in detail.lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Option does not belong to this market",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to place bet",
        ) from exc

    _check_badges_safe(supabase, current_user["id"])

    return result.data


@router.get("/{market_id}/bets", response_model=list[BetResponse])
async def list_bets_for_market(
    market_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    *,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    _current_user: Annotated[dict | None, Depends(get_current_user_optional)],
):
    """List recent bets for a market (activity feed)."""
    result = (
        supabase.table("bets")
        .select("*")
        .eq("market_id", market_id)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )

    return result.data or []
