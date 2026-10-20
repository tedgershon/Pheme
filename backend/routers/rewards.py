from typing import Annotated

from fastapi import APIRouter, Depends

from dependencies import get_current_user, get_supabase_client
from supabase import Client

router = APIRouter(prefix="/api", tags=["rewards"])

TRACK_META = {
    "banana_baron": {
        "display_name": "Banana Baron",
        "description": "Grow your banana empire by accumulating coins in your balance",
    },
    "oracle": {
        "display_name": "Oracle",
        "description": "Prove your foresight by correctly predicting market outcomes",
    },
    "architect": {
        "display_name": "Architect",
        "description": "Shape the platform by creating markets the community loves",
    },
    "degen": {
        "display_name": "Degen",
        "description": "Go all-in by placing bets across markets of your choosing",
    },
    "whale": {
        "display_name": "Whale",
        "description": "Make waves by placing massive single bets on the markets",
    },
}


def _get_user_stats(supabase: Client, user_id: str) -> dict[str, float]:
    """Compute live stats for badge progress display.

    Delegates to the get_user_badge_stats RPC so the five track values are
    returned in a single round-trip instead of four separate queries. See
    migration 054_fn_leaderboard_and_stats.sql.
    """
    result = supabase.rpc(
        "get_user_badge_stats",
        {"p_user_id": user_id},
    ).execute()
    row = (result.data or [{}])[0] if result.data else {}

    return {
        "banana_baron": float(row.get("banana_baron") or 0),
        "oracle": int(row.get("oracle") or 0),
        "architect": int(row.get("architect") or 0),
        "degen": int(row.get("degen") or 0),
        "whale": float(row.get("whale") or 0),
    }


def _build_track_progress(
    definitions: list[dict],
    earned: list[dict],
    stats: dict[str, float],
) -> list[dict]:
    """Build per-track progress data for the rewards page."""
    earned_by_track = {b["track"]: b for b in earned}

    tracks_map: dict[str, list[dict]] = {}
    for d in definitions:
        tracks_map.setdefault(d["track"], []).append(d)

    result = []
    for track_key in ("banana_baron", "oracle", "architect", "degen", "whale"):
        tiers = sorted(tracks_map.get(track_key, []), key=lambda t: t["tier"])
        meta = TRACK_META.get(track_key, {})
        current_value = stats.get(track_key, 0)

        earned_badge = earned_by_track.get(track_key)
        earned_tier = int(earned_badge["tier"]) if earned_badge else 0
        value_tier = max(
            (int(t["tier"]) for t in tiers if current_value >= float(t["threshold"])),
            default=0,
        )
        current_tier = max(earned_tier, value_tier)

        next_threshold = None
        for t in tiers:
            if t["tier"] > current_tier:
                next_threshold = float(t["threshold"])
                break

        result.append({
            "track": track_key,
            "track_display_name": meta.get("display_name", track_key),
            "track_description": meta.get("description", ""),
            "current_value": current_value,
            "next_threshold": next_threshold,
            "current_tier": current_tier,
            "max_tier": max((t["tier"] for t in tiers), default=5),
            "tiers": tiers,
        })

    return result


@router.get("/rewards")
async def get_user_rewards(
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
):
    """Get the user's badge progress across all tracks."""
    # Ensure tier state is up-to-date before returning rewards/progress.
    supabase.rpc("check_and_award_badges", {
        "p_user_id": current_user["id"],
    }).execute()

    definitions = (
        supabase.table("badge_definitions")
        .select("*")
        .order("track")
        .order("tier")
        .execute()
    )

    earned = (
        supabase.table("user_badges")
        .select("*, badge_definitions(*)")
        .eq("user_id", current_user["id"])
        .execute()
    )

    stats = _get_user_stats(supabase, current_user["id"])

    return {
        "tracks": _build_track_progress(
            definitions.data or [],
            earned.data or [],
            stats,
        ),
        "badges": earned.data or [],
    }


@router.get("/rewards/badges/{user_id}")
async def get_user_badges(
    user_id: str,
    supabase: Annotated[Client, Depends(get_supabase_client)],
):
    """Get badges for any user (for leaderboard display)."""
    result = (
        supabase.table("user_badges")
        .select("*, badge_definitions(*)")
        .eq("user_id", user_id)
        .execute()
    )
    return result.data or []


@router.post("/rewards/check")
async def check_badges(
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
):
    """Manually trigger badge check for current user."""
    result = supabase.rpc("check_and_award_badges", {
        "p_user_id": current_user["id"],
    }).execute()
    return {"new_badges": result.data or []}
