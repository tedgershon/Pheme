import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from postgrest.exceptions import APIError

from dependencies import (
    get_current_user,
    get_current_user_optional,
    get_supabase_client,
    get_supabase_service_client,
    get_user_token,
    user_auth,
)
from market_linter import lint_market_fields
from observability import report_and_safe_message
from schemas.dispute import (
    CastVoteRequest,
    DisputeResponse,
    FileDisputeRequest,
    VoteResponse,
)
from schemas.market import (
    CreateMarketRequest,
    MarketResponse,
    ProposeResolutionRequest,
    ProposeResolutionResponse,
    ResolveMarketRequest,
    ResolveMarketResponse,
)
from services.market_state_machine import normalize_market_state, normalize_markets
from supabase import Client

router = APIRouter(prefix="/api/markets", tags=["markets"])
logger = logging.getLogger(__name__)
EASTERN_TZ = ZoneInfo("America/New_York")


def _to_eastern(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(EASTERN_TZ)

def _normalize_for_response(markets: list[dict], supabase: Client) -> list[dict]:
    market_ids = [market["id"] for market in markets]
    if not market_ids:
        return markets

    normalized = normalize_markets(supabase, market_ids=market_ids)
    normalized_by_id = {market["id"]: market for market in normalized}
    return [normalized_by_id.get(market["id"], market) for market in markets]


# ── Market CRUD ──────────────────────────────────────────────


def _attach_options(markets: list[dict], supabase: Client) -> list[dict]:
    """For multichoice markets, fetch and attach their options."""
    mc_ids = [m["id"] for m in markets if m.get("market_type") == "multichoice"]
    if not mc_ids:
        return markets

    options_result = (
        supabase.table("market_options")
        .select("*")
        .in_("market_id", mc_ids)
        .order("sort_order")
        .execute()
    )
    options_by_market: dict[str, list[dict]] = {}
    for opt in options_result.data or []:
        options_by_market.setdefault(opt["market_id"], []).append(opt)

    for m in markets:
        if m.get("market_type") == "multichoice":
            m["options"] = options_by_market.get(m["id"], [])

    return markets


@router.get("", response_model=list[MarketResponse])
async def list_markets(
    market_status: str | None = Query(None, alias="status"),
    category: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    *,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    _current_user: Annotated[dict | None, Depends(get_current_user_optional)],
):
    state_client = get_supabase_service_client() or supabase
    if market_status in {"pending_review", "denied"}:
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
                logger.warning("Failed to normalize pending markets before list", exc_info=True)

    query = supabase.table("markets").select("*")

    if market_status:
        query = query.eq("status", market_status)
    else:
        query = query.not_.in_("status", ["pending_review", "denied"])
    if category:
        query = query.eq("category", category)

    query = query.order("created_at", desc=True).range(offset, offset + limit - 1)
    result = query.execute()

    markets = _normalize_for_response(result.data or [], supabase)
    if market_status:
        markets = [market for market in markets if market.get("status") == market_status]
    return _attach_options(markets, supabase)


TRENDING_MIN_VOLUME = 100
TRENDING_RECENCY_DAYS = 7


@router.get("/hot", response_model=list[MarketResponse])
async def get_hot_markets(
    limit: int = Query(5, ge=1, le=10),
    *,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    _current_user: Annotated[dict | None, Depends(get_current_user_optional)],
):
    """Top markets by total coin volume (yes_pool + no_pool)."""
    result = (
        supabase.table("markets")
        .select("*")
        .eq("status", "open")
        .execute()
    )
    markets = result.data or []
    markets.sort(key=lambda m: m["yes_pool_total"] + m["no_pool_total"], reverse=True)
    transitioned = _normalize_for_response(markets[:limit], supabase)
    return _attach_options(transitioned, supabase)


@router.get("/trending", response_model=list[MarketResponse])
async def get_trending_markets(
    limit: int = Query(3, ge=1, le=10),
    *,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    _current_user: Annotated[dict | None, Depends(get_current_user_optional)],
):
    """Trending markets: recently created + minimum activity threshold."""
    cutoff = (datetime.now(tz=UTC) - timedelta(days=TRENDING_RECENCY_DAYS)).isoformat()

    result = (
        supabase.table("markets")
        .select("*")
        .eq("status", "open")
        .gte("created_at", cutoff)
        .execute()
    )
    markets = result.data or []

    qualified = [m for m in markets if (m["yes_pool_total"] + m["no_pool_total"]) >= TRENDING_MIN_VOLUME]
    qualified.sort(key=lambda m: (m["created_at"], m["yes_pool_total"] + m["no_pool_total"]), reverse=True)

    if len(qualified) < limit:
        remaining = [m for m in markets if m not in qualified]
        remaining.sort(key=lambda m: m["created_at"], reverse=True)
        qualified.extend(remaining[:limit - len(qualified)])

    transitioned = _normalize_for_response(qualified[:limit], supabase)
    return _attach_options(transitioned, supabase)


@router.get("/top", response_model=list[MarketResponse])
async def get_top_markets(
    limit: int = Query(3, ge=1, le=10),
    *,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    _current_user: Annotated[dict | None, Depends(get_current_user_optional)],
):
    """Top markets by total coin investment volume."""
    result = (
        supabase.table("markets")
        .select("*")
        .eq("status", "open")
        .execute()
    )
    markets = result.data or []
    markets.sort(key=lambda m: m["yes_pool_total"] + m["no_pool_total"], reverse=True)
    transitioned = _normalize_for_response(markets[:limit], supabase)
    return _attach_options(transitioned, supabase)


@router.get("/{market_id}", response_model=MarketResponse)
async def get_market(
    market_id: str,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    _current_user: Annotated[dict | None, Depends(get_current_user_optional)],
):
    result = (
        supabase.table("markets").select("*").eq("id", market_id).single().execute()
    )

    if result.data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Market not found")

    markets = _normalize_for_response([result.data], supabase)
    return _attach_options(markets, supabase)[0]


@router.post("", response_model=MarketResponse, status_code=status.HTTP_201_CREATED)
async def create_market(
    body: CreateMarketRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    linted = lint_market_fields(body)

    market_row = {
        "title": linted.title,
        "description": linted.description,
        "creator_id": current_user["id"],
        "close_at": _to_eastern(linted.close_at).isoformat(),
        "resolution_criteria": linted.resolution_criteria,
        "category": linted.category,
        "official_source": linted.official_source,
        "yes_criteria": linted.yes_criteria,
        "no_criteria": linted.no_criteria,
        "ambiguity_criteria": linted.ambiguity_criteria,
        "link": linted.link,
        "status": "pending_review",
        "market_type": linted.market_type,
    }

    if linted.market_type == "multichoice":
        market_row["multichoice_type"] = linted.multichoice_type

    with user_auth(supabase, token):
        result = supabase.table("markets").insert(market_row).execute()

        if not result.data:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create market")

        market = result.data[0]

        if linted.market_type == "multichoice" and linted.options:
            option_rows = [
                {
                    "market_id": market["id"],
                    "label": label,
                    "sort_order": idx,
                }
                for idx, label in enumerate(linted.options)
            ]
            options_result = supabase.table("market_options").insert(option_rows).execute()
            market["options"] = options_result.data or []

        try:
            supabase.rpc(
                "notify_admins_market_submitted",
                {"p_market_id": market["id"]},
            ).execute()
        except Exception:
            logger.exception("notify_admins_market_submitted RPC failed")

    return market


# ── Resolution Flow ──────────────────────────────────────────


@router.post("/{market_id}/resolve", response_model=ProposeResolutionResponse)
async def propose_resolution(
    market_id: str,
    body: ProposeResolutionRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Creator proposes an outcome. Starts 24h dispute window — no payout yet."""
    normalize_market_state(supabase, market_id)
    with user_auth(supabase, token):
        try:
            result = supabase.rpc("propose_resolution", {
                "p_market_id": market_id,
                "p_outcome": body.outcome,
                "p_proposer_id": current_user["id"],
            }).execute()
            return result.data
        except APIError as e:
            msg = e.message.lower() if e.code == "P0001" else ""
            if "not found" in msg:
                raise HTTPException(status_code=404, detail="Market not found.")
            if "creator" in msg:
                raise HTTPException(status_code=403, detail="Only the market creator can propose a resolution.")
            if "closed" in msg:
                raise HTTPException(status_code=400, detail="Market must be closed before proposing resolution.")
            raise HTTPException(status_code=500, detail=report_and_safe_message(e, "Failed to propose resolution."))


@router.post("/{market_id}/community-resolution", response_model=MarketResponse)
async def start_community_resolution(
    market_id: str,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Creator starts the 24h community-resolution flow on a just-closed market."""
    with user_auth(supabase, token):
        market = normalize_market_state(supabase, market_id)
        if not market:
            raise HTTPException(status_code=404, detail="Market not found.")

        if market.get("creator_id") != current_user.get("id"):
            raise HTTPException(status_code=403, detail="Only the market creator can start community resolution.")

        if market.get("status") == "pending_resolution" and not market.get("proposed_outcome"):
            return market

        if market.get("status") != "closed":
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Community resolution can only be started for closed markets.",
                    "current_status": market.get("status"),
                    "expected_status": "closed",
                },
            )

        update_payload: dict[str, str | None] = {
            "status": "pending_resolution",
            "proposed_outcome": None,
            "proposed_at": None,
            "dispute_deadline": None,
            "resolution_window_end": (
                datetime.now(tz=UTC) + timedelta(hours=24)
            ).isoformat(),
        }

        updated = (
            supabase.table("markets")
            .update(update_payload)
            .eq("id", market_id)
            .execute()
        )
        if not updated.data:
            raise HTTPException(status_code=500, detail="Failed to start community resolution.")
        return updated.data[0]


# ── Disputes ─────────────────────────────────────────────────


@router.post("/{market_id}/dispute", response_model=DisputeResponse)
async def file_dispute(
    market_id: str,
    body: FileDisputeRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """File a dispute during the pending_resolution window."""
    normalize_market_state(supabase, market_id)
    with user_auth(supabase, token):
        try:
            result = supabase.rpc("file_dispute", {
                "p_market_id": market_id,
                "p_disputer_id": current_user["id"],
                "p_explanation": body.explanation,
            }).execute()

            rpc_data = result.data
            dispute_id = rpc_data.get("id") if isinstance(rpc_data, dict) else None
            if not dispute_id:
                raise HTTPException(status_code=500, detail="Failed to file dispute.")

            dispute = (
                supabase.table("disputes")
                .select("*")
                .eq("id", dispute_id)
                .single()
                .execute()
            )
            if not dispute.data:
                raise HTTPException(status_code=500, detail="Failed to load filed dispute.")
            return dispute.data
        except Exception as e:
            if isinstance(e, HTTPException):
                raise
            msg = str(e).lower()
            if "not found" in msg:
                raise HTTPException(status_code=404, detail="Market not found.")
            if "pending_resolution" in msg:
                raise HTTPException(status_code=400, detail="Market is not in pending resolution.")
            if "expired" in msg:
                raise HTTPException(status_code=400, detail="Dispute window has expired.")
            if "unique" in msg or "duplicate" in msg:
                raise HTTPException(status_code=409, detail="A dispute already exists for this market.")
            raise HTTPException(status_code=500, detail=f"Failed to file dispute: {e}")


@router.get("/{market_id}/dispute", response_model=DisputeResponse)
async def get_dispute(
    market_id: str,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    _current_user: Annotated[dict | None, Depends(get_current_user_optional)],
):
    """Get the active dispute for a market."""
    result = (
        supabase.table("disputes").select("*").eq("market_id", market_id).single().execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="No dispute found for this market.")
    return result.data


@router.post("/{market_id}/dispute/vote", response_model=VoteResponse)
async def cast_vote(
    market_id: str,
    body: CastVoteRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Cast a vote on a dispute. Only neutral users (not creator, not bettors) can vote."""
    normalize_market_state(supabase, market_id)
    # Look up the dispute for this market
    dispute = (
        supabase.table("disputes").select("id").eq("market_id", market_id).single().execute()
    )
    if not dispute.data:
        raise HTTPException(status_code=404, detail="No dispute found for this market.")

    with user_auth(supabase, token):
        try:
            result = supabase.rpc("cast_dispute_vote", {
                "p_dispute_id": dispute.data["id"],
                "p_voter_id": current_user["id"],
                "p_vote": body.vote,
            }).execute()
            return result.data
        except APIError as e:
            msg = e.message.lower() if e.code == "P0001" else ""
            if "creator" in msg:
                raise HTTPException(status_code=403, detail="Market creator cannot vote on disputes.")
            if "bets" in msg or "bettor" in msg:
                raise HTTPException(status_code=403, detail="Users who placed bets cannot vote on disputes.")
            if "expired" in msg:
                raise HTTPException(status_code=400, detail="Voting window has expired.")
            if e.code == "23505" or "unique" in msg or "duplicate" in msg:
                raise HTTPException(status_code=409, detail="You have already voted on this dispute.")
            raise HTTPException(status_code=500, detail=report_and_safe_message(e, "Failed to cast vote."))


@router.get("/{market_id}/dispute/votes", response_model=list[VoteResponse])
async def list_votes(
    market_id: str,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    _current_user: Annotated[dict | None, Depends(get_current_user_optional)],
):
    """List all votes on a market's dispute."""
    dispute = (
        supabase.table("disputes").select("id").eq("market_id", market_id).single().execute()
    )
    if not dispute.data:
        raise HTTPException(status_code=404, detail="No dispute found for this market.")

    result = (
        supabase.table("resolution_votes")
        .select("*")
        .eq("dispute_id", dispute.data["id"])
        .order("created_at", desc=False)
        .execute()
    )
    return result.data or []


# ── Admin ────────────────────────────────────────────────────


@router.post("/admin/{market_id}/resolve", response_model=ResolveMarketResponse)
async def admin_resolve(
    market_id: str,
    body: ResolveMarketRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Admin makes the final resolution call on an admin_review market."""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required.")

    with user_auth(supabase, token):
        try:
            result = supabase.rpc("admin_resolve_market", {
                "p_market_id": market_id,
                "p_outcome": body.outcome,
                "p_admin_id": current_user["id"],
            }).execute()
            return result.data
        except APIError as e:
            msg = e.message.lower() if e.code == "P0001" else ""
            if "not found" in msg:
                raise HTTPException(status_code=404, detail="Market not found.")
            if "admin_review" in msg:
                raise HTTPException(status_code=400, detail="Market is not in admin review.")
            raise HTTPException(status_code=500, detail=report_and_safe_message(e, "Failed to resolve market."))
