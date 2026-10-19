import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from supabase import Client

from dependencies import get_supabase_client, get_supabase_service_client, get_user_token, require_admin, require_super_admin, user_auth
from notification_service import notify_market_approved, notify_market_denied, send_resolution_reminders_for_closed_markets
from schemas.admin import (
    BackrollRequest,
    StatsResponse,
    UpdateRoleRequest,
    UpdateRoleResponse,
    UserSearchResult,
)
from schemas.market import ReviewMarketRequest
from services.market_state_machine import normalize_market_state, normalize_markets

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])
EASTERN_TZ = ZoneInfo("America/New_York")


@router.post("/markets/resolution-reminders/run")
async def run_resolution_reminders(
    _current_user: dict = Depends(require_admin),
    supabase: Client = Depends(get_supabase_client),
):
    """Run reminder dispatch for unresolved closed markets (admin-only trigger)."""
    reminders_sent = await send_resolution_reminders_for_closed_markets(supabase)
    return {"status": "ok", "reminders_sent": reminders_sent}


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _to_eastern(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(EASTERN_TZ)


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    _current_user: dict = Depends(require_admin),
    supabase: Client = Depends(get_supabase_client),
):
    """Return cumulative platform statistics (admin only)."""
    profiles = supabase.table("profiles").select("role").execute()
    users_by_role: dict[str, int] = {}
    for row in profiles.data or []:
        r = row.get("role", "user")
        users_by_role[r] = users_by_role.get(r, 0) + 1
    total_users = sum(users_by_role.values())

    markets_data = supabase.table("markets").select("status").execute()
    markets_by_status: dict[str, int] = {}
    for row in markets_data.data or []:
        s = row.get("status", "open")
        markets_by_status[s] = markets_by_status.get(s, 0) + 1
    total_markets = sum(markets_by_status.values())

    txn_data = (
        supabase.table("transactions")
        .select("amount")
        .eq("transaction_type", "bet_placement")
        .execute()
    )
    total_banana_traded = sum(abs(row["amount"]) for row in (txn_data.data or []))

    active_statuses = ("open", "closed", "pending_resolution", "disputed")
    bets_data = (
        supabase.table("bets")
        .select("id, market_id, markets!inner(status)")
        .in_("markets.status", list(active_statuses))
        .execute()
    )
    total_active_bets = len(bets_data.data or [])

    return StatsResponse(
        total_users=total_users,
        users_by_role=users_by_role,
        total_markets=total_markets,
        markets_by_status=markets_by_status,
        total_banana_traded=total_banana_traded,
        total_active_bets=total_active_bets,
    )


@router.get("/users/search", response_model=list[UserSearchResult])
async def search_users(
    q: str = Query(..., min_length=1),
    _current_user: dict = Depends(require_super_admin),
    supabase: Client = Depends(get_supabase_client),
):
    """Search users by andrew_id (super admin only)."""
    result = (
        supabase.table("profiles")
        .select("id, andrew_id, display_name, role, created_at")
        .ilike("andrew_id", f"%{q}%")
        .limit(20)
        .execute()
    )
    return result.data or []


@router.put("/users/{user_id}/role", response_model=UpdateRoleResponse)
async def update_user_role(
    user_id: str,
    body: UpdateRoleRequest,
    current_user: dict = Depends(require_super_admin),
    supabase: Client = Depends(get_supabase_client),
    token: str | None = Depends(get_user_token),
):
    """Change a user's role (super admin only)."""
    if user_id == current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change your own role.",
        )

    if body.role not in ("user", "admin"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role must be 'user' or 'admin'.",
        )

    target = (
        supabase.table("profiles")
        .select("id")
        .eq("id", user_id)
        .single()
        .execute()
    )
    if not target.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    with user_auth(supabase, token):
        result = (
            supabase.table("profiles")
            .update({"role": body.role})
            .eq("id", user_id)
            .execute()
        )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update role.",
        )

    return result.data[0]


@router.post("/markets/{market_id}/backroll")
async def backroll_market(
    market_id: str,
    body: BackrollRequest,
    current_user: dict = Depends(require_admin),
    supabase: Client = Depends(get_supabase_client),
):
    """Admin backroll: cancel bets placed after a cutoff date and refund bettors."""
    try:
        result = supabase.rpc("admin_backroll_market", {
            "p_market_id": market_id,
            "p_admin_id": current_user["id"],
            "p_cutoff_date": body.cutoff_date.isoformat(),
            "p_close_market": body.close_market,
        }).execute()
        return result.data
    except Exception as e:
        msg = str(e).lower()
        if "not found" in msg:
            raise HTTPException(status_code=404, detail="Market not found.")
        if "resolved" in msg:
            raise HTTPException(status_code=400, detail="Cannot backroll a resolved market.")
        raise HTTPException(status_code=500, detail=f"Backroll failed: {e}")


