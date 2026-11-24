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
from observability import AppError, ErrorCode
from schemas.dispute import (
    CastVoteRequest,
    CastVoteResponse,
    DisputeEligibility,
    DisputeResponse,
    DisputeSubmissionList,
    DisputeSubmissionResponse,
    FileDisputeRequest,
    VoteResponse,
)
from schemas.market import (
    CreateMarketRequest,
    MarketResponse,
    ProposeResolutionRequest,
    ProposeResolutionResponse,
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


PRIVATE_STATUSES = {"pending_review", "denied"}


def _can_read_market(market: dict, user: dict | None) -> bool:
    return market.get("status") not in PRIVATE_STATUSES or bool(
        user and (market.get("creator_id") == user["id"] or user.get("role") in {"admin", "super_admin"})
    )


@router.get("", response_model=list[MarketResponse])
async def list_markets(
    market_status: str | None = Query(None, alias="status"),
    category: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    *,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: Annotated[dict | None, Depends(get_current_user_optional)],
    token: str | None = Depends(get_user_token),
):
    private = market_status in PRIVATE_STATUSES
    if private and current_user is None:
        return []
    owner_only = private and current_user.get("role") not in {"admin", "super_admin"}

    # Scope before normalization and pagination, including when the server key
    # bypasses RLS. Invalid optional auth is anonymous and must not reach RLS.
    with user_auth(supabase, token if current_user else None):
        if private:
            pending = supabase.table("markets").select("id").eq("status", "pending_review")
            if owner_only:
                pending = pending.eq("creator_id", current_user["id"])
            pending_ids = [row["id"] for row in (pending.execute().data or [])]
            if pending_ids:
                try:
                    normalize_markets(get_supabase_service_client() or supabase, market_ids=pending_ids)
                except Exception:
                    logger.warning("Failed to normalize pending markets before list", exc_info=True)

        query = supabase.table("markets").select("*")
        if market_status:
            query = query.eq("status", market_status)
        else:
            query = query.not_.in_("status", sorted(PRIVATE_STATUSES))
        if owner_only:
            query = query.eq("creator_id", current_user["id"])
        if category:
            query = query.eq("category", category)
        result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()

        markets = _normalize_for_response(result.data or [], supabase)
        markets = [market for market in markets if _can_read_market(market, current_user)]
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
    current_user: Annotated[dict | None, Depends(get_current_user_optional)],
    token: str | None = Depends(get_user_token),
):
    with user_auth(supabase, token if current_user else None):
        try:
            result = supabase.table("markets").select("*").eq("id", market_id).single().execute()
        except APIError as exc:
            if exc.code == "PGRST116":
                raise AppError(404, ErrorCode.MARKET_NOT_FOUND, "Market not found.") from exc
            raise

        if not result.data or not _can_read_market(result.data, current_user):
            raise AppError(404, ErrorCode.MARKET_NOT_FOUND, "Market not found.")

        markets = _normalize_for_response([result.data], supabase)
        if not _can_read_market(markets[0], current_user):
            raise AppError(404, ErrorCode.MARKET_NOT_FOUND, "Market not found.")
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
            raise AppError(500, ErrorCode.INTERNAL_ERROR, "Failed to create market.")

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
        except APIError as exc:
            msg = exc.message.lower() if exc.code == "P0001" else ""
            extras = {"market_id": market_id, "outcome": body.outcome}
            if "not found" in msg:
                raise AppError(
                    404, ErrorCode.MARKET_NOT_FOUND, "Market not found.",
                    original=exc, extras=extras,
                ) from exc
            if "creator" in msg:
                raise AppError(
                    403, ErrorCode.RESOLUTION_NOT_CREATOR, "Only the market creator can do this.",
                    original=exc, extras=extras,
                ) from exc
            if "closed" in msg:
                raise AppError(
                    400, ErrorCode.MARKET_NOT_CLOSED, "Market must be closed before it can be resolved.",
                    original=exc, extras=extras,
                ) from exc
            raise AppError(
                500, ErrorCode.INTERNAL_ERROR, "Failed to propose resolution.",
                original=exc, extras=extras,
            ) from exc


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
            raise AppError(404, ErrorCode.MARKET_NOT_FOUND, "Market not found.")

        if market.get("creator_id") != current_user.get("id"):
            raise AppError(403, ErrorCode.RESOLUTION_NOT_CREATOR, "Only the market creator can do this.")

        if market.get("status") == "pending_resolution" and not market.get("proposed_outcome"):
            return market

        if market.get("status") != "closed":
            raise AppError(
                400, ErrorCode.MARKET_NOT_CLOSED,
                "Market must be closed before it can be resolved.",
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

        # Creators have no UPDATE policy on markets, so the checked transition is
        # a trusted server write; the status guard keeps it from racing another.
        state_client = get_supabase_service_client() or supabase
        updated = (
            state_client.table("markets")
            .update(update_payload)
            .eq("id", market_id)
            .eq("status", "closed")
            .execute()
        )
        if not updated.data:
            raise AppError(500, ErrorCode.INTERNAL_ERROR, "Failed to start community resolution.")
        return updated.data[0]


# ── Disputes ─────────────────────────────────────────────────


@router.post("/{market_id}/dispute", response_model=DisputeSubmissionResponse)
async def file_dispute(
    market_id: str,
    body: FileDisputeRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Submit a concern. The first one opens the market's dispute case; later ones
    join it until its voting deadline. One submission per user, never amended."""
    normalize_market_state(supabase, market_id)
    with user_auth(supabase, token):
        try:
            result = supabase.rpc("file_dispute", {
                "p_market_id": market_id,
                "p_disputer_id": current_user["id"],
                "p_explanation": body.explanation,
            }).execute()

            rpc_data = result.data
            if not isinstance(rpc_data, dict) or not rpc_data.get("id"):
                raise AppError(500, ErrorCode.INTERNAL_ERROR, "Failed to file dispute.")
            return rpc_data
        except Exception as exc:
            if isinstance(exc, HTTPException):
                raise
            msg = str(exc).lower()
            extras = {"market_id": market_id}
            if "creator cannot" in msg:
                raise AppError(403, ErrorCode.DISPUTE_CREATOR_RESTRICTED, "Market creators cannot file or vote on disputes for their own market.", original=exc, extras=extras) from exc
            if "signed-in user" in msg:
                raise AppError(403, ErrorCode.FORBIDDEN, "Disputes can only be filed as yourself.", original=exc, extras=extras) from exc
            if "explanation must be" in msg:
                raise AppError(422, ErrorCode.VALIDATION_FAILED, "Explanation must be 1 to 1000 characters.", original=exc, extras=extras) from exc
            if "proposal and dispute deadline" in msg:
                raise AppError(400, ErrorCode.MARKET_NOT_PENDING_RESOLUTION, "Market is not in its resolution period.", original=exc, extras=extras) from exc
            if "already submitted" in msg:
                raise AppError(
                    409, ErrorCode.DISPUTE_ALREADY_FILED, "You have already submitted a concern for this market.",
                    original=exc, extras=extras,
                ) from exc
            if "dispute not found" in msg:
                raise AppError(404, ErrorCode.DISPUTE_NOT_FOUND, "No dispute found for this market.", original=exc, extras=extras) from exc
            if "not found" in msg:
                raise AppError(
                    404, ErrorCode.MARKET_NOT_FOUND, "Market not found.",
                    original=exc, extras=extras,
                ) from exc
            if "pending_resolution" in msg:
                raise AppError(
                    400, ErrorCode.MARKET_NOT_PENDING_RESOLUTION, "Market is not in its resolution period.",
                    original=exc, extras=extras,
                ) from exc
            if "expired" in msg:
                raise AppError(
                    400, ErrorCode.RESOLUTION_WINDOW_EXPIRED, "The resolution window has expired.",
                    original=exc, extras=extras,
                ) from exc
            if "unique" in msg or "duplicate" in msg:
                raise AppError(
                    409, ErrorCode.DISPUTE_ALREADY_FILED, "You have already submitted a concern for this market.",
                    original=exc, extras=extras,
                ) from exc
            raise AppError(
                500, ErrorCode.INTERNAL_ERROR, "Failed to file dispute.",
                original=exc, extras=extras,
            ) from exc


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
        raise AppError(404, ErrorCode.DISPUTE_NOT_FOUND, "No dispute found for this market.")
    return result.data


@router.get("/{market_id}/dispute/submissions", response_model=DisputeSubmissionList)
async def list_dispute_submissions(
    market_id: str,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    _current_user: Annotated[dict | None, Depends(get_current_user_optional)],
    token: str | None = Depends(get_user_token),
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Public concerns filed under a market's dispute, oldest first. Explanations are
    visible to everyone; submitters are not. `is_mine` flags the caller's own row."""
    with user_auth(supabase, token):
        try:
            result = supabase.rpc("list_dispute_submissions", {
                "p_market_id": market_id, "p_limit": limit, "p_offset": offset,
            }).execute()
        except APIError as exc:
            raise AppError(
                500, ErrorCode.INTERNAL_ERROR, "Failed to load dispute submissions.",
                original=exc, extras={"market_id": market_id},
            ) from exc
    return result.data


@router.get("/{market_id}/dispute/eligibility", response_model=DisputeEligibility)
async def get_dispute_eligibility(
    market_id: str,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Whether the caller may vote on this market's dispute. Reports only the caller's
    own relationship to the market; the vote RPC remains the gate."""
    user_id = current_user["id"]
    with user_auth(supabase, token):
        market = (
            supabase.table("markets").select("creator_id").eq("id", market_id).limit(1).execute()
        )
        if not market.data:
            raise AppError(404, ErrorCode.MARKET_NOT_FOUND, "Market not found.")
        is_creator = market.data[0].get("creator_id") == user_id

        # Same rule as cast_dispute_vote: a current bet, or a bet-placement ledger
        # entry left behind by a refund. Users can read their own transactions.
        is_bettor = bool(
            supabase.table("bets").select("id")
            .eq("market_id", market_id).eq("user_id", user_id).limit(1).execute().data
        ) or bool(
            supabase.table("transactions").select("id")
            .eq("market_id", market_id).eq("user_id", user_id)
            .eq("transaction_type", "bet_placement").limit(1).execute().data
        )

        votes = (
            supabase.table("resolution_votes").select("selected_outcome")
            .eq("market_id", market_id).eq("voter_id", user_id).limit(1).execute()
        )
    vote = votes.data[0]["selected_outcome"] if votes.data else None
    return {
        "is_creator": is_creator,
        "is_bettor": is_bettor,
        "vote": vote,
        "can_vote": not (is_creator or is_bettor or vote),
    }


@router.post("/{market_id}/dispute/vote", response_model=CastVoteResponse)
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
        raise AppError(404, ErrorCode.DISPUTE_NOT_FOUND, "No dispute found for this market.")

    with user_auth(supabase, token):
        try:
            result = supabase.rpc("cast_dispute_vote", {
                "p_dispute_id": dispute.data["id"],
                "p_voter_id": current_user["id"],
                "p_vote": body.vote,
            }).execute()
            return result.data
        except APIError as exc:
            msg = exc.message.lower() if exc.code == "P0001" else ""
            extras = {"market_id": market_id, "dispute_id": dispute.data["id"], "vote": body.vote}
            if "creator" in msg:
                raise AppError(
                    403, ErrorCode.DISPUTE_CREATOR_RESTRICTED, "Market creators cannot file or vote on disputes for their own market.",
                    original=exc, extras=extras,
                ) from exc
            if "bets" in msg or "bettor" in msg:
                raise AppError(
                    403, ErrorCode.DISPUTE_BETTOR_RESTRICTED,
                    "Bettors cannot vote on disputes for markets they bet on.",
                    original=exc, extras=extras,
                ) from exc
            if "expired" in msg:
                raise AppError(
                    400, ErrorCode.RESOLUTION_WINDOW_EXPIRED, "The resolution window has expired.",
                    original=exc, extras=extras,
                ) from exc
            if exc.code == "23505" or "unique" in msg or "duplicate" in msg:
                raise AppError(
                    409, ErrorCode.DISPUTE_VOTE_DUPLICATE, "You've already voted.",
                    original=exc, extras=extras,
                ) from exc
            raise AppError(
                500, ErrorCode.INTERNAL_ERROR, "Failed to cast vote.",
                original=exc, extras=extras,
            ) from exc


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
        raise AppError(404, ErrorCode.DISPUTE_NOT_FOUND, "No dispute found for this market.")

    result = (
        supabase.table("resolution_votes")
        .select("*")
        .eq("dispute_id", dispute.data["id"])
        .order("created_at", desc=False)
        .execute()
    )
    return result.data or []
