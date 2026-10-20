# Feature 09: Claimable Rewards — Badges & Reward Tracks

**Phase:** 4 (depends on Phases 2–3)
**Dependencies:** `01-admin-system` (admin flag for filtering), `04-market-resolution` (resolution data for correct bets tracking)
**Parallelizable with:** `08-main-page`

---

## Summary

Add a gamification layer with **badge tracks** that users progress through. Each track has tiered badges earned by reaching milestones (e.g., total coins earned, correct bets, markets created). Badges are displayed on the leaderboard next to each user. A new "Rewards" page shows the user's progress across all tracks. Hovering over badges on the leaderboard shows the badge title.

---

## Badge Track Design

### Track 1: "Banana Baron" — Total Coin Balance
Milestones: 5,000 → 7,500 → 10,000 → 20,000 → 50,000 coins

| Tier | Threshold | Badge Name | Color |
|------|-----------|------------|-------|
| 1 | 5,000 | Banana Sprout | Green |
| 2 | 7,500 | Banana Tree | Yellow-Green |
| 3 | 10,000 | Banana Grove | Gold |
| 4 | 20,000 | Banana Mogul | Amber |
| 5 | 50,000 | Banana Baron | Deep Gold |

### Track 2: "Oracle" — Correct Bet Predictions
Milestones: 3 → 5 → 10 → 20 → 50 correct predictions

| Tier | Threshold | Badge Name | Color |
|------|-----------|------------|-------|
| 1 | 3 | Lucky Guess | Light Blue |
| 2 | 5 | Sharp Eye | Blue |
| 3 | 10 | Fortune Teller | Purple |
| 4 | 20 | Clairvoyant | Deep Purple |
| 5 | 50 | Oracle | Indigo |

### Track 3: "Architect" — Markets Created
Milestones: 1 → 2 → 5 → 10 → 25 markets created (approved)

| Tier | Threshold | Badge Name | Color |
|------|-----------|------------|-------|
| 1 | 1 | Market Maker | Light Teal |
| 2 | 2 | Question Crafter | Teal |
| 3 | 5 | Trend Setter | Cyan |
| 4 | 10 | Market Maven | Dark Teal |
| 5 | 25 | Architect | Deep Teal |

### Track 4: "Degen" — Total Bets Placed
Milestones: 5 → 10 → 20 → 50 → 100 bets

| Tier | Threshold | Badge Name | Color |
|------|-----------|------------|-------|
| 1 | 5 | Casual Better | Light Orange |
| 2 | 10 | Regular | Orange |
| 3 | 20 | Enthusiast | Dark Orange |
| 4 | 50 | Addicted | Red-Orange |
| 5 | 100 | Degen | Red |

### Track 5: "Whale" — Single Bet Amount
Milestones: 1,000 → 2,000 → 5,000 → 10,000 → 25,000 on a single bet

| Tier | Threshold | Badge Name | Color |
|------|-----------|------------|-------|
| 1 | 1,000 | Small Fish | Light Pink |
| 2 | 2,000 | Dolphin | Pink |
| 3 | 5,000 | Shark | Hot Pink |
| 4 | 10,000 | Orca | Magenta |
| 5 | 25,000 | Whale | Deep Magenta |

**Progression rule:** Advancing to a higher tier **replaces** the current badge for that track. A user has at most one badge per track at any time (the highest tier achieved).

---

## Database Changes

### Migration 044: Badge Definitions Table

**File:** `backend/supabase/migrations/044_badge_definitions.sql`

