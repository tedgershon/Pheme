import logging
from collections import Counter
from datetime import UTC, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, status
from postgrest.exceptions import APIError

from dependencies import (
    get_supabase_client,
    get_supabase_service_client,
    get_user_token,
    require_admin,
    require_super_admin,
    user_auth,
)
from notification_service import (
    notify_market_approved,
    notify_market_denied,
    send_resolution_reminders_for_closed_markets,
)
from observability import AppError, ErrorCode
from schemas.admin import (
    AdminReviewItem,
    BackrollRequest,
    StatsResponse,
    UpdateRoleRequest,
    UpdateRoleResponse,
    UserSearchResult,
)
from schemas.market import (
    ResolveMarketRequest,
    ResolveMarketResponse,
    ReviewMarketRequest,
)
from services.market_state_machine import normalize_market_state, normalize_markets
from supabase import Client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])
EASTERN_TZ = ZoneInfo("America/New_York")


@router.post("/markets/resolution-reminders/run")
async def run_resolution_reminders(
    _current_user: Annotated[dict, Depends(require_admin)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
):
    """Run reminder dispatch for unresolved closed markets (admin-only trigger)."""
    reminders_sent = await send_resolution_reminders_for_closed_markets(supabase)
    return {"status": "ok", "reminders_sent": reminders_sent}


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


def _to_eastern(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(EASTERN_TZ)


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    _current_user: Annotated[dict, Depends(require_admin)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Return cumulative platform statistics (admin only)."""
    profiles = supabase.table("profiles").select("role").execute()
    users_by_role: dict[str, int] = {}
    for row in profiles.data or []:
        r = row.get("role", "user")
        users_by_role[r] = users_by_role.get(r, 0) + 1
    total_users = sum(users_by_role.values())

    with user_auth(supabase, token):
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
    *,
    _current_user: Annotated[dict, Depends(require_super_admin)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
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
    current_user: Annotated[dict, Depends(require_super_admin)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Change a user's role (super admin only)."""
    if user_id == current_user["id"]:
        raise AppError(
            status.HTTP_400_BAD_REQUEST,
            ErrorCode.ADMIN_CANNOT_CHANGE_OWN_ROLE,
            "Cannot change your own role.",
        )

    if body.role not in ("user", "admin"):
        raise AppError(
            status.HTTP_400_BAD_REQUEST,
            ErrorCode.VALIDATION_FAILED,
            "Role must be 'user' or 'admin'.",
        )

    target = (
        supabase.table("profiles")
        .select("id")
        .eq("id", user_id)
        .single()
        .execute()
    )
    if not target.data:
        raise AppError(
            status.HTTP_404_NOT_FOUND,
            ErrorCode.NOT_FOUND,
            "User not found.",
        )

    with user_auth(supabase, token):
        result = (
            supabase.table("profiles")
            .update({"role": body.role})
            .eq("id", user_id)
            .execute()
        )

    if not result.data:
        raise AppError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            ErrorCode.INTERNAL_ERROR,
            "Failed to update role.",
        )

    return result.data[0]


@router.post("/markets/{market_id}/backroll")
async def backroll_market(
    market_id: str,
    body: BackrollRequest,
    current_user: Annotated[dict, Depends(require_admin)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
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
    except APIError as e:
        msg = e.message.lower() if e.code == "P0001" else ""
        if "not found" in msg:
            raise AppError(404, ErrorCode.MARKET_NOT_FOUND, "Market not found.", original=e) from e
        if "resolved" in msg:
            raise AppError(400, ErrorCode.MARKET_ALREADY_RESOLVED, "Cannot backroll a resolved market.", original=e) from e
        raise AppError(500, ErrorCode.INTERNAL_ERROR, "Backroll failed.", original=e) from e


@router.post(
    "/markets/{market_id}/resolve",
    response_model=ResolveMarketResponse,
    response_model_exclude_none=True,
)
async def admin_resolve_market(
    market_id: str,
    body: ResolveMarketRequest,
    current_user: Annotated[dict, Depends(require_admin)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Admin makes the final YES/NO/AMBIGUOUS call on an admin_review market.

    Settlement, refunds, replay rejection and creator exclusion happen in one SQL
    transaction; the forwarded JWT binds the RPC to this admin.
    """
    with user_auth(supabase, token):
        try:
            result = supabase.rpc("admin_resolve_market", {
                "p_market_id": market_id,
                "p_outcome": body.outcome,
                "p_admin_id": current_user["id"],
            }).execute()
            return result.data
        except APIError as exc:
            msg = exc.message.lower() if exc.code == "P0001" else ""
            if "not found" in msg:
                raise AppError(404, ErrorCode.MARKET_NOT_FOUND, "Market not found.", original=exc) from exc
            if "already resolved" in msg:
                raise AppError(400, ErrorCode.MARKET_ALREADY_RESOLVED, "Market is already resolved.", original=exc) from exc
            if "admin_review" in msg:
                raise AppError(400, ErrorCode.MARKET_NOT_ADMIN_REVIEW, "Market is not in admin review.", original=exc) from exc
            if "creators cannot resolve" in msg:
                raise AppError(
                    403,
                    ErrorCode.ADMIN_RESOLUTION_CREATOR_RESTRICTED,
                    "You cannot resolve a market you created.",
                    original=exc,
                ) from exc
            if "binary market" in msg:
                raise AppError(
                    400,
                    ErrorCode.MARKET_NOT_BINARY,
                    "Multiple-choice markets can only be resolved as ambiguous here.",
                    original=exc,
                ) from exc
            if "only admins" in msg:
                raise AppError(403, ErrorCode.ADMIN_REQUIRED, "Admin access required.", original=exc) from exc
            raise AppError(500, ErrorCode.INTERNAL_ERROR, "Failed to resolve market.", original=exc) from exc


@router.get("/markets/admin-review", response_model=list[AdminReviewItem])
async def list_admin_review_queue(
    _current_user: Annotated[dict, Depends(require_admin)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Escalated markets awaiting an admin decision, oldest close date first."""
    with user_auth(supabase, token):
        try:
            # Expired dispute/community windows escalate lazily; apply them before listing.
            normalize_markets(get_supabase_service_client() or supabase)
        except Exception:
            logger.warning("Failed to normalize markets before admin-review listing", exc_info=True)

        markets = (
            supabase.table("markets")
            .select("*, creator:profiles!creator_id(andrew_id, display_name)")
            .eq("status", "admin_review")
            .order("close_at", desc=False)
            .execute()
        ).data or []
        market_ids = [market["id"] for market in markets]
        if not market_ids:
            return []

        disputes = (
            supabase.table("disputes")
            .select("id, market_id, explanation, voting_deadline, created_at, "
                    "disputer:profiles!disputer_id(andrew_id, display_name)")
            .in_("market_id", market_ids)
            .execute()
        ).data or []
        dispute_votes = (
            supabase.table("resolution_votes")
            .select("market_id, selected_outcome")
            .in_("market_id", market_ids)
            .execute()
        ).data or []
        community_votes = (
            supabase.table("community_votes")
            .select("market_id, selected_outcome")
            .in_("market_id", market_ids)
            .execute()
        ).data or []
        bets = (
            supabase.table("bets")
            .select("market_id, user_id")
            .in_("market_id", market_ids)
            .execute()
        ).data or []
        options = (
            supabase.table("market_options")
            .select("*")
            .in_("market_id", market_ids)
            .order("sort_order")
            .execute()
        ).data or []

    disputes_by_market = {row["market_id"]: row for row in disputes}
    dispute_tally = Counter((row["market_id"], row["selected_outcome"]) for row in dispute_votes)
    community_tally = Counter((row["market_id"], row["selected_outcome"]) for row in community_votes)
    bettors: dict[str, set[str]] = {}
    for bet in bets:
        bettors.setdefault(bet["market_id"], set()).add(bet["user_id"])
    options_by_market: dict[str, list[dict]] = {}
    for option in options:
        options_by_market.setdefault(option["market_id"], []).append(option)

    queue = []
    for market in markets:
        market_id = market["id"]
        creator = market.pop("creator", None)
        if market.get("market_type") == "multichoice":
            market["options"] = options_by_market.get(market_id, [])
        dispute = disputes_by_market.get(market_id)
        queue.append({
            "market": market,
            "creator": creator,
            "escalation": "dispute" if dispute else "community",
            "dispute": dispute,
            "dispute_votes": {
                "yes": dispute_tally[(market_id, "YES")], "no": dispute_tally[(market_id, "NO")],
            },
            "community_votes": {
                "yes": community_tally[(market_id, "YES")], "no": community_tally[(market_id, "NO")],
            },
            "bettor_count": len(bettors.get(market_id, ())),
        })
    return queue


@router.get("/markets/review")
async def list_markets_for_review(
    _current_user: Annotated[dict, Depends(require_admin)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """List all markets organized by review status."""
    with user_auth(supabase, token):
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
    current_user: Annotated[dict, Depends(require_admin)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Admin reviews a proposed market — approve or deny."""
    with user_auth(supabase, token):
        state_client = get_supabase_service_client() or supabase
        market = normalize_market_state(state_client, market_id)
        if not market:
            raise AppError(404, ErrorCode.MARKET_NOT_FOUND, "Market not found.")

        if market.get("status") != "pending_review":
            raise AppError(400, ErrorCode.MARKET_NOT_PENDING_REVIEW, "Market is not pending review.")

        close_at = _parse_dt(market.get("close_at"))
        if close_at and close_at <= datetime.now(tz=UTC):
            raise AppError(
                400,
                ErrorCode.MARKET_CLOSE_DATE_PASSED,
                "Market close date has passed. Pending markets are automatically denied and can no longer be updated.",
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
            state_client.table("markets").update(updates).eq("id", market_id).execute()

        if body.action == "approve":
            try:
                result = supabase.rpc("approve_market", {
                    "p_market_id": market_id,
                    "p_admin_id": current_user["id"],
                    "p_notes": body.notes,
                }).execute()
            except APIError as e:
                msg = e.message.lower() if e.code == "P0001" else ""
                if "not found" in msg:
                    raise AppError(404, ErrorCode.MARKET_NOT_FOUND, "Market not found.", original=e) from e
                if "not pending" in msg:
                    raise AppError(400, ErrorCode.MARKET_NOT_PENDING_REVIEW, "Market is not pending review.", original=e) from e
                if "close date has passed" in msg:
                    raise AppError(
                        400,
                        ErrorCode.MARKET_CLOSE_DATE_PASSED,
                        "Market close date has passed. Pending markets are automatically denied and can no longer be updated.",
                        original=e,
                    ) from e
                raise AppError(
                    500,
                    ErrorCode.INTERNAL_ERROR,
                    "Failed to approve market.",
                    original=e,
                ) from e
        else:
            notes = (body.notes or "").strip()
            if not notes:
                raise AppError(400, ErrorCode.VALIDATION_FAILED, "Notes are required when denying a market.")

            result = (
                state_client.table("markets")
                .update(
                    {
                        "status": "denied",
                        "reviewed_by": current_user["id"],
                        "review_date": datetime.now(tz=UTC).isoformat(),
                        "review_notes": notes,
                    }
                )
                .eq("id", market_id)
                .eq("status", "pending_review")
                .execute()
            )
            if not result.data:
                raise AppError(400, ErrorCode.MARKET_NOT_PENDING_REVIEW, "Market is not pending review.")

        market = (
            state_client.table("markets")
            .select("*")
            .eq("id", market_id)
            .single()
            .execute()
        )

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
