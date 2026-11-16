# Pheme Data Model

Operator-approved external signup emails live in `private.signup_email_exceptions`
(`email` primary key, `created_at`). The schema is not exposed through the API;
anon, authenticated and service-role clients cannot modify the list. Approval
permits signup but does not grant a role. No exceptions are seeded by migrations.

This describes the repository schema, not a verified deployed database. Exact
constraints and RPC definitions live in `supabase/migrations/`; read
[MIGRATIONS.md](MIGRATIONS.md) for bootstrap and checked legacy upgrades.

## Core Entities

### UserProfile

- `id` — UUID, PK, references `auth.users`
- `andrew_id` — unique CMU Andrew ID
- `display_name` — user's display name
- `banana_balance` — current coin balance (excludes coins locked in active bets)
- `role` — `'user'`, `'admin'`, or `'super_admin'` (default: `'user'`)
- `is_admin` — boolean, auto-synced from `role` for backward compatibility
- `avatar_url` — optional profile image URL; uploads use the public `avatars` storage bucket
- `equipped_badge_id` — legacy single equipped badge FK (nullable)
- `equipped_badges` — JSONB map of track to equipped badge ID, default `{}`
- `created_at` — timestamp

Purpose:
Stores the identity, wallet state, and role of each user

### Market

- `id` — UUID, PK
- `title` — market question/title
- `description` — detailed description
- `creator_id` — FK to `profiles`
- `created_at` — timestamp
- `close_at` — when the market stops accepting bets
- `status` — lifecycle state (see Status Values below)
- `resolution_criteria` — how the market is resolved
- `category` — market category (e.g., General, Academics, Sports)
- `market_type` — `'binary'` or `'multichoice'` (default: `'binary'`)
- `multichoice_type` — `'exclusive'` or `'non_exclusive'` (nullable, required for multichoice)
- `yes_pool_total` — total coins bet on YES (binary markets)
- `no_pool_total` — total coins bet on NO (binary markets)
- `official_source` — source for resolution verification
- `yes_criteria` — what counts as YES (binary markets)
- `no_criteria` — what counts as NO (binary markets)
- `ambiguity_criteria` — how to handle ambiguous outcomes
- `link` — optional URL for additional context (displayed publicly)
- `proposed_outcome` — creator's proposed resolution (`'YES'` or `'NO'`)
- `proposed_at` — when creator proposed resolution
- `dispute_deadline` — deadline for filing disputes after creator proposal
- `resolution_window_end` — community voting deadline; set on close and reset when the creator explicitly starts community resolution
- `resolved_outcome` — final resolution (`'YES'` or `'NO'`)
- `resolved_at` — when market was resolved
- `reviewed_by` — FK to `profiles`, admin who reviewed the market proposal
- `review_date` — when the market was reviewed
- `review_notes` — admin notes/feedback on the proposal

Purpose:
Stores the market question, timing, pool totals, review state, and settlement state

#### Market Status Values

| Status | Description |
|--------|-------------|
| `pending_review` | Market proposed by user, awaiting admin approval |
| `open` | Approved and accepting bets |
| `closed` | No longer accepting bets; awaiting creator proposal or community-resolution start |
| `pending_resolution` | Creator proposal with dispute deadline, or community track with no proposed outcome and a voting deadline |
| `disputed` | A dispute has been filed; voter-based adjudication in progress |
| `admin_review` | Escalated to admin for final resolution |
| `resolved` | Market has been resolved; payouts distributed |
| `denied` | Admin denied the market proposal |

### MarketOption (multichoice markets only)

- `id` — UUID, PK
- `market_id` — FK to `markets`
- `label` — option text
- `pool_total` — total coins bet on this option
- `sort_order` — display order
- `is_winner` — NULL while open, TRUE/FALSE after resolution
- `created_at` — timestamp

Purpose:
Represents one option in a multichoice market (2–10 options per market)

