from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator


class FileDisputeRequest(BaseModel):
    explanation: str

    @field_validator("explanation")
    @classmethod
    def explanation_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Explanation must not be empty")
        if len(v) > 1000:
            raise ValueError("Explanation must be 1000 characters or fewer")
        return v


class DisputeResponse(BaseModel):
    id: str
    market_id: str
    disputer_id: str
    explanation: str
    voting_deadline: datetime
    resolved_by_admin: bool
    created_at: datetime


class DisputeSubmissionResponse(BaseModel):
    """One concern filed under a market's single dispute case."""

    id: str
    dispute_id: str
    market_id: str
    submitter_id: str
    explanation: str
    voting_deadline: datetime
    opened_case: bool
    created_at: datetime


class PublicDisputeSubmission(BaseModel):
    """Explanations are public so neutral voters can weigh them; submitters are not."""

    id: str
    explanation: str
    created_at: datetime
    is_mine: bool


class DisputeSubmissionList(BaseModel):
    total: int
    has_submitted: bool
    items: list[PublicDisputeSubmission]


class DisputeEligibility(BaseModel):
    """The caller's own standing on a market's dispute, so the UI can hide or disable
    actions they cannot take. Display only: file_dispute and cast_dispute_vote enforce
    the same rules. `can_vote` ignores the voting deadline, which the case reports."""

    is_creator: bool
    is_bettor: bool  # active or refunded; matches cast_dispute_vote's neutrality check
    vote: Literal["YES", "NO"] | None
    can_vote: bool


class CastVoteRequest(BaseModel):
    vote: Literal["YES", "NO"]


class VoteResponse(BaseModel):
    id: str
    dispute_id: str
    market_id: str
    voter_id: str
    selected_outcome: str
    created_at: datetime


class ClaimResponse(BaseModel):
    new_balance: float
    claimed_amount: float = 1000
    claimed_at: datetime
