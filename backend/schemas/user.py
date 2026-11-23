from datetime import datetime

from pydantic import BaseModel, Field


class UserProfileResponse(BaseModel):
    id: str
    andrew_id: str
    display_name: str
    tartan_coin_balance: float
    created_at: datetime
    claimed_today: bool = False
    role: str = "user"
    is_admin: bool = False
    claim_eligible: bool = True
    claim_amount: float = 1000
    above_cap: bool = False
    equipped_badge_id: str | None = None
    equipped_badges: dict[str, str] = Field(default_factory=dict)
    avatar_url: str | None = None


class CreateProfileRequest(BaseModel):
    andrew_id: str
    display_name: str


class UpdateProfileRequest(BaseModel):
    display_name: str | None = None
    equipped_badge_id: str | None = None
    equipped_badges: dict[str, str | None] | None = None
    avatar_url: str | None = None


class LeaderboardEntry(BaseModel):
    id: str
    andrew_id: str
    display_name: str
    tartan_coin_balance: float
    gain: float
    equipped_badge_id: str | None = None
    equipped_badges: dict[str, str] = Field(default_factory=dict)
    avatar_url: str | None = None
