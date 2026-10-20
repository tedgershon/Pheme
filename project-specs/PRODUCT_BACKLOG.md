# Pheme Product Backlog

Linear tag: `product-backlog`
Linear link: https://linear.app/banangains/team/BAN/all
Due date: April 13, 2026

## 1. Market Discovery and Market Detail Experience

Users can browse active and resolved markets, open a market detail page, and understand the market question, resolution criteria, displayed probability, pool totals, close time, and current status.

Includes:

- home or market feed
- market cards and status badges
- market detail page
- filtering or grouping by status or category
- clear presentation of probability and pool data

## 2. Market Creation and Lifecycle Management

Users can create markets with a title, description, close time, and explicit resolution criteria. Market creators and admins can manage market states such as open, closed, resolved, and disputed.

Includes:

- create market form
- validation for required fields
- market status transitions
- creator-facing management actions
- rules around when a market can still be edited or closed

## 3. Trading Engine and Pool Accounting

Users can buy YES and NO positions using banana currency. The backend records each trade transactionally, updates pool totals safely, and exposes a probability display derived from the parimutuel pool distribution.

Includes:

- YES or NO trade placement
- pool updates and transactional balance deduction
- displayed probability calculation
- closed-market restrictions
- invalid trade amount validation

## 4. User Identity and KYC

The application tracks who a user is, what their banana balance is, and how their state persists across requests. Sprint 1 may use a demo-user shortcut, but the final product still needs explicit user identity and wallet state.

Includes:

- user profile or account record tied to an andrew ID
- banana balance and initial allocation
- session or login strategy appropriate for the final demo
- wallet state retrieval
- user-specific data access rules

## 5. Portfolio, Positions, and Trade History

Users can inspect the markets they have participated in, their current YES and NO positions, and the outcome of resolved markets.

Includes:

- portfolio page
- active positions by market
- resolved positions and payouts
- trade history or transaction history
- clear balance changes after settlement

## 6. Leaderboard

The application ranks users by banana holdings and makes competitive progress visible.

Includes:

- leaderboard page
- ranking by current banana total
- tie-breaking or ordering rules
- visibility into who is leading the game
- optional supporting stats such as recent movement or gain-or-loss summaries

## 7. Resolution and Settlement

Markets can be resolved after they close, and winning positions receive their share of the pool according to Pheme settlement rules

Includes:

- creator resolution action
- resolved outcome recording
- settlement calculation
- payout distribution
- frozen settlement window where needed before payout is finalized

## 8. Disputes, Voting, and Governance

If a market resolution is contested, participants can trigger a dispute workflow and neutral voters can vote on the outcome with a small stake. Majority voters receive a reward from the pool.

Includes:

- dispute flagging
- bettor versus voter distinction
- voter staking flow
- majority vote reward logic
- escalation path to admin review when consensus is unclear

## 9. Admin Control

The team needs a moderation surface for invalid markets, abuse handling, and resolution conflicts so the application can be demonstrated safely

Includes:

- admin review tools
- moderation of bad or duplicate markets
- override path for broken or disputed resolutions
- visibility into user, market, and settlement state
- protective rules around misuse and bad data

## 10. Live Updates, Deployment and Demo

The application should feel responsive during demos and must be accessible to course staff remotely by the final review

Includes:

- live or polled probability refresh
- deployment to a remotely accessible environment
- seed data for demo accounts and markets
- presentation and demo script readiness
- final verification that the system is usable from a clean browser session

---

## New Feature Backlog (Sprint 4+)

The following items extend the product beyond the initial MVP and main goals. Detailed implementation plans are in `features/`.

### 11. Admin & Super Admin System

Establish role-based access control with user, admin, and super_admin roles. Build admin review infrastructure, super admin user management, role preview toggle, and cumulative statistics dashboard.

Includes:

- role column on profiles replacing boolean is_admin
- super admin seeded account (tgershon) for user management
- admin statistics dashboard (user counts, market counts, total trading volume)
- role preview toggle for admins to see the app as other roles
- user search and role promotion/demotion (super admin only)

