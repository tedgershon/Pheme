# Pheme Project Specification

## Project Title

Pheme: CMU's Prediction Market

## Team Members

- Aaron Tang (`at2`)
- Ted Gershon (`tgershon`)
- Jonathan Gu (`jgu2`)

## Project Overview

Pheme is a campus prediction market for the CMU community Users create and trade on markets about campus events using a virtual banana currency The product is inspired by prediction market platforms such as Polymarket and Kalshi, but it is scoped around campus life and culture

Each user starts with an allocation of "banana currency" Users spend bananas to buy YES or NO positions on markets, and their balances grow when they make accurate predictions The platform uses a parimutuel-style pool model where displayed probability is derived from pool distribution, and winning positions receive a proportional share of the final pool after settlement

For resolution flow, markets are creator-resolved first, but outcomes that are disputed can move into a voter process where neutral voters (who don't bet) stake bananas to vote on the correct result Majority voters are rewarded from the pool to encourage honest voting and provide a governance mechanism for contested markets

## Scope Priorities

To address reviewer feedback about project direction, the team is explicitly separating the project into MVP goals, main goals, and stretch goals This is intended to keep the team focused on a coherent baseline product before expanding into more dynamic or technically ambitious features

### MVP Goals

The MVP is the smallest version of Pheme that still feels like a real campus prediction market instead of a static demo

- Users can browse markets and open a market detail page
- Users can create a market with a title, description, close time, and resolution criteria
- Users can place YES or NO bets using banana currency
- The application updates balances and market pool totals correctly after each bet
- The application shows a basic portfolio view and a public leaderboard
- A market creator can resolve a closed market
- The application can settle a resolved market and update balances accordingly

### Main Goals

These are the goals that make Pheme distinct from a very simple betting site

- Persistent backend data for users, markets, trades, and balances
- Market lifecycle from open to close to resolved
- A dispute process that allows contested markets to move into a voter-based workflow
- A voter incentive mechanism that rewards majority voters
- Admin moderation and override tools for broken or unclear market outcomes
- A deployed version of the application that course staff can access remotely

### Stretch Goals

These are worthwhile features, but they are not required for the project to feel complete

- WebSocket live market updates instead of simple polling
- OAuth based auth instead of a simpler local or session-based auth flow, implements non-crypto KYC through verifying Andrew IDs to minimize market manipulation
- Portfolio analytics, charts, or community stats

### Extended Goals (Sprint 4+)

These features extend the platform significantly beyond the original MVP and main goals:

- Non-binary (multichoice) markets with up to 10 options and multiple payout schemas
- Admin review workflow for all proposed markets (pending_review → approved/denied)
- Super admin account with user role management capabilities
- Automated community resolution voting with voter rewards (4% of pool)
- Coin claiming rules with a 5,000 balance cap
- User profile dropdown with GitHub-style avatar menu
- In-app and email notifications via Resend API
- Homepage redesign with hottest market display, trending/top markets, and weekly leaderboard
- Badge and reward track system with 5 tracks and 5 tiers each
- Safety hardening: admin backroll for ambiguous timelines, concurrent bet protection, market immutability after submission

## Design Decisions

### Simple Resolution First

The project will begin with a simple, easy to understand resolution flow before attempting more complex governance

- A market creator resolves the market first
- If a participant disputes the resolution, the market enters a dispute state
- Neutral voters can vote on the disputed outcome with a small banana stake
- Majority voters are rewarded using a fixed, transparent rule
- Admin override remains available if the dispute flow does not produce a clean result

This keeps the resolution process understandable for users and realistic for the course timeline

### Real Time Updates: NOT MVP

Live updates are useful for a prediction market, but they are not required for the project to demonstrate its core value

- The team will prioritize a correct trading and settlement flow first
- Polling is an acceptable fallback if WebSockets are not ready in time
- WebSockets and Redis remain part of the intended technical direction, but they are treated as a stretch or polish feature rather than a dependency for the whole project

### Authentication and Deployment Plan

The team will use a staged approach rather than overcomplicating early sprints

- Sprint 1 may use a demo-user mode so the product flow can be built and demonstrated quickly
- Later sprints will add a more realistic session or authentication flow
- OAuth is a possible stretch goal, not a requirement for the MVP
- Deployment to a cloud-accessible environment is required before the final demo and is planned explicitly in Sprint 4

## Delivery Schedule

The course schedule gives the team four real build sprints before the final demo week

- Sprint 1: March 17 to March 22, 2026
  Product owner: Aaron Tang (`at2`)
- Sprint 2: March 23 to March 29, 2026
  Product owner: Ted Gershon (`tgershon`)
- Sprint 3: March 30 to April 5, 2026
  Product owner: Jonathan Gu (`jgu2`)
- Sprint 4: April 6 to April 12, 2026
  Product owner: Aaron Tang (`at2`)
- Final demo week begins April 13, 2026
  Demo lead: Aaron Tang (`at2`)

## Product Backlog

The full product backlog is maintained in a separate document:

- [PRODUCT_BACKLOG.md](/Users/aaron/s26_team_11/PRODUCT_BACKLOG.md)

## Sprint Backlogs

### Sprint 1: Clickable Market MVP

Dates: March 17 to March 22, 2026
Linear tag: `sprint-1`
Due date: March 22, 2026
Scope classification: MVP foundation

Product owner: Aaron Tang (`at2`)

Sprint goal:
Build a cohesive, clickable MVP for Pheme that proves the core market flow and gives the team a concrete frontend and API contract to iterate on

Demo target:
The team can demo browsing markets, opening a market, creating a market, and placing a YES or NO bet in a no-auth demo mode

Backlog items:

#### Setup and Frontend Foundation

Intended owner: Aaron Tang (`at2`)

Scope:

- Initialize repo structure for Nextjs and FastAPI
- Set up the frontend app shell and shared layout
- Define the route map for MVP views
- Define shared frontend data shapes and API contracts for Sprint 1
- Establish the no-auth demo-user assumption for early demos

#### Frontend MVP Flow

Intended owner: Aaron Tang (`at2`)

Scope:

- Build the landing experience
- Build market list and market detail pages
- Build create market page
- Build the place-bet flow
- Build portfolio and leaderboard shells
- Wire mock data through the happy path before backend integration

#### FastAPI MVP Data and Core APIs

Intended owner: Ted Gershon (`tgershon`)

Scope:

- Create the FastAPI project and app structure
- Set up the local PostgreSQL connection strategy
- Define starter data models for user balance, market, and bet data
- Expose core endpoints for market list, market detail, create market, and place bet

#### Trading Logic and Demo Integration

Intended owner: Jonathan Gu (`jgu2`)

Scope:

- Create seed demo users and sample markets
- Implement a simple no-auth demo-user selection path
- Define initial probability display logic from pool totals
- Integrate frontend views against the first backend endpoints
- Fix integration issues and prepare the Sprint 1 demo narrative

### Sprint 2: Persisted Trading Workflow

Dates: March 23 to March 29, 2026
Linear tag: `sprint-2`
Due date: March 29, 2026
Scope classification: MVP completion

Product owner: Ted Gershon (`tgershon`)

Sprint goal:
Move Pheme from a mock-first MVP into a persisted product flow where markets, trades, balances, and user-facing pages are backed by real data

Demo target:
The team can create a market, place trades against real backend data, and revisit portfolio and leaderboard views that reflect those trades

Backlog items:

#### Persistent Data Models and Trading Transactions

Intended owner: Ted Gershon (`tgershon`)

Scope:

- Finalize persistent data models for users, markets, and bets
- Replace starter in-memory assumptions with PostgreSQL-backed records
- Make the trade path transactional end to end
- Enforce closed-market and insufficient-balance rules in persistent logic

#### User State, Sessions, and Wallet Flow

Intended owner: Aaron Tang (`at2`)

Scope:

- Move beyond pure mock identity assumptions
- Establish a practical session or user-selection strategy for the app
- Connect wallet state to real backend data
- Make balance displays consistent across pages

#### Portfolio, Leaderboard, and Market State Integration

Intended owner: Jonathan Gu (`jgu2`)

Scope:

- Back the portfolio page with stored position data
- Back the leaderboard with real balance totals
- Display open and closed market states consistently in the frontend
- Remove remaining mock-only assumptions from the main user views

#### Sprint 2 QA, Presentation, and Backlog Handoff

Intended owner: Aaron Tang (`at2`)

Scope:

- Verify the persisted happy path before the sprint presentation
- Collect integration bugs and triage them quickly
- Prepare sprint presentation notes and visuals
- Draft the Sprint 3 backlog and record the next product owner

### Sprint 3: Resolution, Disputes, and Governance

Dates: March 30 to April 5, 2026
Linear tag: `sprint-3`
Due date: April 5, 2026
Scope classification: main goals

Product owner: Jonathan Gu (`jgu2`)

Sprint goal:
Build the unique Pheme market-resolution workflow so the product goes beyond a generic trading demo and demonstrates how outcomes are settled and contested

Demo target:
The team can show a market being resolved, disputed, voted on, and carried through a believable settlement process

Backlog items:

#### Resolution Workflow and Settlement Engine

Intended owner: Ted Gershon (`tgershon`)

Scope:

- Implement creator resolution actions
- Record final market outcomes
- Compute winning payout shares from the pool
- Finalize payout distribution and post-resolution state changes

#### Dispute Voting and Voter Incentive Flow

Intended owner: Jonathan Gu (`jgu2`)

Scope:

- Implement dispute flagging on resolved markets
- Separate bettor and voter roles where needed
- Create a voter staking and voting path
- Reward majority voters according to the project rule set

#### Admin Review and Moderation Controls

Intended owner: Aaron Tang (`at2`)

Scope:

- Expose moderation tools for invalid or conflicted markets
- Add an override path for broken resolutions
- Surface the key market and dispute state needed for debugging and demo control
- Make admin behavior understandable during presentations

#### Sprint 3 End-to-End Testing and Presentation

Intended owner: Aaron Tang (`at2`)

Scope:

- Verify the full flow from trade placement to final settlement
- Test at least one disputed market scenario
- Prepare the Sprint 3 presentation story and visuals
- Draft the Sprint 4 hardening backlog

### Sprint 4: Hardening, Deployment, and Final Demo Readiness

Dates: April 6 to April 12, 2026
Linear tag: `sprint-4`
Due date: April 12, 2026
Scope classification: deployment, polish, and selected stretch goals

Product owner: Aaron Tang (`at2`)

Sprint goal:
Turn the feature-complete prototype into a stable, demo-ready product that can survive remote access, code review, and the final staff walkthrough

Final sprint target:
By the end of Sprint 4, Pheme should be ready for the final demo week beginning April 13, 2026

Backlog items:

#### Validation, Security, and Edge Case Hardening

Intended owner: Ted Gershon (`tgershon`)

Scope:

- Validate inputs across creation, trading, resolution, and voting flows
- Close obvious security gaps such as unsafe input handling and broken state transitions
- Test edge cases around insufficient balance, duplicate actions, and invalid market state
- Tighten backend error handling for final demo stability

#### UX Polish and Live Update Strategy

Intended owner: Aaron Tang (`at2`)

Scope:

- Improve clarity of core pages and flows
- Polish the final demo path from market browsing through settlement
- Add lightweight live updates or polling where it materially improves the demo
- Remove rough edges that make the product feel incomplete

#### Deployment, Seed Data, and Remote Demo Environment

Intended owner: Jonathan Gu (`jgu2`)

Scope:

- Deploy the application to an environment reachable by course staff
- Configure the demo environment and database
- Load reliable seed users and markets for demonstration
- Verify the app works from a clean remote browser session

#### Final Demo Script, Documentation, and Code Review Prep

Intended owner: Aaron Tang (`at2`)

Scope:

- Write the final demo walkthrough order
- Prepare fallback demo scenarios and seeded accounts
- Ensure the repo has backlog artifacts and run instructions needed for review
- Do a final code review pass for modularity, clarity, and obvious cleanup opportunities

### Sprint 4 Extension: New Feature Implementation

Scope classification: major feature additions (see `features/` for detailed plans)

Sprint goal:
Implement 10 new feature areas organized into 4 implementation phases. See `features/course/instructions.md` for the complete orchestration plan (historical — these 10 features have shipped).

#### Phase 1 — Foundation (parallelizable, no dependencies)

- **Admin & Super Admin System** (`features/course/01-admin-system.md`): Role-based access control with user/admin/super_admin roles, admin review infrastructure, super admin user management, statistics dashboard
- **Coin Claiming Update** (`features/course/05-coin-claiming.md`): Daily claim cap at 5,000 coin balance, dynamic claim amounts, transparency text
- **User Profile Dropdown** (`features/course/06-user-profile.md`): GitHub-style circular avatar dropdown replacing sign-in/sign-out button

#### Phase 2 — Core Workflow (depends on Phase 1)

- **Market Creation & Admin Review** (`features/course/02-market-creation-review.md`): All markets start as pending_review, admin approval/denial workflow, link field, style linting
- **Market Resolution & Community Voting** (`features/course/04-market-resolution.md`): 24h community voting window, voter rewards (4% of pool), Resolutions tab with countdown
- **Safety Logic & Admin Backroll** (`features/course/10-safety-logic.md`): Hardened bet placement, market update restrictions, admin backroll for ambiguous timelines

#### Phase 3 — Extended Features (depends on Phase 2)

- **Multichoice Markets** (`features/course/03-multichoice-markets.md`): Non-binary markets with 2-10 options, multi-line charts, multichoice payout schema
- **Notifications** (`features/course/07-notifications.md`): In-app notification system with email via Resend API

#### Phase 4 — Polish & Display (depends on Phases 2-3)

- **Homepage Redesign** (`features/course/08-main-page.md`): Hottest market display, weekly leaderboard, trending/top markets sections
- **Claimable Rewards** (`features/course/09-claimable-rewards.md`): 5 badge tracks with 5 tiers each, leaderboard badges, rewards page

#### New Migrations

All new database migrations are documented in `project-specs/MIGRATIONS.md`. Migrations must be run manually in the Supabase SQL editor in numeric order, starting at `021`.

### Final Demo Week: Staff Demo and Buffer

Begins: April 13, 2026
Linear tag: `final-demo-week`
Due date: April 13, 2026
Scope classification: final demo and stabilization buffer

Demo lead: Aaron Tang (`at2`)

Supporting team:

- Ted Gershon (`tgershon`)
- Jonathan Gu (`jgu2`)

Goals:

- Run the prepared demo flow for course staff
- Guide the code review cleanly
- Keep a small buffer for emergency fixes that do not destabilize the deployment
- Verify the deployed app remains reachable during the review window

## Proposed Data Model

The full data model is maintained in a separate document:

- [DATA_MODEL.md](/Users/aaron/s26_team_11/DATA_MODEL.md)