```sql
CREATE TABLE IF NOT EXISTS badge_definitions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track       TEXT NOT NULL,
    tier        INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5),
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    threshold   NUMERIC NOT NULL,
    color       TEXT NOT NULL,
    UNIQUE (track, tier)
);

-- Seed badge definitions
INSERT INTO badge_definitions (track, tier, name, description, threshold, color) VALUES
-- Banana Baron track
('banana_baron', 1, 'Banana Sprout',   'Reach 5,000 coin balance',      5000,  '#4ade80'),
('banana_baron', 2, 'Banana Tree',     'Reach 7,500 coin balance',      7500,  '#a3e635'),
('banana_baron', 3, 'Banana Grove',    'Reach 10,000 coin balance',     10000, '#eab308'),
('banana_baron', 4, 'Banana Mogul',    'Reach 20,000 coin balance',     20000, '#f59e0b'),
('banana_baron', 5, 'Banana Baron',    'Reach 50,000 coin balance',     50000, '#d97706'),
-- Oracle track
('oracle', 1, 'Lucky Guess',     'Win 3 correct predictions',     3,   '#93c5fd'),
('oracle', 2, 'Sharp Eye',       'Win 5 correct predictions',     5,   '#3b82f6'),
('oracle', 3, 'Fortune Teller',  'Win 10 correct predictions',    10,  '#a855f7'),
('oracle', 4, 'Clairvoyant',     'Win 20 correct predictions',    20,  '#7c3aed'),
('oracle', 5, 'Oracle',          'Win 50 correct predictions',    50,  '#4f46e5'),
-- Architect track
('architect', 1, 'Market Maker',    'Create 1 approved market',      1,   '#5eead4'),
('architect', 2, 'Question Crafter','Create 2 approved markets',     2,   '#14b8a6'),
('architect', 3, 'Trend Setter',    'Create 5 approved markets',     5,   '#06b6d4'),
('architect', 4, 'Market Maven',    'Create 10 approved markets',    10,  '#0d9488'),
('architect', 5, 'Architect',       'Create 25 approved markets',    25,  '#0f766e'),
-- Degen track
('degen', 1, 'Casual Better', 'Place 5 bets',               5,   '#fdba74'),
('degen', 2, 'Regular',       'Place 10 bets',              10,  '#fb923c'),
('degen', 3, 'Enthusiast',    'Place 20 bets',              20,  '#f97316'),
('degen', 4, 'Addicted',      'Place 50 bets',              50,  '#ea580c'),
('degen', 5, 'Degen',         'Place 100 bets',             100, '#dc2626'),
-- Whale track
('whale', 1, 'Small Fish', 'Place a single bet of 1,000+',   1000,  '#f9a8d4'),
('whale', 2, 'Dolphin',    'Place a single bet of 2,000+',   2000,  '#f472b6'),
('whale', 3, 'Shark',      'Place a single bet of 5,000+',   5000,  '#ec4899'),
('whale', 4, 'Orca',       'Place a single bet of 10,000+',  10000, '#db2777'),
('whale', 5, 'Whale',      'Place a single bet of 25,000+',  25000, '#be185d');
```

RLS is enabled on `badge_definitions` with a public `SELECT` policy in migration `062_badge_definitions_rls.sql` (mirrors the `user_badges` policy below; mutations remain service-role-only).

### Migration 045: User Badges Table

**File:** `backend/supabase/migrations/045_user_badges.sql`

```sql
CREATE TABLE IF NOT EXISTS user_badges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    badge_id        UUID NOT NULL REFERENCES badge_definitions(id),
    track           TEXT NOT NULL,
    tier            INTEGER NOT NULL,
    earned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, track)  -- one badge per track per user (highest tier)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges (user_id);

ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User badges are viewable by everyone"
    ON user_badges FOR SELECT USING (true);
CREATE POLICY "System can manage user badges"
    ON user_badges FOR ALL WITH CHECK (true);
```

### Migration 046: Badge Check Function

**File:** `backend/supabase/migrations/046_fn_check_badges.sql`

