# Pheme product and architecture

Pheme lets the CMU community propose and trade on campus prediction markets
using free virtual Tartan Coins. The currency has no purchase, sale or
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
roles. Role-preview controls affect presentation only: an admin can choose
"View as User" in the account menu to see the UI as a regular
user until they exit, reload or sign out, while the server keeps using their
real role. See
[AUTHZ_MATRIX.md](AUTHZ_MATRIX.md) for the intended permissions and known gaps.

The initial grant is 1,000 Tartan Coins. A user can claim once per
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

The market-text limits live in `backend/schemas/market.py` and are mirrored
in `frontend/src/lib/constants.ts`: title 120, description and resolution
criteria 800, official source 200, individual criteria 400, link 500 and option
label 80 characters. `close_at` must fall between one hour and 180 days after
the request, on creation and when an admin edits it during review; existing
markets are not migrated. The create-market form clamps its date picker to that
window in the selected timezone, shows backend `VALIDATION_FAILED` messages
under the matching inputs, and clears only the edited field's message.

## Resolution and settlement

The lifecycle coordinator is `backend/services/market_state_machine.py`.
Reads and actions normalize expired state; these transitions are not proof
that a continuously running scheduler is deployed.

1. An open market closes when its deadline passes. SQL sets a resolution
   window on close, but the application does not automatically start every
   closed market's community track.
2. The creator can propose YES/NO, entering `pending_resolution` with a
   24-hour dispute window. An uncontested proposal is finalized after expiry.
3. Authenticated non-creators, including active and refunded bettors, may
   dispute a proposal with an explanation. The filing RPC excludes creators,
   binds the submitter to the caller's JWT and requires a non-null proposal
   and active dispute deadline. The first submission opens one market-level
   case; until the case's voting deadline, other non-creators can add one
   concern each (no amendments, no deadline extension, no second case).
   Neutral dispute voters choose YES/NO; voting no longer requires a stake.
   After the 48-hour voting deadline, at least three votes and a non-tied majority settle the market;
   otherwise it enters `admin_review`.
4. Alternatively, the creator explicitly starts community resolution from
   `closed`, setting a fresh 24-hour window and `pending_resolution` without a
   proposed outcome. Creators cannot vote; bettors may participate in this
   track. At least three votes and a non-tied majority settle it, otherwise it
   enters `admin_review`.
5. Escalated markets appear in the Resolve Markets queue (`/admin/resolve`) with their
   criteria, proposal, dispute explanation, vote tallies and deadlines. A
   non-creator admin resolves YES or NO (binary payout) or AMBIGUOUS (every
   stake refunded, recorded as `refund` ledger entries) through
   `admin_resolve_market`, which locks the market and settles in one
   transaction; repeats are rejected without new credits. Only this admin path
   can settle an `admin_review` market. Multichoice markets can only be
   refunded here until [#32](https://github.com/tedgershon/Pheme/issues/32).

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
an RPC. Refunds adjust the matching binary or option pool. The bet-placement ledger remains an auditable participation record, so refunded bettors remain excluded from dispute voting while retaining permission to file disputes. It cannot operate on a resolved market. Resolved content is guarded
against edits. See the SQL source for the currently implemented restrictions.

## Rewards

Each track has five tiers. Profiles retain the highest earned tier in each track
and may equip badges for the leaderboard.

| Track | Progress measure | Highest tier |
| --- | --- | --- |
| Tartan Pipes | Tartan Coin balance | Pipe Major |
| Oracle | Correct predictions | Oracle |
| Architect | Approved markets created | Architect |
| Buggy Crew | Number of bets placed | Sweepstakes Veteran |
| Highland Games | Largest single stake in Tartan Coins | Highland Champion |

## Supporting surfaces

- Portfolio shows positions, transaction history and proposed-market sections.
  Proposal ownership isolation is being corrected in
  [#9](https://github.com/tedgershon/Pheme/issues/9).
- The leaderboard supports net-worth gain (balance plus unresolved stakes minus
  grants/claims) and a weekly payout-based view. Those measures are different;
  do not label gross payouts as net prediction returns.
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

Dispute filing and dispute voting have different eligibility rules: bettors may file concerns but cannot vote on disputes. Each market keeps one dispute case and one voting lifecycle; concerns are collected as individual submissions under it ([#49](https://github.com/tedgershon/Pheme/issues/49)). Explanations are public so neutral voters can read them, submitters are visible only to admins, and Monitor Disputes (`/admin/disputes`) lists every case with its submissions (read-only; settlement stays in Resolve Markets, `/admin/resolve`).