### 12. Market Creation & Admin Review Workflow

All newly created markets start in pending_review status. Admins review, edit, and approve or deny markets through an accordion-style admin panel.

Includes:

- pending_review default status for all new markets
- admin review page with pending, approved, denied accordion sections
- editable market fields during review
- notes/feedback system for admin communication to creators
- link field with URL validation on market creation
- visual distinction between public-facing and admin-only fields
- automatic style linting (capitalization, whitespace, punctuation) before submission
- pending review count badge in admin navigation

### 13. Non-Binary (Multichoice) Markets

Allow markets with 2–10 non-binary options. Support mutually exclusive and non-exclusive outcome types with appropriate payout schemas.

Includes:

- market type selector (binary vs multichoice) during creation
- market_options table for multichoice market choices
- multi-line probability chart with option toggle
- parimutuel payout distribution across multiple options
- more bets toggle for markets with many options
- multichoice bet placement endpoint

### 14. Automated Market Resolution & Community Voting

Add a parallel resolution track alongside creator-resolution. When a market closes, a 24-hour community voting window opens. Voters earn coin rewards for correct votes.

Includes:

- resolution_window_end auto-set when market closes
- community_votes table for resolution voting
- Resolutions tab in navbar showing markets in resolution period with countdown timers
- voter reward distribution (4% of total market pool)
- fallback to admin review for inconclusive votes
- dual-track resolution (creator resolution and community voting coexist)

### 15. Coin Claiming Rules Update

Update daily coin claiming to cap at 5,000 coin balance. Dynamic claim amounts when balance is between 4,000 and 5,000.

Includes:

- balance cap check (only claim if balance < 5,000)
- dynamic claim amount (min of 1,000 or 5,000 minus balance)
- transparency text explaining rules in UI
- cap applies to coin balance only, not active bets

### 16. User Profile Dropdown

Replace sign-in/sign-out button with a circular profile avatar. On click, display a GitHub-style dropdown card with navigation items.

Includes:

- circular avatar with initials (default gray)
- dropdown with profile info, navigation links, and sign out
- notification indicator dot on avatar
- sign-in button for unauthenticated users

### 17. In-App & Email Notifications

Notification system with in-app notifications and email via Resend. Triggered by admin market approval/denial events.

Includes:

- notifications table with type, title, body, metadata, read status
- notification page listing all notifications
- unread count badge in user menu dropdown
- red indicator dot on avatar for unread notifications
- email notifications via Resend API to @andrew.cmu.edu addresses
- notification types: market_approved, market_denied, market_resolved, payout_received, badge_earned

### 18. Homepage Redesign

Rebuild the homepage with hottest market display, weekly leaderboard, and trending/top markets sections.

Includes:

- hottest market hero display (Kalshi-style) with graph, percentages, volume, and pagination
- weekly leaderboard based on rolling 7-day gains (with 30-day and all-time fallbacks)
- progress bars proportional to the leader for leaderboard entries
- trending markets tab (recency + activity threshold)
- top markets tab (total coin volume)
- Kalshi-style numbered list (#1–#3) for trending and top markets

### 19. Claimable Rewards — Badges & Reward Tracks

Gamification layer with 5 badge tracks and 5 tiers each. Badges displayed on leaderboard with hover tooltips.

Includes:

- badge tracks: Banana Baron (coins), Oracle (correct bets), Architect (markets created), Degen (bets placed), Whale (single bet amount)
- progressive badges within tracks (advancing replaces current badge)
- rewards page with progress tracking per track
- badge display on leaderboard with hover tooltips
- automatic badge checking after relevant events

### 20. Safety Logic & Admin Backroll

Enforce critical safety contracts and add admin backroll for ambiguous timeline markets.

Includes:

- hardened place_bet function with close_at timestamp check
- removal of creator market update permissions after submission
- resolved market guard trigger preventing content modification
- admin backroll function to cancel bets after a cutoff date and refund users
- concurrent bet safety via PostgreSQL FOR UPDATE locks (verified, already present)