```sql
-- Check and award badges for a user based on their current stats
CREATE OR REPLACE FUNCTION check_and_award_badges(
    p_user_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_balance NUMERIC;
    v_correct_bets INTEGER;
    v_markets_created INTEGER;
    v_total_bets INTEGER;
    v_max_single_bet NUMERIC;
    v_badge RECORD;
    v_new_badges JSONB := '[]'::JSONB;
BEGIN
    -- Get user stats
    SELECT banana_balance INTO v_balance FROM profiles WHERE id = p_user_id;

    -- Count correct predictions (bets on markets that resolved in their favor)
    SELECT COUNT(*) INTO v_correct_bets
    FROM bets b JOIN markets m ON b.market_id = m.id
    WHERE b.user_id = p_user_id
      AND m.status = 'resolved'
      AND b.side = m.resolved_outcome;

    -- Count approved markets created
    SELECT COUNT(*) INTO v_markets_created
    FROM markets
    WHERE creator_id = p_user_id
      AND status NOT IN ('pending_review', 'denied');

    -- Count total bets
    SELECT COUNT(*) INTO v_total_bets FROM bets WHERE user_id = p_user_id;

    -- Max single bet amount
    SELECT COALESCE(MAX(amount), 0) INTO v_max_single_bet FROM bets WHERE user_id = p_user_id;

    -- Check each track
    FOR v_badge IN
        SELECT * FROM badge_definitions ORDER BY track, tier DESC
    LOOP
        DECLARE
            v_current_value NUMERIC;
            v_current_tier INTEGER;
        BEGIN
            -- Get current stat for this track
            v_current_value := CASE v_badge.track
                WHEN 'banana_baron' THEN v_balance
                WHEN 'oracle' THEN v_correct_bets
                WHEN 'architect' THEN v_markets_created
                WHEN 'degen' THEN v_total_bets
                WHEN 'whale' THEN v_max_single_bet
            END;

            -- Check if user qualifies for this tier
            IF v_current_value >= v_badge.threshold THEN
                -- Check if user already has this or higher tier
                SELECT tier INTO v_current_tier
                FROM user_badges WHERE user_id = p_user_id AND track = v_badge.track;

                IF NOT FOUND OR v_current_tier < v_badge.tier THEN
                    -- Award or upgrade badge
                    INSERT INTO user_badges (user_id, badge_id, track, tier)
                    VALUES (p_user_id, v_badge.id, v_badge.track, v_badge.tier)
                    ON CONFLICT (user_id, track)
                    DO UPDATE SET badge_id = v_badge.id, tier = v_badge.tier, earned_at = now();

                    v_new_badges := v_new_badges || jsonb_build_object(
                        'track', v_badge.track,
                        'tier', v_badge.tier,
                        'name', v_badge.name
                    );
                END IF;

                -- Skip lower tiers of same track (we iterate desc)
                CONTINUE;
            END IF;
        END;
    END LOOP;

    RETURN v_new_badges;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Backend Changes

### New File: `backend/routers/rewards.py`

```python
router = APIRouter(prefix="/api", tags=["rewards"])

@router.get("/rewards")
async def get_user_rewards(
    current_user: dict = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
):
    """Get the user's badge progress across all tracks."""
    # Get all badge definitions
    definitions = supabase.table("badge_definitions").select("*").order("track").order("tier").execute()

    # Get user's earned badges
    earned = (
        supabase.table("user_badges")
        .select("*, badge_definitions(*)")
        .eq("user_id", current_user["id"])
        .execute()
    )

    # Get user stats for progress calculation
    user_id = current_user["id"]

    # Correct bets
    correct_bets_query = supabase.rpc("sql", {"query": f"""
        SELECT COUNT(*) as count FROM bets b
        JOIN markets m ON b.market_id = m.id
        WHERE b.user_id = '{user_id}'
        AND m.status = 'resolved' AND b.side = m.resolved_outcome
    """})  # NOTE: Use a proper RPC or endpoint for this

    # Build response with progress per track
    return {
        "tracks": _build_track_progress(
            definitions.data or [],
            earned.data or [],
            current_user,
        ),
        "badges": earned.data or [],
    }


@router.get("/rewards/badges/{user_id}")
async def get_user_badges(
    user_id: str,
    supabase: Client = Depends(get_supabase_client),
):
    """Get badges for any user (for leaderboard display)."""
    result = (
        supabase.table("user_badges")
        .select("*, badge_definitions(name, color, track, tier, description)")
        .eq("user_id", user_id)
        .execute()
    )
    return result.data or []


@router.post("/rewards/check")
async def check_badges(
    current_user: dict = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
):
    """Manually trigger badge check for current user."""
    result = supabase.rpc("check_and_award_badges", {
        "p_user_id": current_user["id"],
    }).execute()
    return {"new_badges": result.data or []}