The SQL multichoice settlement function exists, but the application resolution
path still uses binary outcomes. Option-based settlement integration is tracked
in [#32](https://github.com/tedgershon/Pheme/issues/32). AMBIGUOUS is not an
accepted binary outcome in the current schema; refund support is tracked in
[#31](https://github.com/tedgershon/Pheme/issues/31).

### Bet

- `id` — UUID, PK
- `user_id` — FK to `profiles`
- `market_id` — FK to `markets`
- `side` — `'YES'` or `'NO'` (binary markets; NULL for multichoice)
- `option_id` — FK to `market_options` (multichoice markets; NULL for binary)
- `amount` — coins bet (must be positive)
- `created_at` — timestamp

Constraint: exactly one of `side` or `option_id` must be set.

Purpose:
Represents a single user trade on a market outcome

### ResolutionVote (dispute voting)

- `id` — UUID, PK
- `dispute_id` — FK to `disputes`
- `market_id` — FK to `markets`
- `voter_id` — FK to `profiles`
- `selected_outcome` — `'YES'` or `'NO'`
- `created_at` — timestamp
- Unique constraint: `(dispute_id, voter_id)`

Purpose:
Represents a neutral voter participation record for disputed markets

The historical `staked_amount` column was removed in iteration 011; current
dispute votes do not require a currency stake.

### CommunityVote (resolution voting)

- `id` — UUID, PK
- `market_id` — FK to `markets`
- `voter_id` — FK to `profiles`
- `selected_outcome` — `'YES'` or `'NO'`
- `created_at` — timestamp
- Unique constraint: `(market_id, voter_id)`

Purpose:
Represents a community vote during the 24-hour resolution period after market close

### Dispute

- `id` — UUID, PK
- `market_id` — FK to `markets` (unique — one dispute per market)
- `disputer_id` — FK to `profiles`
- `explanation` — reason for dispute
- `voting_deadline` — deadline for dispute voting
- `resolved_by_admin` — boolean
- `created_at` — timestamp

Purpose:
Represents a dispute filed against a creator's proposed market resolution

### Transaction

- `id` — UUID, PK
- `user_id` — FK to `profiles`
- `market_id` — FK to `markets` (nullable)
- `transaction_type` — see types below
- `amount` — signed amount (positive = credit, negative = debit)
- `created_at` — timestamp

Transaction types: `initial_grant`, `bet_placement`, `payout`, `voter_stake`, `voter_reward`, `daily_claim`, `resolution_vote_reward`

Purpose:
Append-only audit log tracking wallet-affecting events

### Notification

- `id` — UUID, PK
- `user_id` — FK to `profiles`
- `type` — category: `market_approved`, `market_denied`, `market_closed`, `market_resolved`, `payout_received`, `badge_earned`, `system`, `market_submitted`, `resolution_reminder` (requires the later notification migrations)
- `title` — notification title
- `body` — notification content
- `metadata` — JSONB for flexible data (market_id, badge_id, etc.)
- `is_read` — boolean (default false)
- `created_at` — timestamp

Purpose:
Stores in-app notifications for users

Lifecycle notifications use a partial unique index and the
`create_market_notification` RPC to deduplicate by user, type and market.
Defined types do not imply all producers exist: settlement, payout and badge
events are tracked in [#35](https://github.com/tedgershon/Pheme/issues/35).

### BadgeDefinition

- `id` — UUID, PK
- `track` — track name (`banana_baron`, `oracle`, `architect`, `degen`, `whale`)
- `tier` — 1–5
- `name` — badge name (e.g., "Banana Sprout")
- `description` — what the badge means
- `threshold` — numeric threshold to earn this badge
- `color` — hex color for badge display
- Unique constraint: `(track, tier)`

Purpose:
Defines the badge system with 5 tracks and 5 tiers each (25 total badges)

### UserBadge

- `id` — UUID, PK
- `user_id` — FK to `profiles`
- `badge_id` — FK to `badge_definitions`
- `track` — track name
- `tier` — current tier (highest earned)
- `earned_at` — timestamp
- Unique constraint: `(user_id, track)` — one badge per track per user

Purpose:
Tracks which badges each user has earned (highest tier per track)

## Relationship Summary

- A `UserProfile` can create many `Market` records
- A `UserProfile` can place many `Bet` records
- A `Market` can have many `Bet` records
- A `Market` (multichoice) can have many `MarketOption` records (2–10)
- A `Bet` on a multichoice market references one `MarketOption`
- A disputed `Market` can have many `ResolutionVote` records
- A closed `Market` can have many `CommunityVote` records
- A `Market` can have at most one `Dispute`
- A `UserProfile` can have many `Transaction` records
- A `UserProfile` can have many `Notification` records
- A `UserProfile` can have many `UserBadge` records (one per track)
- A `UserBadge` references one `BadgeDefinition`

## Modeling Notes

- `Market.status` captures the full lifecycle: `pending_review` → `open` → `closed` → resolution → `resolved` (or `denied`)
- `Bet.side` captures `YES` or `NO` for binary markets; `Bet.option_id` captures the chosen option for multichoice markets
- `Transaction.transaction_type` distinguishes wallet events: initial grant, bet placement, payout, voter stake, voter reward, daily claim, and resolution vote reward
- Portfolio state is derived from `Bet` and `Transaction` records
- The `role` column on `profiles` replaces the older `is_admin` boolean for access control, with `is_admin` kept in sync via trigger for backward compatibility
- Community votes (resolution voting) are separate from resolution votes (dispute voting) to support the dual-track resolution model
- Badge progression within a track replaces the previous badge (only the highest tier is stored)

## Access and transaction boundaries

- RLS policies live in the SQL history. Public profile/market data and
  owner-scoped wallet/notification data have different rules; API authorization
  policy is in [AUTHZ_MATRIX.md](AUTHZ_MATRIX.md).
- Labels such as "internal criteria" in a form do not guarantee confidentiality.
  Market response models include source and criteria fields; review serialization
  and database policy before describing any field as admin-only.
- The ledger records signed wallet changes. `voter_stake` and `voter_reward`
  remain accepted legacy types; their presence does not imply current vote staking.
- Balance and ledger changes must stay together in transactional RPCs. Separate
  settlement and reward RPC calls are not one transaction; retry/concurrency
  behavior must be verified when changing the lifecycle engine.
