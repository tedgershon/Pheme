# Pheme product and architecture

Pheme lets the CMU community propose and trade on campus prediction markets
using free virtual banana currency. The currency has no purchase, sale or
cash-out path. Pool shares indicate participation, not guaranteed forecasts.

## Architecture

- Next.js serves pages and uses Supabase sessions. TanStack Query manages API
  data, optimistic mutations and cache invalidation. `SessionProvider` holds
  session state; the guest sentinel is frontend-only and grants no API access.
- FastAPI validates requests and resolves authenticated users to profile roles.
  Routers coordinate PostgreSQL RPCs and lifecycle transitions.
- Supabase provides PostgreSQL, Auth and avatar Storage. SQL functions implement
  wallet changes, bets and payouts; RLS adds database access controls.
- Sentry and request-context logging support error diagnosis. See
  [OBSERVABILITY.md](OBSERVABILITY.md).

The repository includes a Vercel backend configuration. It contains no Redis
or WebSocket implementation. Resolutions and unread counts poll every 30
seconds; other query refreshes use cache staleness, focus and mutation
invalidation. Persistent hosting and push updates are proposed in
[#30](https://github.com/tedgershon/Pheme/issues/30).

## Identity, roles and wallets

Supabase authenticates accounts; the auth trigger restricts new accounts to
`@andrew.cmu.edu`, with exact-email exceptions explicitly approved by a database
operator. Exceptions permit signup only, never automatic role promotion.
Profiles have `user`, `admin` or `super_admin` roles. Admins
review markets and adjudicate escalations; super admins additionally manage
roles. Role-preview controls affect presentation only. See
[AUTHZ_MATRIX.md](AUTHZ_MATRIX.md) for the intended permissions and known gaps.

The initial grant is 1,000 bananas. A user can claim once per
`America/New_York` calendar day when spendable balance is below 5,000. The
amount is `min(1000, 5000 - banana_balance)`; active stakes do not count toward
that cap. Bets, claims, refunds and payouts must update balances and ledger
entries transactionally. This is the development contract; remaining SQL
enforcement and retry gaps are tracked in
[#38](https://github.com/tedgershon/Pheme/issues/38).

## Market creation and betting

New proposals enter `pending_review`. Admins may edit criteria and approve
them to `open`, or deny them with feedback. Unreviewed proposals whose close
time passes are denied by lifecycle normalization. Creators cannot edit
submitted markets. Policy forbids creators from betting on their own markets;
multichoice SQL enforcement still needs the correction in #38.

Binary markets have YES/NO pools. Multichoice markets accept 2–10 options and
an exclusive/non-exclusive type. Bets must have positive amounts, sufficient
balance, a valid outcome and an open market whose close time has not passed.
Wallet and pool updates belong in the database transaction.

The current market-text limits live in `backend/schemas/market.py`: title 160,
description/resolution criteria 2,000, official source 300, individual criteria
1,000, link 2,048 and option label 80 characters. Creation requires a future
close time. Tighter limits and inline field errors are planned in
[#20](https://github.com/tedgershon/Pheme/issues/20) and
[#21](https://github.com/tedgershon/Pheme/issues/21).

## Resolution and settlement

The lifecycle coordinator is `backend/services/market_state_machine.py`.
Reads and actions normalize expired state; these transitions are not proof
that a continuously running scheduler is deployed.

1. An open market closes when its deadline passes. SQL sets a resolution
   window on close, but the application does not automatically start every
   closed market's community track.
2. The creator can propose YES/NO, entering `pending_resolution` with a
   24-hour dispute window. An uncontested proposal is finalized after expiry.
3. Policy allows an eligible non-creator, non-bettor to dispute a proposal;
   the filing RPC enforces both exclusions and requires a non-null proposal and dispute deadline.
   Neutral dispute voters choose YES/NO; voting no longer requires a stake.
   After the 48-hour voting deadline, at least three votes and a non-tied majority settle the market;
   otherwise it enters `admin_review`.
4. Alternatively, the creator explicitly starts community resolution from
   `closed`, setting a fresh 24-hour window and `pending_resolution` without a
   proposed outcome. Creators cannot vote; bettors may participate in this
   track. At least three votes and a non-tied majority settle it, otherwise it
   enters `admin_review`.
5. Escalated markets use the admin settlement RPC. Current binary schemas and
   SQL accept YES/NO. The missing queue UI and AMBIGUOUS refund support are
   tracked in [#31](https://github.com/tedgershon/Pheme/issues/31).

Binary winning stakes receive a proportional share of the full pool, truncated
to two decimal places. If the winning pool is empty, SQL refunds all stakes.
Community winners also receive a reward based on 4% of
the pool (rounded per winning voter to two decimals). Community settlement validates the expired window, quorum and majority in SQL, then pays bettors and winning voters in one transaction. Any reward failure rolls back the entire settlement. A private receipt makes same-outcome retries harmless and rejects unrelated reward calls; the reward percentage remains fixed at 4%.
Settlement must not be bypassed by direct edits to outcomes or balances.

Multichoice creation and betting are implemented, but the application
resolution path remains binary. Option-based governance and integration of
the multichoice settlement RPC are tracked in
[#32](https://github.com/tedgershon/Pheme/issues/32).

Admin backroll cancels bets after a cutoff and refunds affected users through
an RPC. Refunds adjust the matching binary or option pool. The bet-placement ledger remains an auditable participation record, so refunded bettors cannot file disputes or cast dispute votes. It cannot operate on a resolved market. Resolved content is guarded
against edits. See the SQL source for the currently implemented restrictions.

## Supporting surfaces

- Portfolio shows positions, transaction history and proposed-market sections.
  Proposal ownership isolation is being corrected in
  [#9](https://github.com/tedgershon/Pheme/issues/9).
- The leaderboard supports net-worth gain (balance plus unresolved stakes minus
  grants/claims) and a weekly payout-based view. Those measures are different;
  do not label gross payouts as net prediction returns.
- Badge tracks are Banana Baron, Oracle, Architect, Degen and Whale, each with
  five tiers. Store the highest earned tier per track; profiles may equip badges.
- In-app notifications cover market review, closure and reminders through the
  menu. Full history, settlement/badge events and email delivery are tracked in
  [#34](https://github.com/tedgershon/Pheme/issues/34),
  [#35](https://github.com/tedgershon/Pheme/issues/35) and
  [#33](https://github.com/tedgershon/Pheme/issues/33).
- Home currently reuses market browsing. Distinct home/browse layouts remain
  in [#18](https://github.com/tedgershon/Pheme/issues/18) and
  [#19](https://github.com/tedgershon/Pheme/issues/19).

See [DATA_MODEL.md](DATA_MODEL.md) for persistence details and
[MIGRATIONS.md](MIGRATIONS.md) before provisioning a database.

Multichoice betting enforces creator exclusion (including admin creators) and the closing deadline inside the transaction.
