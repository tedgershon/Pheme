import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError

from dependencies import (
    get_current_user,
    get_supabase_client,
    get_user_token,
    user_auth,
)
from observability import report_and_safe_message
from schemas.dispute import ClaimResponse
from schemas.user import CreateProfileRequest, UpdateProfileRequest, UserProfileResponse
from supabase import Client

router = APIRouter(prefix="/api/auth", tags=["auth"])

TRACK_KEYS = ("banana_baron", "oracle", "architect", "degen", "whale")
TRACK_SET = set(TRACK_KEYS)
MAX_DISPLAY_NAME_LENGTH = 32
DISPLAY_NAME_ALLOWED_RE = re.compile(r"^[A-Za-z0-9 ._-]+$")


def _sanitize_display_name(raw_name: str) -> str:
    # Collapse repeated whitespace so names render consistently across UI surfaces.
    normalized = " ".join(raw_name.split())
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Display name must not be empty.",
        )
    if len(normalized) > MAX_DISPLAY_NAME_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Display name is too long. "
                f"Please keep it to {MAX_DISPLAY_NAME_LENGTH} characters or fewer."
            ),
        )
    if not DISPLAY_NAME_ALLOWED_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Display name contains unsupported characters. "
                "Use letters, numbers, spaces, periods, underscores, or hyphens."
            ),
        )
    return normalized


@router.get("/me", response_model=UserProfileResponse)
async def get_me(
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
):
    """Return the authenticated user's profile with daily claim status."""
    eligibility = supabase.rpc("check_claim_eligibility", {
        "p_user_id": current_user["id"]
    }).execute()

    claim_info = eligibility.data if eligibility.data else {}
    current_user["claimed_today"] = claim_info.get("claimed_today", False)
    current_user["claim_eligible"] = claim_info.get("eligible", False)
    current_user["claim_amount"] = claim_info.get("claim_amount", 0)
    current_user["above_cap"] = claim_info.get("above_cap", False)
    return current_user


@router.post(
    "/profile",
    response_model=UserProfileResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_or_update_profile(
    body: CreateProfileRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """
    Upsert the profile for the authenticated user.

    Called by the frontend after first Google sign-in to set andrew_id and
    display_name.  If a profile already exists (created by the DB trigger),
    this updates it; otherwise it inserts a new row.
    """
    if not body.andrew_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="andrew_id must not be empty",
        )

    with user_auth(supabase, token):
        result = (
            supabase.table("profiles")
            .upsert(
                {
                    "id": current_user["id"],
                    "andrew_id": body.andrew_id.strip(),
                    "display_name": _sanitize_display_name(body.display_name),
                },
                on_conflict="id",
            )
            .execute()
        )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upsert profile",
        )

    return result.data[0]


@router.patch("/profile", response_model=UserProfileResponse)
async def update_profile(
    body: UpdateProfileRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Update mutable profile fields (display_name, equipped badges, avatar_url)."""
    updates: dict = {}
    fields_set = body.model_fields_set or set()

    if body.display_name is not None:
        updates["display_name"] = _sanitize_display_name(body.display_name)

    equipped_badges: dict[str, str] | None = None
    if body.equipped_badges is not None or "equipped_badges" in fields_set:
        raw_map = body.equipped_badges or {}
        invalid_tracks = [track for track in raw_map if track not in TRACK_SET]
        if invalid_tracks:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid badge track(s): {', '.join(sorted(invalid_tracks))}",
            )

        equipped_badges = {}
        for track, badge_id in raw_map.items():
            if badge_id is None:
                continue
            badge_id = str(badge_id).strip()
            if not badge_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Badge id for track '{track}' must not be empty",
                )
            equipped_badges[track] = badge_id
    elif body.equipped_badge_id is not None:
        # Backward compatibility for older clients that still send one badge id.
        badge_lookup = (
            supabase.table("badge_definitions")
            .select("id, track")
            .eq("id", body.equipped_badge_id)
            .limit(1)
            .execute()
        )
        if not badge_lookup.data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid equipped_badge_id",
            )
        badge_row = badge_lookup.data[0]
        equipped_badges = {badge_row["track"]: badge_row["id"]}
    elif "equipped_badge_id" in fields_set:
        equipped_badges = {}

    if equipped_badges is not None:
        if equipped_badges:
            requested_badge_ids = list(equipped_badges.values())
            badge_defs = (
                supabase.table("badge_definitions")
                .select("id, track, tier")
                .in_("id", requested_badge_ids)
                .execute()
            )
            defs_by_id = {row["id"]: row for row in (badge_defs.data or [])}

            if len(defs_by_id) != len(set(requested_badge_ids)):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="One or more equipped badge ids are invalid",
                )

            for track, badge_id in equipped_badges.items():
                badge_def = defs_by_id[badge_id]
                if badge_def["track"] != track:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            f"Badge {badge_id} belongs to track '{badge_def['track']}', "
                            f"not '{track}'"
                        ),
                    )

            earned = (
                supabase.table("user_badges")
                .select("track, tier")
                .eq("user_id", current_user["id"])
                .in_("track", list(equipped_badges.keys()))
                .execute()
            )
            earned_by_track = {
                row["track"]: int(row["tier"])
                for row in (earned.data or [])
            }

            for track, badge_id in equipped_badges.items():
                badge_tier = int(defs_by_id[badge_id]["tier"])
                if earned_by_track.get(track, 0) < badge_tier:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            f"Cannot equip track '{track}' tier {badge_tier} before earning it"
                        ),
                    )

        updates["equipped_badges"] = equipped_badges

        # Keep legacy single slot populated for older clients.
        preferred_badge_id = next(iter(equipped_badges.values()), None)
        if body.equipped_badge_id is not None and body.equipped_badge_id in equipped_badges.values():
            preferred_badge_id = body.equipped_badge_id
        updates["equipped_badge_id"] = preferred_badge_id

    if body.avatar_url is not None:
        updates["avatar_url"] = body.avatar_url
    elif "avatar_url" in fields_set:
        updates["avatar_url"] = None

    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    with user_auth(supabase, token):
        result = (
            supabase.table("profiles")
            .update(updates)
            .eq("id", current_user["id"])
            .execute()
        )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update profile",
        )

    return result.data[0]


@router.post("/claim-daily", response_model=ClaimResponse)
async def claim_daily_bananas(
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
):
    """Claim daily bananas (up to 1000, capped at 5000 balance)."""
    try:
        result = supabase.rpc("claim_daily_bananas", {
            "p_user_id": current_user["id"],
        }).execute()
        return result.data
    except APIError as e:
        msg = e.message.lower() if e.code == "P0001" else ""
        if "already claimed" in msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already claimed today.")
        if "cap" in msg or "above" in msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Balance is at or above the 5,000 coin daily claim cap.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=report_and_safe_message(e, "Failed to claim."))
