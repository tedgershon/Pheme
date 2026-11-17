-- seeds/TEARDOWN.sql
--
-- See seeds/README.md. Removes the 8 legacy fixture users
-- (rhendrix, ebachman, bgilfoyl, dchughta, jdunn, mhall, gbelson, nbighett)
-- and every market, bet, vote, dispute, transaction, and notification owned
-- by them or attached to their markets. Scoping is by Andrew ID; inspect
-- matching profiles before use because an ID match does not prove fixture origin.
--
-- This file is documentation, not auto-applied. Paste into the Supabase
-- SQL editor (or psql with service-role credentials) to run.
--
-- To preview without committing, change the final COMMIT to ROLLBACK.
-- Row-count output appears in the editor's result panel.
--
-- Delete order follows the FK graph since most FKs from referenced tables
-- to profiles/markets do NOT have ON DELETE CASCADE.
--
-- Real users who placed bets on fixture markets are refunded *before* the
-- fixture rows are deleted, so banana_balance stays in sync with the
-- transactions ledger. (An earlier version of this file deleted real
-- users' bet_placement rows along with the fixture market, leaving the
-- balance silently short -- see PR #5 commit history for context.)
--
-- Note on Supabase's database advisor: it flags the two CREATE TEMP TABLE
-- statements below as "tables without RLS". That is a false positive --
-- temp tables live in a private per-session pg_temp_* schema, are visible
-- only to the connection that created them, and disappear at COMMIT via
-- ON COMMIT DROP. RLS does not apply.

BEGIN;

CREATE TEMP TABLE fixture_user_ids ON COMMIT DROP AS
SELECT id FROM profiles
WHERE andrew_id IN (
  'rhendrix','ebachman','bgilfoyl','dchughta',
  'jdunn','mhall','gbelson','nbighett'
);

CREATE TEMP TABLE fixture_market_ids ON COMMIT DROP AS
SELECT id FROM markets
WHERE creator_id IN (SELECT id FROM fixture_user_ids);

-- Real-user make-whole pass. Any real (non-fixture) user with transactions
-- tied to a fixture market gets their cumulative net position on those
-- markets reversed, so deleting the markets doesn't leave their balance
-- out of sync with the ledger.
CREATE TEMP TABLE real_user_fixture_impact ON COMMIT DROP AS
SELECT
  t.user_id,
  SUM(t.amount) AS net_change
FROM transactions t
WHERE t.market_id IN (SELECT id FROM fixture_market_ids)
  AND t.user_id NOT IN (SELECT id FROM fixture_user_ids)
GROUP BY t.user_id;

-- Reverse the impact on banana_balance.
UPDATE profiles
SET banana_balance = banana_balance - r.net_change
FROM real_user_fixture_impact r
WHERE profiles.id = r.user_id;

-- Document the reversal in the ledger. market_id is NULL because the
-- market each entry would reference is about to be deleted (FK is not
-- ON DELETE SET NULL, so we set it explicitly here). 'payout' for credits
-- (user is being made whole on lost fixture bets); 'bet_placement' for
-- debits (clawback on fixture bets the user happened to win).
INSERT INTO transactions (user_id, market_id, transaction_type, amount)
SELECT
  user_id,
  NULL,
  CASE WHEN -net_change >= 0 THEN 'payout' ELSE 'bet_placement' END,
  -net_change
FROM real_user_fixture_impact
WHERE net_change <> 0;

-- Resolution + community votes (FKs: voter_id, market_id, both non-cascading)
DELETE FROM resolution_votes
 WHERE voter_id IN (SELECT id FROM fixture_user_ids)
    OR market_id IN (SELECT id FROM fixture_market_ids);

DELETE FROM community_votes
 WHERE voter_id IN (SELECT id FROM fixture_user_ids)
    OR market_id IN (SELECT id FROM fixture_market_ids);

-- Dispute submissions (FKs: dispute_id, market_id, submitter_id) before their disputes
DELETE FROM dispute_submissions
 WHERE submitter_id IN (SELECT id FROM fixture_user_ids)
    OR market_id IN (SELECT id FROM fixture_market_ids)
    OR dispute_id IN (SELECT id FROM disputes
        WHERE disputer_id IN (SELECT id FROM fixture_user_ids));

-- Disputes (FKs: disputer_id, market_id)
DELETE FROM disputes
 WHERE disputer_id IN (SELECT id FROM fixture_user_ids)
    OR market_id IN (SELECT id FROM fixture_market_ids);

-- Bets (FKs: user_id, market_id). Real users' bets on fixture markets are
-- already accounted for via the make-whole pass above, so deleting them
-- here is safe.
DELETE FROM bets
 WHERE user_id IN (SELECT id FROM fixture_user_ids)
    OR market_id IN (SELECT id FROM fixture_market_ids);

-- Transactions: delete fixture users' entire ledger. Real users' rows that
-- referenced a fixture market need their market_id nulled (the make-whole
-- pass above has already balanced their accounts; we keep their history
-- but strip the dangling market reference so the upcoming markets DELETE
-- doesn't fail on the FK).
UPDATE transactions SET market_id = NULL
WHERE market_id IN (SELECT id FROM fixture_market_ids)
  AND user_id NOT IN (SELECT id FROM fixture_user_ids);

DELETE FROM transactions
 WHERE user_id IN (SELECT id FROM fixture_user_ids);

-- Defensive: null out reviewed_by on any non-fixture market a fixture user
-- ever reviewed. Fixtures aren't admins so this is expected 0 rows; left
-- in for safety if a fixture were ever promoted via direct UPDATE.
UPDATE markets SET reviewed_by = NULL
WHERE reviewed_by IN (SELECT id FROM fixture_user_ids)
  AND id NOT IN (SELECT id FROM fixture_market_ids);

-- Fixture markets (FKs: creator_id, reviewed_by). market_options has
-- ON DELETE CASCADE on market_id, so option rows clean up automatically.
DELETE FROM markets WHERE id IN (SELECT id FROM fixture_market_ids);

-- auth.users -- cascades down to profiles, notifications, user_badges via
-- ON DELETE CASCADE on those tables. Scoping by id (not email) means a
-- real OAuth signup that happens to share the @andrew.cmu.edu domain
-- but uses a different Andrew ID is untouched.
DELETE FROM auth.users
 WHERE id IN (SELECT id FROM fixture_user_ids);

COMMIT;
