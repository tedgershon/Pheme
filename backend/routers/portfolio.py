from typing import Annotated

from fastapi import APIRouter, Depends, Query

from dependencies import (
    get_current_user,
    get_supabase_client,
    get_user_token,
    user_auth,
)
from schemas.bet import BetResponse
from schemas.market import MarketResponse
from schemas.transaction import TransactionResponse
from supabase import Client

router = APIRouter(prefix="/api", tags=["portfolio"])


@router.get("/portfolio/proposed-markets", response_model=list[MarketResponse])
async def get_my_proposed_markets(
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """The caller's pending or denied proposals, newest first, for every role."""
    with user_auth(supabase, token):
        result = (
            supabase.table("markets")
            .select("*")
            .eq("creator_id", current_user["id"])
            .in_("status", ["pending_review", "denied"])
            .order("created_at", desc=True)
            .execute()
        )
    return result.data or []


@router.get("/portfolio", response_model=list[BetResponse])
async def get_portfolio(
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Get the authenticated user's positions across all markets."""
    with user_auth(supabase, token):
        result = (
            supabase.table("bets")
            .select("*")
            .eq("user_id", current_user["id"])
            .order("created_at", desc=True)
            .execute()
        )

    return result.data or []


@router.get("/transactions", response_model=list[TransactionResponse])
async def get_transactions(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    *,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Get the authenticated user's transaction history, newest first."""
    with user_auth(supabase, token):
        result = (
            supabase.table("transactions")
            .select("*")
            .eq("user_id", current_user["id"])
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )

    return result.data or []