@router.get("/markets/review")
async def list_markets_for_review(
    _current_user: dict = Depends(require_admin),
    supabase: Client = Depends(get_supabase_client),
):
    """List all markets organized by review status."""
    state_client = get_supabase_service_client() or supabase
    pending_for_normalization = (
        supabase.table("markets")
        .select("id")
        .eq("status", "pending_review")
        .execute()
    )
    pending_ids = [row["id"] for row in (pending_for_normalization.data or []) if row.get("id")]
    if pending_ids:
        try:
            normalize_markets(state_client, market_ids=pending_ids)
        except Exception:
            logger.warning("Failed to normalize pending markets before review listing", exc_info=True)

    review_select = "*, profiles!creator_id(andrew_id, display_name), reviewer:profiles!reviewed_by(andrew_id, display_name)"

    pending = (
        supabase.table("markets")
        .select(review_select)
        .eq("status", "pending_review")
        .order("created_at", desc=False)
        .execute()
    )

    approved = (
        supabase.table("markets")
        .select(review_select)
        .eq("status", "open")
        .not_.is_("reviewed_by", "null")
        .order("review_date", desc=True)
        .limit(50)
        .execute()
    )

    denied = (
        supabase.table("markets")
        .select(review_select)
        .eq("status", "denied")
        .order("review_date", desc=True)
        .limit(50)
        .execute()
    )

    return {
        "pending": pending.data or [],
        "approved": approved.data or [],
        "denied": denied.data or [],
    }


@router.post("/markets/{market_id}/review")
async def review_market(
    market_id: str,
    body: ReviewMarketRequest,
    current_user: dict = Depends(require_admin),
    supabase: Client = Depends(get_supabase_client),
):
    """Admin reviews a proposed market — approve or deny."""
    state_client = get_supabase_service_client() or supabase
    market = normalize_market_state(state_client, market_id)
    if not market:
        raise HTTPException(status_code=404, detail="Market not found.")

    if market.get("status") != "pending_review":
        raise HTTPException(status_code=400, detail="Market is not pending review.")

    close_at = _parse_dt(market.get("close_at"))
    if close_at and close_at <= datetime.now(tz=timezone.utc):
        raise HTTPException(
            status_code=400,
            detail="Market close date has passed. Pending markets are automatically denied and can no longer be updated.",
        )

    updates = {}
    for field in ("title", "description", "resolution_criteria", "close_at", "category", "link"):
        val = getattr(body, field, None)
        if val is not None:
            if field == "close_at":
                updates[field] = _to_eastern(val).isoformat()
            else:
                updates[field] = val

    if updates:
        supabase.table("markets").update(updates).eq("id", market_id).execute()

    if body.action == "approve":
        try:
            result = supabase.rpc("approve_market", {
                "p_market_id": market_id,
                "p_admin_id": current_user["id"],
                "p_notes": body.notes,
            }).execute()
        except Exception as e:
            msg = str(e).lower()
            if "not found" in msg:
                raise HTTPException(status_code=404, detail="Market not found.")
            if "not pending" in msg:
                raise HTTPException(status_code=400, detail="Market is not pending review.")
            if "close date has passed" in msg:
                raise HTTPException(
                    status_code=400,
                    detail="Market close date has passed. Pending markets are automatically denied and can no longer be updated.",
                )
            raise HTTPException(status_code=500, detail=f"Failed to approve market: {e}")
    else:
        notes = (body.notes or "").strip()
        if not notes:
            raise HTTPException(status_code=400, detail="Notes are required when denying a market.")

        result = (
            supabase.table("markets")
            .update(
                {
                    "status": "closed",
                    "reviewed_by": current_user["id"],
                    "review_date": datetime.now(tz=timezone.utc).isoformat(),
                    "review_notes": notes,
                }
            )
            .eq("id", market_id)
            .eq("status", "pending_review")
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=400, detail="Market is not pending review.")

    market = supabase.table("markets").select("*").eq("id", market_id).single().execute()

    if body.action == "approve":
        try:
            await notify_market_approved(supabase, market.data, body.notes)
        except Exception:
            logger.warning("Failed to send market-approved notification for %s", market_id, exc_info=True)

        try:
            supabase.rpc("check_and_award_badges", {
                "p_user_id": market.data["creator_id"],
            }).execute()
        except Exception:
            logger.warning("Badge check failed for creator %s", market.data["creator_id"], exc_info=True)
    else:
        try:
            await notify_market_denied(supabase, market.data, body.notes or "")
        except Exception:
            logger.warning("Failed to send market-denied notification for %s", market_id, exc_info=True)

    return result.data
