from datetime import UTC, datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, field_validator

MAX_MARKET_TITLE_LENGTH = 160
MAX_MARKET_DESCRIPTION_LENGTH = 2000
MAX_MARKET_RESOLUTION_LENGTH = 2000
MAX_MARKET_OFFICIAL_SOURCE_LENGTH = 300
MAX_MARKET_CRITERIA_LENGTH = 1000
MAX_MARKET_CATEGORY_LENGTH = 50
MAX_MARKET_LINK_LENGTH = 2048
MAX_MARKET_OPTION_LENGTH = 80
MAX_MARKET_REVIEW_NOTES_LENGTH = 1000


class MarketStatus(str, Enum):
    PENDING_REVIEW = "pending_review"
    OPEN = "open"
    CLOSED = "closed"
    PENDING_RESOLUTION = "pending_resolution"
    DISPUTED = "disputed"
    ADMIN_REVIEW = "admin_review"
    RESOLVED = "resolved"
    DENIED = "denied"


class CreateMarketRequest(BaseModel):
    title: str
    description: str
    close_at: datetime
    close_timezone: str | None = None
    resolution_criteria: str
    category: str = "General"
    official_source: str
    yes_criteria: str | None = None
    no_criteria: str | None = None
    ambiguity_criteria: str | None = None
    link: str | None = None
    market_type: Literal["binary", "multichoice"] = "binary"
    multichoice_type: Literal["exclusive", "non_exclusive"] | None = None
    options: list[str] | None = None

    @field_validator("title", "official_source")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Field must not be empty")
        return v.strip()

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        if len(v) > MAX_MARKET_TITLE_LENGTH:
            raise ValueError(f"Title must be {MAX_MARKET_TITLE_LENGTH} characters or fewer")
        return v

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Description must not be empty")
        if len(v) > MAX_MARKET_DESCRIPTION_LENGTH:
            raise ValueError(
                f"Description must be {MAX_MARKET_DESCRIPTION_LENGTH} characters or fewer"
            )
        return v

    @field_validator("resolution_criteria")
    @classmethod
    def validate_resolution_criteria(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Resolution criteria must not be empty")
        if len(v) > MAX_MARKET_RESOLUTION_LENGTH:
            raise ValueError(
                f"Resolution criteria must be {MAX_MARKET_RESOLUTION_LENGTH} characters or fewer"
            )
        return v

    @field_validator("official_source")
    @classmethod
    def validate_official_source(cls, v: str) -> str:
        if len(v) > MAX_MARKET_OFFICIAL_SOURCE_LENGTH:
            raise ValueError(
                f"Official source must be {MAX_MARKET_OFFICIAL_SOURCE_LENGTH} characters or fewer"
            )
        return v

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Category must not be empty")
        if len(v) > MAX_MARKET_CATEGORY_LENGTH:
            raise ValueError(f"Category must be {MAX_MARKET_CATEGORY_LENGTH} characters or fewer")
        return v

    @field_validator("yes_criteria", "no_criteria", "ambiguity_criteria")
    @classmethod
    def not_empty_if_present(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("Field must not be empty if provided")
        return v.strip() if v else v

    @field_validator("yes_criteria", "no_criteria", "ambiguity_criteria")
    @classmethod
    def validate_optional_criteria_length(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if len(v) > MAX_MARKET_CRITERIA_LENGTH:
            raise ValueError(
                f"Criteria fields must be {MAX_MARKET_CRITERIA_LENGTH} characters or fewer"
            )
        return v

    @field_validator("close_at")
    @classmethod
    def close_at_in_future(cls, v: datetime) -> datetime:
        # Normalize to UTC so "future" matches DB timestamptz regardless of server TZ.
        if v.tzinfo is None:
            v = v.replace(tzinfo=UTC)
        else:
            v = v.astimezone(UTC)
        if v <= datetime.now(UTC):
            raise ValueError("close_at must be in the future")
        return v

    @field_validator("link")
    @classmethod
    def validate_link(cls, v: str | None) -> str | None:
        if v is None or v.strip() == "":
            return None
        v = v.strip()
        if len(v) > MAX_MARKET_LINK_LENGTH:
            raise ValueError(f"Link must be {MAX_MARKET_LINK_LENGTH} characters or fewer")
        import re
        url_pattern = r"^https?://[^\s/$.?#].[^\s]*$"
        if not re.match(url_pattern, v):
            raise ValueError("Invalid URL format. Must start with http:// or https://")
        return v

    @field_validator("options")
    @classmethod
    def validate_options(cls, v, info):
        if info.data.get("market_type") == "multichoice":
            if v is None or len(v) < 2:
                raise ValueError("Multichoice markets require at least 2 options")
            if len(v) > 10:
                raise ValueError("Maximum 10 options allowed")
            normalized = []
            for option in v:
                cleaned = option.strip()
                if not cleaned:
                    raise ValueError("Option labels must not be empty")
                if len(cleaned) > MAX_MARKET_OPTION_LENGTH:
                    raise ValueError(
                        f"Option labels must be {MAX_MARKET_OPTION_LENGTH} characters or fewer"
                    )
                normalized.append(cleaned)

            if len({opt.lower() for opt in normalized}) != len(normalized):
                raise ValueError("Option labels must be unique")
            return normalized
        return v

    @field_validator("multichoice_type")
    @classmethod
    def validate_multichoice_type(cls, v, info):
        if info.data.get("market_type") == "multichoice" and v is None:
            raise ValueError("multichoice_type is required for multichoice markets")
        return v


class MarketOptionResponse(BaseModel):
    id: str
    market_id: str
    label: str
    pool_total: float
    sort_order: int
    is_winner: bool | None = None
    created_at: datetime


class MarketResponse(BaseModel):
    id: str
    title: str
    description: str
    creator_id: str
    created_at: datetime
    close_at: datetime
    status: MarketStatus
    resolution_criteria: str
    category: str
    yes_pool_total: float
    no_pool_total: float
    official_source: str | None = None
    yes_criteria: str | None = None
    no_criteria: str | None = None
    ambiguity_criteria: str | None = None
    proposed_outcome: Literal["YES", "NO"] | None = None
    proposed_at: datetime | None = None
    dispute_deadline: datetime | None = None
    resolved_outcome: Literal["YES", "NO"] | None = None
    resolved_at: datetime | None = None
    disputed_at: datetime | None = None
    disputed_by: str | None = None
    voting_ends_at: datetime | None = None
    link: str | None = None
    reviewed_by: str | None = None
    review_date: datetime | None = None
    review_notes: str | None = None
    resolution_window_end: datetime | None = None
    market_type: str = "binary"
    multichoice_type: str | None = None
    options: list[MarketOptionResponse] | None = None


class ReviewMarketRequest(BaseModel):
    action: Literal["approve", "deny"]
    notes: str | None = None
    title: str | None = None
    description: str | None = None
    resolution_criteria: str | None = None
    close_at: datetime | None = None
    category: str | None = None
    link: str | None = None

    @field_validator("notes")
    @classmethod
    def notes_required_for_deny(cls, v, info):
        if info.data.get("action") == "deny" and (v is None or v.strip() == ""):
            raise ValueError("Notes are required when denying a market")
        if v is None:
            return None
        v = v.strip()
        if len(v) > MAX_MARKET_REVIEW_NOTES_LENGTH:
            raise ValueError(
                f"Notes must be {MAX_MARKET_REVIEW_NOTES_LENGTH} characters or fewer"
            )
        return v

    @field_validator("title")
    @classmethod
    def validate_review_title(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("Title must not be empty")
        if len(v) > MAX_MARKET_TITLE_LENGTH:
            raise ValueError(f"Title must be {MAX_MARKET_TITLE_LENGTH} characters or fewer")
        return v

    @field_validator("description")
    @classmethod
    def validate_review_description(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("Description must not be empty")
        if len(v) > MAX_MARKET_DESCRIPTION_LENGTH:
            raise ValueError(
                f"Description must be {MAX_MARKET_DESCRIPTION_LENGTH} characters or fewer"
            )
        return v

    @field_validator("resolution_criteria")
    @classmethod
    def validate_review_resolution_criteria(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("Resolution criteria must not be empty")
        if len(v) > MAX_MARKET_RESOLUTION_LENGTH:
            raise ValueError(
                f"Resolution criteria must be {MAX_MARKET_RESOLUTION_LENGTH} characters or fewer"
            )
        return v

    @field_validator("category")
    @classmethod
    def validate_review_category(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("Category must not be empty")
        if len(v) > MAX_MARKET_CATEGORY_LENGTH:
            raise ValueError(f"Category must be {MAX_MARKET_CATEGORY_LENGTH} characters or fewer")
        return v

    @field_validator("link")
    @classmethod
    def validate_review_link(cls, v: str | None) -> str | None:
        if v is None or v.strip() == "":
            return None
        v = v.strip()
        if len(v) > MAX_MARKET_LINK_LENGTH:
            raise ValueError(f"Link must be {MAX_MARKET_LINK_LENGTH} characters or fewer")
        import re
        url_pattern = r"^https?://[^\s/$.?#].[^\s]*$"
        if not re.match(url_pattern, v):
            raise ValueError("Invalid URL format. Must start with http:// or https://")
        return v


class ProposeResolutionRequest(BaseModel):
    outcome: Literal["YES", "NO"]


class ProposeResolutionResponse(BaseModel):
    market_id: str
    status: str
    proposed_outcome: str
    dispute_deadline: datetime


class ResolveMarketRequest(BaseModel):
    outcome: Literal["YES", "NO"]


class ResolveMarketResponse(BaseModel):
    market_id: str
    status: str
    outcome: str


class DisputeMarketResponse(BaseModel):
    market_id: str
    status: str
    voting_ends_at: datetime | None = None


class ResolutionVoteRequest(BaseModel):
    outcome: Literal["YES", "NO"]
    amount: float

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Stake amount must be positive")
        return v


class ResolutionVoteResponse(BaseModel):
    vote_id: str
    new_balance: float


class ResolutionTotalsResponse(BaseModel):
    yes_total: float
    no_total: float
    total_staked: float
    total_voters: int


class FinalizeDisputeResponse(BaseModel):
    market_id: str
    status: str
    outcome: str
    yes_total: float
    no_total: float
    total_voters: int