```

### Badge Check Triggers

Call `check_and_award_badges` automatically after these events:
1. **After a bet is placed** — checks Degen and Whale tracks
2. **After a market resolves** — checks Oracle track for all participants
3. **After a payout** — checks Banana Baron track
4. **After a market is approved** — checks Architect track for the creator

Add these calls to the respective endpoints or as database triggers.

---

## Frontend Changes

### New Page: `frontend/src/app/rewards/page.tsx`

**Rewards Page** — accessible from the user profile dropdown.

**Layout:**
- Header: "Rewards" with subtitle "Track your achievements across Pheme"
- Organized by **track**, each in its own card:

For each track:
```
┌─────────────────────────────────────────┐
│ 🏆 Banana Baron — Total Coin Balance    │
│ "Grow your banana empire"               │
│                                         │
│ Current: 🍌 8,200 / 10,000             │
│ ████████░░░░░░ 82%                      │
│                                         │
│ ✓ Banana Sprout (5,000)   Earned!       │
│ ✓ Banana Tree (7,500)     Earned!       │
│ ◯ Banana Grove (10,000)   1,800 to go   │
│ ◯ Banana Mogul (20,000)   Locked        │
│ ◯ Banana Baron (50,000)   Locked        │
└─────────────────────────────────────────┘
```

Each tier shows:
- Checkmark if earned, empty circle if not
- Badge name and threshold
- "Earned!" for completed tiers
- "X to go" for the next tier
- "Locked" for tiers beyond the next

Use progress bars per track showing how close the user is to the next milestone.

### Update: `frontend/src/app/leaderboard/page.tsx`

Add badges next to each user on the leaderboard:

```tsx
<div className="flex items-center gap-1">
  {userBadges.map((badge) => (
    <div
      key={badge.track}
      className="relative group"
      title={badge.badge_definitions.name}
    >
      <div
        className="size-6 rounded-full flex items-center justify-center text-white text-xs font-bold cursor-default"
        style={{ backgroundColor: badge.badge_definitions.color }}
      >
        {badge.tier}
      </div>
      {/* Tooltip on hover */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background">
        {badge.badge_definitions.name}
      </div>
    </div>
  ))}
</div>
```

**Position:** Badges appear to the right of each user's name/info, before the coin count.

**Tooltip:** When hovering over a badge circle, display the badge's name in a tooltip.

### Update: User Profile Dropdown (`frontend/src/components/user-menu.tsx`)

Add "Rewards" to the dropdown menu items:
```typescript
const MENU_ITEMS = [
  { href: "/portfolio", label: "Portfolio", icon: "wallet" },
  { href: "/portfolio#positions", label: "Positions", icon: "bar-chart" },
  { href: "/portfolio#transactions", label: "Transaction History", icon: "list" },
  { href: "/notifications", label: "Notifications", icon: "bell" },
  { href: "/rewards", label: "Rewards", icon: "trophy" },  // NEW
];
```

### Update: `frontend/src/lib/api.ts`

```typescript
export function getUserRewards(): Promise<RewardsResponse> {
  return apiFetch("/api/rewards");
}

export function getUserBadges(userId: string): Promise<UserBadge[]> {
  return apiFetch(`/api/rewards/badges/${userId}`);
}

export function checkBadges(): Promise<{ new_badges: any[] }> {
  return apiFetch("/api/rewards/check", { method: "POST" });
}
```

### Update: `frontend/src/lib/types.ts`

```typescript
export interface BadgeDefinition {
  id: string;
  track: string;
  tier: number;
  name: string;
  description: string;
  threshold: number;
  color: string;
}

export interface UserBadge {
  id: string;
  user_id: string;
  badge_id: string;
  track: string;
  tier: number;
  earned_at: string;
  badge_definitions: BadgeDefinition;
}

export interface TrackProgress {
  track: string;
  track_display_name: string;
  track_description: string;
  current_value: number;
  next_threshold: number | null;
  current_tier: number;
  max_tier: number;
  tiers: BadgeDefinition[];
}

export interface RewardsResponse {
  tracks: TrackProgress[];
  badges: UserBadge[];
}
```

---

## Track Display Names & Descriptions

| Track Key | Display Name | Description |
|-----------|-------------|-------------|
| `banana_baron` | Banana Baron | Grow your banana empire |
| `oracle` | Oracle | Predict the future with accuracy |
| `architect` | Architect | Build markets for the community |
| `degen` | Degen | You can't stop, won't stop betting |
| `whale` | Whale | Go big or go home |

---

## Testing Checklist

- [ ] Badge definitions are seeded correctly (25 badges across 5 tracks)
- [ ] User earns Banana Sprout badge when balance reaches 5,000
- [ ] Badge upgrades correctly (Sprout → Tree at 7,500)
- [ ] Only one badge per track per user (highest tier)
- [ ] Badges display on leaderboard next to each user
- [ ] Hovering over a badge shows its name in a tooltip
- [ ] Rewards page shows all 5 tracks with progress bars
- [ ] Earned tiers show checkmarks, next tier shows progress, future tiers show "Locked"
- [ ] Badge check is triggered after relevant events (bet, resolve, payout, market approved)
- [ ] New badge notification is sent when a badge is earned (uses Feature 07)
- [ ] Rewards link appears in user profile dropdown
