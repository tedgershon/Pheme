from typing import Annotated

from fastapi import APIRouter, Depends, Query

from dependencies import (
    get_current_user,
    get_supabase_client,
    get_user_token,
    user_auth,
)
from schemas.bet import BetResponse
from schemas.transaction import TransactionResponse
from supabase import Client

router = APIRouter(prefix="/api", tags=["portfolio"])


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
