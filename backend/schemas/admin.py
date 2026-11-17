from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from schemas.market import MarketResponse


class BackrollRequest(BaseModel):
    cutoff_date: datetime
    close_market: bool = True


class StatsResponse(BaseModel):
    total_users: int
    users_by_role: dict[str, int]
    total_markets: int
    markets_by_status: dict[str, int]
    total_banana_traded: float
    total_active_bets: int


class UserSearchResult(BaseModel):
    id: str
    andrew_id: str
    display_name: str
    role: str
    created_at: str


class UpdateRoleRequest(BaseModel):
    role: str


class UpdateRoleResponse(BaseModel):
    id: str
    andrew_id: str
    display_name: str
    role: str


class AdminReviewPerson(BaseModel):
    andrew_id: str | None = None
    display_name: str | None = None


class AdminReviewDispute(BaseModel):
    id: str
    explanation: str
    voting_deadline: datetime
    created_at: datetime
    disputer: AdminReviewPerson | None = None


class VoteTally(BaseModel):
    yes: int = 0
    no: int = 0


class AdminReviewItem(BaseModel):
    """One escalated market with the evidence an admin needs to adjudicate it."""

    market: MarketResponse
    creator: AdminReviewPerson | None = None
    escalation: Literal["dispute", "community"]
    dispute: AdminReviewDispute | None = None
    dispute_votes: VoteTally
    community_votes: VoteTally
    bettor_count: int
