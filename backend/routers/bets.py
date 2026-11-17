import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from postgrest.exceptions import APIError

from dependencies import (
    get_current_user,
    get_current_user_optional,
    get_supabase_client,
)
from observability import AppError, ErrorCode
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
    except APIError as exc:
        detail = exc.message if exc.code == "P0001" else ""
        if "creators cannot place bets" in detail.lower():
            raise AppError(
                status.HTTP_403_FORBIDDEN,
                ErrorCode.BET_CREATOR_RESTRICTED,
                'You cannot bet on a market you created.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        if "Insufficient balance" in detail:
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.BET_INSUFFICIENT_BALANCE,
                'Insufficient banana balance.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        if "Market has closed" in detail:
            raise AppError(
                409,
                ErrorCode.MARKET_CLOSE_DATE_PASSED,
                'Market has closed.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        if "Market is not open" in detail:
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.MARKET_NOT_OPEN,
                'Market is not open for betting.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        if "amount must be positive" in detail.lower():
            raise AppError(
                400,
                ErrorCode.BET_INVALID_AMOUNT,
                'Bet amount must be positive.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        if "not found" in detail.lower():
            raise AppError(
                status.HTTP_404_NOT_FOUND,
                ErrorCode.NOT_FOUND,
                'Market or user not found.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        raise AppError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            ErrorCode.INTERNAL_ERROR,
            'Failed to place bet.',
            original=exc,
            extras={'market_id': market_id},
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
    except APIError as exc:
        detail = exc.message if exc.code == "P0001" else ""
        if "creators cannot" in detail:
            raise AppError(
                403,
                ErrorCode.BET_CREATOR_RESTRICTED,
                'Market creators cannot place bets on their own markets.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        if "Market has closed" in detail:
            raise AppError(
                409,
                ErrorCode.MARKET_CLOSE_DATE_PASSED,
                'Market has closed.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        if "Insufficient balance" in detail:
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.BET_INSUFFICIENT_BALANCE,
                'Insufficient banana balance.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        if "Market is not open" in detail:
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.MARKET_NOT_OPEN,
                'Market is not open for betting.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        if "amount must be positive" in detail.lower():
            raise AppError(
                400,
                ErrorCode.BET_INVALID_AMOUNT,
                'Bet amount must be positive.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        if "option not found" in detail.lower():
            raise AppError(
                400,
                ErrorCode.BET_INVALID_OPTION,
                'Invalid market option.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        if "not found" in detail.lower():
            raise AppError(
                status.HTTP_404_NOT_FOUND,
                ErrorCode.NOT_FOUND,
                'Market, option, or user not found.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        if "not multichoice" in detail.lower():
            raise AppError(
                status.HTTP_400_BAD_REQUEST,
                ErrorCode.MARKET_NOT_MULTICHOICE,
                'Market is not a multichoice market.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        if "does not belong" in detail.lower():
            raise AppError(
                status.HTTP_400_BAD_REQUEST,
                ErrorCode.BET_INVALID_OPTION,
                'Option does not belong to this market.',
                original=exc,
                extras={'market_id': market_id},
            ) from exc
        raise AppError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            ErrorCode.INTERNAL_ERROR,
            'Failed to place bet.',
            original=exc,
            extras={'market_id': market_id},
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
