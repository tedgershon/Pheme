from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from dependencies import get_current_user_optional, get_supabase_client
from schemas.user import LeaderboardEntry
from supabase import Client

router = APIRouter(prefix="/api", tags=["leaderboard"])


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
async def get_leaderboard(
    limit: int = Query(25, ge=1, le=100),
    *,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    _current_user: Annotated[dict | None, Depends(get_current_user_optional)],
):
    """Top users ranked by net worth (balance + open stakes on unresolved markets)."""
    result = supabase.rpc(
        "get_networth_leaderboard",
        {"p_limit": limit},
    ).execute()

    return result.data or []


def _get_gains_leaderboard(supabase: Client, since_iso: str | None, limit: int) -> list[dict]:
    """Query net gains via the get_gains_leaderboard RPC.

    Aggregation + top-N + profile join happens in Postgres; we just return
    the rows as-is. See migration 054_fn_leaderboard_and_stats.sql.
    """
    result = supabase.rpc(
        "get_gains_leaderboard",
        {"p_since": since_iso, "p_limit": limit},
    ).execute()
    return result.data or []


@router.get("/leaderboard/weekly")
async def get_weekly_leaderboard(
    limit: int = Query(10, ge=1, le=50),
    *,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    _current_user: Annotated[dict | None, Depends(get_current_user_optional)],
):
    """Top users by rolling 7-day gains from bets."""
    now = datetime.now(tz=UTC)
    seven_days_ago = (now - timedelta(days=7)).isoformat()
    thirty_days_ago = (now - timedelta(days=30)).isoformat()

    result = _get_gains_leaderboard(supabase, seven_days_ago, limit)
    if len(result) >= 5:
        return {"period": "7d", "entries": result}

    result = _get_gains_leaderboard(supabase, thirty_days_ago, limit)
    if len(result) >= 5:
        return {"period": "30d", "entries": result}

    result = _get_gains_leaderboard(supabase, None, limit)
    return {"period": "all_time", "entries": result}
