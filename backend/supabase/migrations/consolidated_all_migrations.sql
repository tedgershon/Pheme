-- ============================================================================
-- CONSOLIDATED MIGRATION: 001 through 049
-- Pheme — Complete database schema from initial setup to all features
-- ============================================================================
-- This file concatenates every migration from 001 to 049 (inclusive) in
-- numerical order.  Migrations that don't exist on disk are skipped.
-- 007_dispute_voting.sql is deprecated (no-op) and omitted; the real 007
-- is 007_expand_market_status.sql.
--
-- Included migrations (44 files):
--   001  Initial Schema
--   002  place_bet function
--   003  Auto Close Markets
--   004  resolve_market function
--   006  Auth CMU Domain Trigger
--   007  Expand Market Status (dispute_voting variant is deprecated)
--   008  Market Governance Columns
--   009  Admin Flag
--   010  Disputes Table
--   011  Update Resolution Votes
--   012  Add daily_claim Transaction Type
--   013  fn_propose_resolution
--   014  fn_finalize_resolution
--   015  fn_file_dispute
--   016  fn_cast_dispute_vote
--   017  fn_admin_resolve
--   018  fn_claim_daily_bananas
--   019  fn_check_claimed_today
--   020  Fix Claim Race Condition
--   021  Role System
--   022  Admin RLS Policies
--   025  Market Approval Workflow
--   026  Market Review Columns
--   027  fn_approve_market
--   028  fn_deny_market
--   029  Market Type
--   030  Market Options
--   031  Multichoice Bets
--   032  fn_place_multichoice_bet
--   033  fn_resolve_multichoice
--   034  Resolution Window
--   035  fn_cast_community_vote
--   036  Voter Reward Type
--   037  fn_auto_resolution_window
--   038  fn_claim_daily_capped (replaces 018)
--   039  fn_check_claim_eligibility
--   041  Notifications Table
--   042  fn_unread_count
--   044  Badge Definitions
--   045  User Badges
--   046  fn_check_badges
--   047  Harden place_bet (replaces 002)
--   048  Restrict Market Updates
--   049  fn_admin_backroll
--
-- Safe to run in one go in the Supabase SQL Editor.
-- Each section is idempotent where possible (IF NOT EXISTS, CREATE OR REPLACE,
-- DROP … IF EXISTS).
-- ============================================================================

BEGIN;


-- ============================================================================
-- === Migration 001: Initial Schema ===
-- ============================================================================

CREATE TABLE profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    andrew_id   TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    banana_balance NUMERIC NOT NULL DEFAULT 1000,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_andrew_id ON profiles (andrew_id);

CREATE TABLE markets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title               TEXT NOT NULL,
    description         TEXT NOT NULL,
    creator_id          UUID NOT NULL REFERENCES profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    close_at            TIMESTAMPTZ NOT NULL,
    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'closed', 'resolved', 'disputed')),
    resolution_criteria TEXT NOT NULL,
    category            TEXT NOT NULL DEFAULT 'General',
    yes_pool_total      NUMERIC NOT NULL DEFAULT 0,
    no_pool_total       NUMERIC NOT NULL DEFAULT 0,
    resolved_outcome    TEXT CHECK (resolved_outcome IN ('YES', 'NO')),
    resolved_at         TIMESTAMPTZ
);

CREATE INDEX idx_markets_status ON markets (status);
CREATE INDEX idx_markets_creator_id ON markets (creator_id);
CREATE INDEX idx_markets_close_at ON markets (close_at);

CREATE TABLE bets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES profiles(id),
    market_id   UUID NOT NULL REFERENCES markets(id),
    side        TEXT NOT NULL CHECK (side IN ('YES', 'NO')),
    amount      NUMERIC NOT NULL CHECK (amount > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bets_user_id ON bets (user_id);
CREATE INDEX idx_bets_market_id ON bets (market_id);

CREATE TABLE resolution_votes (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id         UUID NOT NULL REFERENCES markets(id),
    voter_id          UUID NOT NULL REFERENCES profiles(id),
    selected_outcome  TEXT NOT NULL CHECK (selected_outcome IN ('YES', 'NO')),
    staked_amount     NUMERIC NOT NULL CHECK (staked_amount > 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (market_id, voter_id)
);

CREATE INDEX idx_resolution_votes_market_id ON resolution_votes (market_id);

CREATE TABLE transactions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES profiles(id),
    market_id         UUID REFERENCES markets(id),
    transaction_type  TEXT NOT NULL
                      CHECK (transaction_type IN (
                          'initial_grant', 'bet_placement', 'payout',
                          'voter_stake', 'voter_reward'
                      )),
    amount            NUMERIC NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_user_id ON transactions (user_id);
CREATE INDEX idx_transactions_market_id ON transactions (market_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, andrew_id, display_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'andrew_id', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
    );
    INSERT INTO public.transactions (user_id, transaction_type, amount)
    VALUES (NEW.id, 'initial_grant', 1000);
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolution_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by everyone"
    ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Markets are viewable by everyone"
    ON markets FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create markets"
    ON markets FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Creators can update own markets"
    ON markets FOR UPDATE USING (auth.uid() = creator_id);

CREATE POLICY "Bets are viewable by everyone"
    ON bets FOR SELECT USING (true);
CREATE POLICY "Authenticated users can place bets"
    ON bets FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Resolution votes are viewable by everyone"
    ON resolution_votes FOR SELECT USING (true);
CREATE POLICY "Authenticated users can vote"
    ON resolution_votes FOR INSERT WITH CHECK (auth.uid() = voter_id);

CREATE POLICY "Users can view own transactions"
    ON transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can insert transactions"
    ON transactions FOR INSERT WITH CHECK (true);


-- ============================================================================
-- === Migration 002: place_bet function ===
-- ============================================================================

CREATE OR REPLACE FUNCTION place_bet(
    p_user_id   UUID,
    p_market_id UUID,
    p_side      TEXT,
    p_amount    NUMERIC
) RETURNS JSONB AS $$
DECLARE
    v_balance       NUMERIC;
    v_market_status TEXT;
    v_bet_id        UUID;
BEGIN
    IF p_side NOT IN ('YES', 'NO') THEN
        RAISE EXCEPTION 'Invalid side: must be YES or NO';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Bet amount must be positive';
    END IF;

    SELECT banana_balance INTO v_balance
    FROM profiles WHERE id = p_user_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
    IF v_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

    SELECT status INTO v_market_status
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;
    IF v_market_status != 'open' THEN RAISE EXCEPTION 'Market is not open for betting'; END IF;

    UPDATE profiles SET banana_balance = banana_balance - p_amount WHERE id = p_user_id;

    IF p_side = 'YES' THEN
        UPDATE markets SET yes_pool_total = yes_pool_total + p_amount WHERE id = p_market_id;
    ELSE
        UPDATE markets SET no_pool_total = no_pool_total + p_amount WHERE id = p_market_id;
    END IF;

    INSERT INTO bets (user_id, market_id, side, amount)
    VALUES (p_user_id, p_market_id, p_side, p_amount)
    RETURNING id INTO v_bet_id;

    INSERT INTO transactions (user_id, market_id, transaction_type, amount)
    VALUES (p_user_id, p_market_id, 'bet_placement', -p_amount);

    RETURN jsonb_build_object(
        'bet_id', v_bet_id,
        'new_balance', v_balance - p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 003: Auto Close Markets ===
-- ============================================================================

CREATE OR REPLACE FUNCTION close_expired_markets()
RETURNS void AS $$
BEGIN
    UPDATE markets
    SET    status = 'closed'
    WHERE  status = 'open'
      AND  close_at <= now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) THEN
        PERFORM cron.schedule(
            'close-expired-markets',
            '* * * * *',
            'SELECT close_expired_markets()'
        );
    END IF;
END $$;


-- ============================================================================
-- === Migration 004: resolve_market function ===
-- ============================================================================

CREATE OR REPLACE FUNCTION resolve_market(
    p_market_id UUID,
    p_outcome   TEXT,
    p_resolver_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_market_status TEXT;
    v_yes_pool NUMERIC;
    v_no_pool NUMERIC;
    v_creator_id UUID;
    v_total_pool NUMERIC;
    v_winning_pool NUMERIC;
    v_bet RECORD;
    v_payout NUMERIC;
BEGIN
    IF p_outcome NOT IN ('YES', 'NO') THEN
        RAISE EXCEPTION 'Invalid outcome: must be YES or NO';
    END IF;

    SELECT status, yes_pool_total, no_pool_total, creator_id
    INTO v_market_status, v_yes_pool, v_no_pool, v_creator_id
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

    IF v_market_status IN ('resolved', 'disputed') THEN
        RAISE EXCEPTION 'Market is already resolved or disputed';
    END IF;

    IF p_resolver_id != v_creator_id THEN
        RAISE EXCEPTION 'Only the market creator can resolve this market';
    END IF;

    v_total_pool := v_yes_pool + v_no_pool;

    IF p_outcome = 'YES' THEN
        v_winning_pool := v_yes_pool;
    ELSE
        v_winning_pool := v_no_pool;
    END IF;

    UPDATE markets SET
        status = 'resolved',
        resolved_outcome = p_outcome,
        resolved_at = now()
    WHERE id = p_market_id;

    IF v_winning_pool = 0 THEN
        FOR v_bet IN
            SELECT user_id, amount, side FROM bets WHERE market_id = p_market_id
        LOOP
            UPDATE profiles SET banana_balance = banana_balance + v_bet.amount WHERE id = v_bet.user_id;
            INSERT INTO transactions (user_id, market_id, transaction_type, amount)
            VALUES (v_bet.user_id, p_market_id, 'payout', v_bet.amount);
        END LOOP;
    ELSE
        FOR v_bet IN
            SELECT user_id, SUM(amount) as user_total
            FROM bets WHERE market_id = p_market_id AND side = p_outcome
            GROUP BY user_id
        LOOP
            v_payout := TRUNC(v_bet.user_total * (v_total_pool / v_winning_pool), 2);
            UPDATE profiles SET banana_balance = banana_balance + v_payout WHERE id = v_bet.user_id;
            INSERT INTO transactions (user_id, market_id, transaction_type, amount)
            VALUES (v_bet.user_id, p_market_id, 'payout', v_payout);
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'market_id', p_market_id,
        'status', 'resolved',
        'outcome', p_outcome
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 006: Auth CMU Domain Trigger ===
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_cmu_email_domain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.email IS NULL OR lower(NEW.email) NOT LIKE '%@andrew.cmu.edu' THEN
        RAISE EXCEPTION 'Only @andrew.cmu.edu emails are allowed.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_cmu_email_domain ON auth.users;

CREATE TRIGGER enforce_cmu_email_domain
    BEFORE INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cmu_email_domain();


-- ============================================================================
-- === Migration 007: Expand Market Status ===
-- ============================================================================
-- (007_dispute_voting.sql is deprecated and intentionally omitted)

ALTER TABLE markets DROP CONSTRAINT IF EXISTS markets_status_check;
ALTER TABLE markets ADD CONSTRAINT markets_status_check
    CHECK (status IN ('open', 'closed', 'pending_resolution', 'disputed', 'admin_review', 'resolved'));


-- ============================================================================
-- === Migration 008: Market Governance Columns ===
-- ============================================================================

ALTER TABLE markets ADD COLUMN IF NOT EXISTS official_source TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS yes_criteria TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS no_criteria TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS ambiguity_criteria TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS proposed_outcome TEXT CHECK (proposed_outcome IN ('YES', 'NO'));
ALTER TABLE markets ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS dispute_deadline TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_markets_dispute_deadline ON markets (dispute_deadline);


-- ============================================================================
-- === Migration 009: Admin Flag ===
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;


-- ============================================================================
-- === Migration 010: Disputes Table ===
-- ============================================================================

CREATE TABLE IF NOT EXISTS disputes (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id        UUID NOT NULL REFERENCES markets(id) UNIQUE,
    disputer_id      UUID NOT NULL REFERENCES profiles(id),
    explanation      TEXT NOT NULL,
    voting_deadline  TIMESTAMPTZ NOT NULL,
    resolved_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disputes_market_id ON disputes (market_id);

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Disputes are viewable by everyone"
    ON disputes FOR SELECT USING (true);
CREATE POLICY "Authenticated users can file disputes"
    ON disputes FOR INSERT WITH CHECK (auth.uid() = disputer_id);


-- ============================================================================
-- === Migration 011: Update Resolution Votes ===
-- ============================================================================

ALTER TABLE resolution_votes DROP COLUMN IF EXISTS staked_amount;
ALTER TABLE resolution_votes ADD COLUMN IF NOT EXISTS dispute_id UUID REFERENCES disputes(id);

ALTER TABLE resolution_votes DROP CONSTRAINT IF EXISTS resolution_votes_market_id_voter_id_key;
ALTER TABLE resolution_votes ADD CONSTRAINT resolution_votes_dispute_id_voter_id_key UNIQUE (dispute_id, voter_id);

CREATE INDEX IF NOT EXISTS idx_resolution_votes_dispute_id ON resolution_votes (dispute_id);


-- ============================================================================
-- === Migration 012: Add daily_claim Transaction Type ===
-- ============================================================================

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transaction_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_transaction_type_check
    CHECK (transaction_type IN (
        'initial_grant', 'bet_placement', 'payout',
        'voter_stake', 'voter_reward', 'daily_claim'
    ));


-- ============================================================================
-- === Migration 013: fn_propose_resolution ===
-- ============================================================================

CREATE OR REPLACE FUNCTION propose_resolution(
    p_market_id   UUID,
    p_outcome     TEXT,
    p_proposer_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_status     TEXT;
    v_creator_id UUID;
BEGIN
    IF p_outcome NOT IN ('YES', 'NO') THEN
        RAISE EXCEPTION 'Invalid outcome: must be YES or NO';
    END IF;

    SELECT status, creator_id INTO v_status, v_creator_id
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

    IF v_status != 'closed' THEN
        RAISE EXCEPTION 'Market must be closed before proposing resolution';
    END IF;

    IF p_proposer_id != v_creator_id THEN
        RAISE EXCEPTION 'Only the market creator can propose a resolution';
    END IF;

    UPDATE markets SET
        status            = 'pending_resolution',
        proposed_outcome  = p_outcome,
        proposed_at       = now(),
        dispute_deadline  = now() + interval '24 hours'
    WHERE id = p_market_id;

    RETURN jsonb_build_object(
        'market_id', p_market_id,
        'status', 'pending_resolution',
        'proposed_outcome', p_outcome,
        'dispute_deadline', now() + interval '24 hours'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 014: fn_finalize_resolution ===
-- ============================================================================

CREATE OR REPLACE FUNCTION finalize_resolution(
    p_market_id UUID,
    p_outcome   TEXT
) RETURNS JSONB AS $$
DECLARE
    v_status       TEXT;
    v_yes_pool     NUMERIC;
    v_no_pool      NUMERIC;
    v_total_pool   NUMERIC;
    v_winning_pool NUMERIC;
    v_bet          RECORD;
    v_payout       NUMERIC;
BEGIN
    IF p_outcome NOT IN ('YES', 'NO') THEN
        RAISE EXCEPTION 'Invalid outcome: must be YES or NO';
    END IF;

    SELECT status, yes_pool_total, no_pool_total
    INTO v_status, v_yes_pool, v_no_pool
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

    IF v_status NOT IN ('pending_resolution', 'disputed', 'admin_review') THEN
        RAISE EXCEPTION 'Market cannot be finalized from status: %', v_status;
    END IF;

    UPDATE markets SET
        status           = 'resolved',
        resolved_outcome = p_outcome,
        resolved_at      = now()
    WHERE id = p_market_id;

    v_total_pool := v_yes_pool + v_no_pool;

    IF p_outcome = 'YES' THEN
        v_winning_pool := v_yes_pool;
    ELSE
        v_winning_pool := v_no_pool;
    END IF;

    IF v_winning_pool = 0 THEN
        FOR v_bet IN
            SELECT user_id, amount FROM bets WHERE market_id = p_market_id
        LOOP
            UPDATE profiles SET banana_balance = banana_balance + v_bet.amount
            WHERE id = v_bet.user_id;
            INSERT INTO transactions (user_id, market_id, transaction_type, amount)
            VALUES (v_bet.user_id, p_market_id, 'payout', v_bet.amount);
        END LOOP;
    ELSE
        FOR v_bet IN
            SELECT user_id, SUM(amount) AS user_total
            FROM bets WHERE market_id = p_market_id AND side = p_outcome
            GROUP BY user_id
        LOOP
            v_payout := TRUNC(v_bet.user_total * (v_total_pool / v_winning_pool), 2);
            UPDATE profiles SET banana_balance = banana_balance + v_payout
            WHERE id = v_bet.user_id;
            INSERT INTO transactions (user_id, market_id, transaction_type, amount)
            VALUES (v_bet.user_id, p_market_id, 'payout', v_payout);
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'market_id', p_market_id,
        'status', 'resolved',
        'outcome', p_outcome
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 015: fn_file_dispute ===
-- ============================================================================

CREATE OR REPLACE FUNCTION file_dispute(
    p_market_id   UUID,
    p_disputer_id UUID,
    p_explanation TEXT
) RETURNS JSONB AS $$
DECLARE
    v_status           TEXT;
    v_dispute_deadline  TIMESTAMPTZ;
    v_dispute_id       UUID;
BEGIN
    SELECT status, dispute_deadline INTO v_status, v_dispute_deadline
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

    IF v_status != 'pending_resolution' THEN
        RAISE EXCEPTION 'Market is not in pending_resolution status';
    END IF;

    IF now() >= v_dispute_deadline THEN
        RAISE EXCEPTION 'Dispute window has expired';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_disputer_id) THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    INSERT INTO disputes (market_id, disputer_id, explanation, voting_deadline)
    VALUES (p_market_id, p_disputer_id, p_explanation, now() + interval '48 hours')
    RETURNING id INTO v_dispute_id;

    UPDATE markets SET status = 'disputed' WHERE id = p_market_id;

    RETURN jsonb_build_object(
        'id', v_dispute_id,
        'market_id', p_market_id,
        'disputer_id', p_disputer_id,
        'explanation', p_explanation,
        'voting_deadline', now() + interval '48 hours'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 016: fn_cast_dispute_vote ===
-- ============================================================================

CREATE OR REPLACE FUNCTION cast_dispute_vote(
    p_dispute_id UUID,
    p_voter_id   UUID,
    p_vote       TEXT
) RETURNS JSONB AS $$
DECLARE
    v_market_id       UUID;
    v_market_status   TEXT;
    v_creator_id      UUID;
    v_voting_deadline TIMESTAMPTZ;
    v_vote_id         UUID;
BEGIN
    IF p_vote NOT IN ('YES', 'NO') THEN
        RAISE EXCEPTION 'Invalid vote: must be YES or NO';
    END IF;

    SELECT market_id, voting_deadline INTO v_market_id, v_voting_deadline
    FROM disputes WHERE id = p_dispute_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Dispute not found'; END IF;

    IF now() >= v_voting_deadline THEN
        RAISE EXCEPTION 'Voting window has expired';
    END IF;

    SELECT status, creator_id INTO v_market_status, v_creator_id
    FROM markets WHERE id = v_market_id;

    IF v_market_status != 'disputed' THEN
        RAISE EXCEPTION 'Market is not in disputed status';
    END IF;

    IF p_voter_id = v_creator_id THEN
        RAISE EXCEPTION 'Market creator cannot vote on disputes';
    END IF;

    IF EXISTS (SELECT 1 FROM bets WHERE market_id = v_market_id AND user_id = p_voter_id) THEN
        RAISE EXCEPTION 'Users who placed bets cannot vote on disputes';
    END IF;

    INSERT INTO resolution_votes (dispute_id, market_id, voter_id, selected_outcome)
    VALUES (p_dispute_id, v_market_id, p_voter_id, p_vote)
    RETURNING id INTO v_vote_id;

    RETURN jsonb_build_object(
        'id', v_vote_id,
        'dispute_id', p_dispute_id,
        'market_id', v_market_id,
        'voter_id', p_voter_id,
        'selected_outcome', p_vote
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 017: fn_admin_resolve ===
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_resolve_market(
    p_market_id UUID,
    p_outcome   TEXT,
    p_admin_id  UUID
) RETURNS JSONB AS $$
DECLARE
    v_status   TEXT;
    v_is_admin BOOLEAN;
BEGIN
    IF p_outcome NOT IN ('YES', 'NO') THEN
        RAISE EXCEPTION 'Invalid outcome: must be YES or NO';
    END IF;

    SELECT status INTO v_status FROM markets WHERE id = p_market_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

    IF v_status != 'admin_review' THEN
        RAISE EXCEPTION 'Market is not in admin_review status';
    END IF;

    SELECT is_admin INTO v_is_admin FROM profiles WHERE id = p_admin_id;

    IF v_is_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'Only admins can resolve markets in admin review';
    END IF;

    UPDATE disputes SET resolved_by_admin = TRUE WHERE market_id = p_market_id;

    RETURN finalize_resolution(p_market_id, p_outcome);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 018: fn_claim_daily_bananas ===
-- ============================================================================

CREATE OR REPLACE FUNCTION claim_daily_bananas(
    p_user_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_today   DATE;
    v_balance NUMERIC;
BEGIN
    v_today := (now() AT TIME ZONE 'America/New_York')::date;

    SELECT banana_balance INTO v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

    IF EXISTS (
        SELECT 1 FROM transactions
        WHERE user_id = p_user_id
          AND transaction_type = 'daily_claim'
          AND (created_at AT TIME ZONE 'America/New_York')::date = v_today
    ) THEN
        RAISE EXCEPTION 'Already claimed today';
    END IF;

    UPDATE profiles SET banana_balance = banana_balance + 1000 WHERE id = p_user_id;

    INSERT INTO transactions (user_id, transaction_type, amount)
    VALUES (p_user_id, 'daily_claim', 1000);

    RETURN jsonb_build_object(
        'new_balance', v_balance + 1000,
        'claimed_at', now()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 019: fn_check_claimed_today ===
-- ============================================================================

CREATE OR REPLACE FUNCTION check_claimed_today(
    p_user_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM transactions
        WHERE user_id = p_user_id
          AND transaction_type = 'daily_claim'
          AND (created_at AT TIME ZONE 'America/New_York')::date = (now() AT TIME ZONE 'America/New_York')::date
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 020: Fix Claim Race Condition ===
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_daily_claim
    ON transactions (user_id, CAST((created_at AT TIME ZONE 'America/New_York') AS date))
    WHERE transaction_type = 'daily_claim';


-- ============================================================================
-- === Migration 021: Role System ===
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin', 'super_admin'));

UPDATE profiles SET role = 'admin' WHERE is_admin = TRUE;

UPDATE profiles SET role = 'super_admin' WHERE andrew_id = 'tgershon';

CREATE OR REPLACE FUNCTION profiles_is_admin_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.is_admin := NEW.role IN ('admin', 'super_admin');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_is_admin ON profiles;
CREATE TRIGGER sync_is_admin
    BEFORE INSERT OR UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION profiles_is_admin_sync();


-- ============================================================================
-- === Migration 022: Admin RLS Policies ===
-- ============================================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'markets' AND policyname = 'Admins can update any market') THEN
        CREATE POLICY "Admins can update any market"
            ON markets FOR UPDATE
            USING (
                EXISTS (
                    SELECT 1 FROM profiles
                    WHERE profiles.id = auth.uid()
                    AND profiles.role IN ('admin', 'super_admin')
                )
            );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Admins can view all transactions') THEN
        CREATE POLICY "Admins can view all transactions"
            ON transactions FOR SELECT
            USING (
                auth.uid() = user_id
                OR EXISTS (
                    SELECT 1 FROM profiles
                    WHERE profiles.id = auth.uid()
                    AND profiles.role IN ('admin', 'super_admin')
                )
            );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Super admin can update any profile') THEN
        CREATE POLICY "Super admin can update any profile"
            ON profiles FOR UPDATE
            USING (
                auth.uid() = id
                OR EXISTS (
                    SELECT 1 FROM profiles
                    WHERE profiles.id = auth.uid()
                    AND profiles.role = 'super_admin'
                )
            );
    END IF;
END $$;


-- ============================================================================
-- === Migration 025: Market Approval Workflow ===
-- ============================================================================

ALTER TABLE markets DROP CONSTRAINT IF EXISTS markets_status_check;
ALTER TABLE markets ADD CONSTRAINT markets_status_check
    CHECK (status IN (
        'pending_review', 'open', 'closed',
        'pending_resolution', 'disputed', 'admin_review', 'resolved',
        'denied'
    ));

ALTER TABLE markets ALTER COLUMN status SET DEFAULT 'pending_review';


-- ============================================================================
-- === Migration 026: Market Review Columns ===
-- ============================================================================

ALTER TABLE markets ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles(id);
ALTER TABLE markets ADD COLUMN IF NOT EXISTS review_date TIMESTAMPTZ;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS review_notes TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS link TEXT;

CREATE INDEX IF NOT EXISTS idx_markets_review_status ON markets (status)
    WHERE status IN ('pending_review', 'denied');


-- ============================================================================
-- === Migration 027: fn_approve_market ===
-- ============================================================================

CREATE OR REPLACE FUNCTION approve_market(
    p_market_id UUID,
    p_admin_id UUID,
    p_notes TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

    IF v_status != 'pending_review' THEN
        RAISE EXCEPTION 'Market is not pending review (current status: %)', v_status;
    END IF;

    UPDATE markets SET
        status = 'open',
        reviewed_by = p_admin_id,
        review_date = now(),
        review_notes = p_notes
    WHERE id = p_market_id;

    RETURN jsonb_build_object(
        'market_id', p_market_id,
        'status', 'open',
        'reviewed_by', p_admin_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 028: fn_deny_market ===
-- ============================================================================

CREATE OR REPLACE FUNCTION deny_market(
    p_market_id UUID,
    p_admin_id UUID,
    p_notes TEXT
) RETURNS JSONB AS $$
DECLARE
    v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

    IF v_status != 'pending_review' THEN
        RAISE EXCEPTION 'Market is not pending review (current status: %)', v_status;
    END IF;

    IF p_notes IS NULL OR trim(p_notes) = '' THEN
        RAISE EXCEPTION 'Notes are required when denying a market';
    END IF;

    UPDATE markets SET
        status = 'denied',
        reviewed_by = p_admin_id,
        review_date = now(),
        review_notes = p_notes
    WHERE id = p_market_id;

    RETURN jsonb_build_object(
        'market_id', p_market_id,
        'status', 'denied',
        'reviewed_by', p_admin_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 029: Market Type ===
-- ============================================================================

ALTER TABLE markets ADD COLUMN IF NOT EXISTS market_type TEXT NOT NULL DEFAULT 'binary'
    CHECK (market_type IN ('binary', 'multichoice'));

ALTER TABLE markets ADD COLUMN IF NOT EXISTS multichoice_type TEXT
    CHECK (multichoice_type IN ('exclusive', 'non_exclusive'));


-- ============================================================================
-- === Migration 030: Market Options ===
-- ============================================================================

CREATE TABLE IF NOT EXISTS market_options (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id   UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    pool_total  NUMERIC NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_winner   BOOLEAN,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_options_market_id ON market_options (market_id);

ALTER TABLE market_options ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'market_options' AND policyname = 'Market options are viewable by everyone') THEN
        CREATE POLICY "Market options are viewable by everyone"
            ON market_options FOR SELECT USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'market_options' AND policyname = 'Authenticated users can create options with markets') THEN
        CREATE POLICY "Authenticated users can create options with markets"
            ON market_options FOR INSERT WITH CHECK (
                EXISTS (
                    SELECT 1 FROM markets WHERE markets.id = market_id AND markets.creator_id = auth.uid()
                )
            );
    END IF;
END $$;


-- ============================================================================
-- === Migration 031: Multichoice Bets ===
-- ============================================================================

ALTER TABLE bets ADD COLUMN IF NOT EXISTS option_id UUID REFERENCES market_options(id);

ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_side_check;
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_side_or_option_check;
ALTER TABLE bets ADD CONSTRAINT bets_side_or_option_check
    CHECK (
        (side IS NOT NULL AND option_id IS NULL)
        OR (side IS NULL AND option_id IS NOT NULL)
    );


-- ============================================================================
-- === Migration 032: fn_place_multichoice_bet ===
-- ============================================================================

CREATE OR REPLACE FUNCTION place_multichoice_bet(
    p_user_id   UUID,
    p_market_id UUID,
    p_option_id UUID,
    p_amount    NUMERIC
) RETURNS JSONB AS $$
DECLARE
    v_balance       NUMERIC;
    v_market_status TEXT;
    v_market_type   TEXT;
    v_option_market UUID;
    v_bet_id        UUID;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Bet amount must be positive';
    END IF;

    SELECT market_id INTO v_option_market
    FROM market_options WHERE id = p_option_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Option not found'; END IF;

    IF v_option_market != p_market_id THEN
        RAISE EXCEPTION 'Option does not belong to this market';
    END IF;

    SELECT banana_balance INTO v_balance
    FROM profiles WHERE id = p_user_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
    IF v_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

    SELECT status, market_type INTO v_market_status, v_market_type
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;
    IF v_market_status != 'open' THEN RAISE EXCEPTION 'Market is not open for betting'; END IF;
    IF v_market_type != 'multichoice' THEN RAISE EXCEPTION 'Market is not multichoice'; END IF;

    UPDATE profiles SET banana_balance = banana_balance - p_amount WHERE id = p_user_id;

    UPDATE market_options SET pool_total = pool_total + p_amount WHERE id = p_option_id;

    INSERT INTO bets (user_id, market_id, option_id, amount)
    VALUES (p_user_id, p_market_id, p_option_id, p_amount)
    RETURNING id INTO v_bet_id;

    INSERT INTO transactions (user_id, market_id, transaction_type, amount)
    VALUES (p_user_id, p_market_id, 'bet_placement', -p_amount);

    RETURN jsonb_build_object(
        'bet_id', v_bet_id,
        'new_balance', v_balance - p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 033: fn_resolve_multichoice ===
-- ============================================================================

CREATE OR REPLACE FUNCTION resolve_multichoice_market(
    p_market_id UUID,
    p_winning_option_ids UUID[]
) RETURNS JSONB AS $$
DECLARE
    v_market_type TEXT;
    v_multichoice_type TEXT;
    v_status TEXT;
    v_total_pool NUMERIC := 0;
    v_winning_pool NUMERIC := 0;
    v_opt RECORD;
    v_bet RECORD;
    v_payout NUMERIC;
BEGIN
    SELECT market_type, multichoice_type, status
    INTO v_market_type, v_multichoice_type, v_status
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;
    IF v_market_type != 'multichoice' THEN RAISE EXCEPTION 'Not a multichoice market'; END IF;
    IF v_status NOT IN ('pending_resolution', 'disputed', 'admin_review', 'closed') THEN
        RAISE EXCEPTION 'Market cannot be resolved from status: %', v_status;
    END IF;

    IF v_multichoice_type = 'exclusive' AND array_length(p_winning_option_ids, 1) != 1 THEN
        RAISE EXCEPTION 'Exclusive markets must have exactly one winner';
    END IF;

    UPDATE market_options SET is_winner = FALSE WHERE market_id = p_market_id;
    UPDATE market_options SET is_winner = TRUE WHERE id = ANY(p_winning_option_ids);

    SELECT COALESCE(SUM(pool_total), 0) INTO v_total_pool
    FROM market_options WHERE market_id = p_market_id;

    SELECT COALESCE(SUM(pool_total), 0) INTO v_winning_pool
    FROM market_options WHERE id = ANY(p_winning_option_ids);

    UPDATE markets SET
        status = 'resolved',
        resolved_at = now()
    WHERE id = p_market_id;

    IF v_winning_pool = 0 THEN
        FOR v_bet IN
            SELECT user_id, amount FROM bets WHERE market_id = p_market_id
        LOOP
            UPDATE profiles SET banana_balance = banana_balance + v_bet.amount WHERE id = v_bet.user_id;
            INSERT INTO transactions (user_id, market_id, transaction_type, amount)
            VALUES (v_bet.user_id, p_market_id, 'payout', v_bet.amount);
        END LOOP;
    ELSE
        FOR v_bet IN
            SELECT user_id, SUM(amount) AS user_total
            FROM bets
            WHERE market_id = p_market_id AND option_id = ANY(p_winning_option_ids)
            GROUP BY user_id
        LOOP
            v_payout := TRUNC(v_bet.user_total * (v_total_pool / v_winning_pool), 2);
            UPDATE profiles SET banana_balance = banana_balance + v_payout WHERE id = v_bet.user_id;
            INSERT INTO transactions (user_id, market_id, transaction_type, amount)
            VALUES (v_bet.user_id, p_market_id, 'payout', v_payout);
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'market_id', p_market_id,
        'status', 'resolved',
        'winning_options', p_winning_option_ids
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 034: Resolution Window ===
-- ============================================================================

ALTER TABLE markets ADD COLUMN IF NOT EXISTS resolution_window_end TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS community_votes (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id         UUID NOT NULL REFERENCES markets(id),
    voter_id          UUID NOT NULL REFERENCES profiles(id),
    selected_outcome  TEXT NOT NULL CHECK (selected_outcome IN ('YES', 'NO')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (market_id, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_community_votes_market_id ON community_votes (market_id);

ALTER TABLE community_votes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'community_votes' AND policyname = 'Community votes are viewable by everyone') THEN
        CREATE POLICY "Community votes are viewable by everyone"
            ON community_votes FOR SELECT USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'community_votes' AND policyname = 'Authenticated users can cast community votes') THEN
        CREATE POLICY "Authenticated users can cast community votes"
            ON community_votes FOR INSERT WITH CHECK (auth.uid() = voter_id);
    END IF;
END $$;


-- ============================================================================
-- === Migration 035: fn_cast_community_vote ===
-- ============================================================================

CREATE OR REPLACE FUNCTION cast_community_vote(
    p_market_id UUID,
    p_voter_id  UUID,
    p_vote      TEXT
) RETURNS JSONB AS $$
DECLARE
    v_status TEXT;
    v_resolution_end TIMESTAMPTZ;
    v_creator_id UUID;
    v_vote_id UUID;
BEGIN
    IF p_vote NOT IN ('YES', 'NO') THEN
        RAISE EXCEPTION 'Invalid vote: must be YES or NO';
    END IF;

    SELECT status, resolution_window_end, creator_id
    INTO v_status, v_resolution_end, v_creator_id
    FROM markets WHERE id = p_market_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

    IF v_status NOT IN ('closed', 'pending_resolution') THEN
        RAISE EXCEPTION 'Market is not in the resolution period';
    END IF;

    IF v_resolution_end IS NULL THEN
        RAISE EXCEPTION 'Resolution window has not been set for this market';
    END IF;

    IF now() >= v_resolution_end THEN
        RAISE EXCEPTION 'Resolution voting window has expired';
    END IF;

    IF p_voter_id = v_creator_id THEN
        RAISE EXCEPTION 'Market creators cannot cast community votes on their own market';
    END IF;

    INSERT INTO community_votes (market_id, voter_id, selected_outcome)
    VALUES (p_market_id, p_voter_id, p_vote)
    RETURNING id INTO v_vote_id;

    RETURN jsonb_build_object(
        'id', v_vote_id,
        'market_id', p_market_id,
        'voter_id', p_voter_id,
        'selected_outcome', p_vote
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 036: Voter Reward Type ===
-- ============================================================================

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transaction_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_transaction_type_check
    CHECK (transaction_type IN (
        'initial_grant', 'bet_placement', 'payout',
        'voter_stake', 'voter_reward', 'daily_claim',
        'resolution_vote_reward'
    ));

CREATE OR REPLACE FUNCTION distribute_voter_rewards(
    p_market_id       UUID,
    p_winning_outcome TEXT,
    p_reward_pct      NUMERIC DEFAULT 0.04
) RETURNS void AS $$
DECLARE
    v_total_pool   NUMERIC;
    v_reward_pool  NUMERIC;
    v_winner_count INTEGER;
    v_reward_each  NUMERIC;
    v_voter        RECORD;
BEGIN
    SELECT yes_pool_total + no_pool_total INTO v_total_pool
    FROM markets WHERE id = p_market_id;

    IF v_total_pool IS NULL OR v_total_pool <= 0 THEN RETURN; END IF;

    v_reward_pool := v_total_pool * p_reward_pct;

    SELECT count(*) INTO v_winner_count
    FROM community_votes
    WHERE market_id = p_market_id AND selected_outcome = p_winning_outcome;

    IF v_winner_count = 0 THEN RETURN; END IF;

    v_reward_each := round(v_reward_pool / v_winner_count, 2);

    IF v_reward_each <= 0 THEN RETURN; END IF;

    FOR v_voter IN
        SELECT voter_id FROM community_votes
        WHERE market_id = p_market_id AND selected_outcome = p_winning_outcome
    LOOP
        UPDATE profiles
        SET banana_balance = banana_balance + v_reward_each
        WHERE id = v_voter.voter_id;

        INSERT INTO transactions (user_id, market_id, transaction_type, amount)
        VALUES (v_voter.voter_id, p_market_id, 'resolution_vote_reward', v_reward_each);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 037: fn_auto_resolution_window ===
-- ============================================================================

CREATE OR REPLACE FUNCTION set_resolution_window()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'closed' AND OLD.status = 'open' AND NEW.resolution_window_end IS NULL THEN
        NEW.resolution_window_end := now() + interval '24 hours';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_set_resolution_window ON markets;
CREATE TRIGGER auto_set_resolution_window
    BEFORE UPDATE ON markets
    FOR EACH ROW EXECUTE FUNCTION set_resolution_window();

CREATE OR REPLACE FUNCTION close_expired_markets()
RETURNS void AS $$
BEGIN
    UPDATE markets
    SET status = 'closed',
        resolution_window_end = now() + interval '24 hours'
    WHERE status = 'open'
      AND close_at <= now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 038: fn_claim_daily_capped (replaces 018) ===
-- ============================================================================

CREATE OR REPLACE FUNCTION claim_daily_bananas(
    p_user_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_today   DATE;
    v_balance NUMERIC;
    v_claim_amount NUMERIC;
    v_cap NUMERIC := 5000;
BEGIN
    v_today := (now() AT TIME ZONE 'America/New_York')::date;

    SELECT banana_balance INTO v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

    IF EXISTS (
        SELECT 1 FROM transactions
        WHERE user_id = p_user_id
          AND transaction_type = 'daily_claim'
          AND (created_at AT TIME ZONE 'America/New_York')::date = v_today
    ) THEN
        RAISE EXCEPTION 'Already claimed today';
    END IF;

    IF v_balance >= v_cap THEN
        RAISE EXCEPTION 'Balance is at or above the daily claim cap of 5000';
    END IF;

    v_claim_amount := LEAST(1000, v_cap - v_balance);

    IF v_claim_amount <= 0 THEN
        RAISE EXCEPTION 'Balance is at or above the daily claim cap of 5000';
    END IF;

    UPDATE profiles SET banana_balance = banana_balance + v_claim_amount WHERE id = p_user_id;

    INSERT INTO transactions (user_id, transaction_type, amount)
    VALUES (p_user_id, 'daily_claim', v_claim_amount);

    RETURN jsonb_build_object(
        'new_balance', v_balance + v_claim_amount,
        'claimed_amount', v_claim_amount,
        'claimed_at', now()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 039: fn_check_claim_eligibility ===
-- ============================================================================

CREATE OR REPLACE FUNCTION check_claim_eligibility(
    p_user_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_today DATE;
    v_balance NUMERIC;
    v_claimed_today BOOLEAN;
    v_eligible BOOLEAN;
    v_claim_amount NUMERIC;
    v_cap NUMERIC := 5000;
BEGIN
    v_today := (now() AT TIME ZONE 'America/New_York')::date;

    SELECT banana_balance INTO v_balance FROM profiles WHERE id = p_user_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

    v_claimed_today := EXISTS (
        SELECT 1 FROM transactions
        WHERE user_id = p_user_id
          AND transaction_type = 'daily_claim'
          AND (created_at AT TIME ZONE 'America/New_York')::date = v_today
    );

    v_eligible := NOT v_claimed_today AND v_balance < v_cap;
    v_claim_amount := CASE
        WHEN NOT v_eligible THEN 0
        ELSE LEAST(1000, v_cap - v_balance)
    END;

    RETURN jsonb_build_object(
        'eligible', v_eligible,
        'claimed_today', v_claimed_today,
        'balance', v_balance,
        'claim_amount', v_claim_amount,
        'cap', v_cap,
        'above_cap', v_balance >= v_cap
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 041: Notifications Table ===
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN (
        'market_approved', 'market_denied', 'market_closed',
        'market_resolved', 'payout_received',
        'badge_earned', 'system',
        'market_submitted',
        'resolution_reminder'
    )),
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    metadata    JSONB DEFAULT '{}',
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, is_read)
    WHERE is_read = FALSE;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

REVOKE UPDATE ON TABLE notifications FROM authenticated;
GRANT UPDATE (is_read) ON TABLE notifications TO authenticated;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can view own notifications') THEN
        CREATE POLICY "Users can view own notifications"
            ON notifications FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can mark own notifications read') THEN
        CREATE POLICY "Users can mark own notifications read"
            ON notifications FOR UPDATE
            TO authenticated
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id AND is_read = TRUE);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can delete own notifications') THEN
        CREATE POLICY "Users can delete own notifications"
            ON notifications FOR DELETE
            TO authenticated
            USING (auth.uid() = user_id);
    END IF;
END $$;


-- ============================================================================
-- === Migration 042: fn_unread_count ===
-- ============================================================================

CREATE OR REPLACE FUNCTION get_unread_notification_count(
    p_user_id UUID
) RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM notifications
        WHERE user_id = p_user_id AND is_read = FALSE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 044: Badge Definitions ===
-- ============================================================================

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

INSERT INTO badge_definitions (track, tier, name, description, threshold, color) VALUES
('banana_baron', 1, 'Banana Sprout',   'Reach 5,000 coin balance',      5000,  '#4ade80'),
('banana_baron', 2, 'Banana Tree',     'Reach 7,500 coin balance',      7500,  '#a3e635'),
('banana_baron', 3, 'Banana Grove',    'Reach 10,000 coin balance',     10000, '#eab308'),
('banana_baron', 4, 'Banana Mogul',    'Reach 20,000 coin balance',     20000, '#f59e0b'),
('banana_baron', 5, 'Banana Baron',    'Reach 50,000 coin balance',     50000, '#d97706'),
('oracle', 1, 'Lucky Guess',     'Win 3 correct predictions',     3,   '#93c5fd'),
('oracle', 2, 'Sharp Eye',       'Win 5 correct predictions',     5,   '#3b82f6'),
('oracle', 3, 'Fortune Teller',  'Win 10 correct predictions',    10,  '#a855f7'),
('oracle', 4, 'Clairvoyant',     'Win 20 correct predictions',    20,  '#7c3aed'),
('oracle', 5, 'Oracle',          'Win 50 correct predictions',    50,  '#4f46e5'),
('architect', 1, 'Market Maker',    'Create 1 approved market',      1,   '#5eead4'),
('architect', 2, 'Question Crafter','Create 2 approved markets',     2,   '#14b8a6'),
('architect', 3, 'Trend Setter',    'Create 5 approved markets',     5,   '#06b6d4'),
('architect', 4, 'Market Maven',    'Create 10 approved markets',    10,  '#0d9488'),
('architect', 5, 'Architect',       'Create 25 approved markets',    25,  '#0f766e'),
('degen', 1, 'Casual Better', 'Place 5 bets',               5,   '#fdba74'),
('degen', 2, 'Regular',       'Place 10 bets',              10,  '#fb923c'),
('degen', 3, 'Enthusiast',    'Place 20 bets',              20,  '#f97316'),
('degen', 4, 'Addicted',      'Place 50 bets',              50,  '#ea580c'),
('degen', 5, 'Degen',         'Place 100 bets',             100, '#dc2626'),
('whale', 1, 'Small Fish', 'Place a single bet of 1,000+',   1000,  '#f9a8d4'),
('whale', 2, 'Dolphin',    'Place a single bet of 2,000+',   2000,  '#f472b6'),
('whale', 3, 'Shark',      'Place a single bet of 5,000+',   5000,  '#ec4899'),
('whale', 4, 'Orca',       'Place a single bet of 10,000+',  10000, '#db2777'),
('whale', 5, 'Whale',      'Place a single bet of 25,000+',  25000, '#be185d')
ON CONFLICT (track, tier) DO NOTHING;


-- ============================================================================
-- === Migration 045: User Badges ===
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_badges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    badge_id        UUID NOT NULL REFERENCES badge_definitions(id),
    track           TEXT NOT NULL,
    tier            INTEGER NOT NULL,
    earned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, track)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges (user_id);

ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_badges' AND policyname = 'User badges are viewable by everyone') THEN
        CREATE POLICY "User badges are viewable by everyone"
            ON user_badges FOR SELECT USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_badges' AND policyname = 'System can manage user badges') THEN
        CREATE POLICY "System can manage user badges"
            ON user_badges FOR ALL WITH CHECK (true);
    END IF;
END $$;


-- ============================================================================
-- === Migration 046: fn_check_badges ===
-- ============================================================================

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
    SELECT banana_balance INTO v_balance FROM profiles WHERE id = p_user_id;

    SELECT COUNT(*) INTO v_correct_bets
    FROM bets b JOIN markets m ON b.market_id = m.id
    WHERE b.user_id = p_user_id
      AND m.status = 'resolved'
      AND b.side = m.resolved_outcome;

    SELECT COUNT(*) INTO v_markets_created
    FROM markets
    WHERE creator_id = p_user_id
      AND status NOT IN ('pending_review', 'denied');

    SELECT COUNT(*) INTO v_total_bets FROM bets WHERE user_id = p_user_id;

    SELECT COALESCE(MAX(amount), 0) INTO v_max_single_bet FROM bets WHERE user_id = p_user_id;

    FOR v_badge IN
        SELECT * FROM badge_definitions ORDER BY track, tier DESC
    LOOP
        DECLARE
            v_current_value NUMERIC;
            v_current_tier INTEGER;
        BEGIN
            v_current_value := CASE v_badge.track
                WHEN 'banana_baron' THEN v_balance
                WHEN 'oracle' THEN v_correct_bets
                WHEN 'architect' THEN v_markets_created
                WHEN 'degen' THEN v_total_bets
                WHEN 'whale' THEN v_max_single_bet
            END;

            IF v_current_value >= v_badge.threshold THEN
                SELECT tier INTO v_current_tier
                FROM user_badges WHERE user_id = p_user_id AND track = v_badge.track;

                IF NOT FOUND OR v_current_tier < v_badge.tier THEN
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

                CONTINUE;
            END IF;
        END;
    END LOOP;

    RETURN v_new_badges;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 047: Harden place_bet (replaces 002) ===
-- ============================================================================

CREATE OR REPLACE FUNCTION place_bet(
    p_user_id   UUID,
    p_market_id UUID,
    p_side      TEXT,
    p_amount    NUMERIC
) RETURNS JSONB AS $$
DECLARE
    v_balance       NUMERIC;
    v_market_status TEXT;
    v_close_at      TIMESTAMPTZ;
    v_creator_id    UUID;
    v_bet_id        UUID;
BEGIN
    IF p_side NOT IN ('YES', 'NO') THEN
        RAISE EXCEPTION 'Invalid side: must be YES or NO';
    END IF;
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Bet amount must be positive';
    END IF;

    SELECT banana_balance INTO v_balance
    FROM profiles WHERE id = p_user_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
    IF v_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

    SELECT status, close_at, creator_id INTO v_market_status, v_close_at, v_creator_id
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

    IF p_user_id = v_creator_id THEN
        RAISE EXCEPTION 'Market creators cannot place bets on their own markets';
    END IF;

    IF v_market_status != 'open' THEN
        RAISE EXCEPTION 'Market is not open for betting';
    END IF;

    IF v_close_at <= now() THEN
        UPDATE markets SET status = 'closed' WHERE id = p_market_id;
        RAISE EXCEPTION 'Market has closed';
    END IF;

    UPDATE profiles SET banana_balance = banana_balance - p_amount WHERE id = p_user_id;

    IF p_side = 'YES' THEN
        UPDATE markets SET yes_pool_total = yes_pool_total + p_amount WHERE id = p_market_id;
    ELSE
        UPDATE markets SET no_pool_total = no_pool_total + p_amount WHERE id = p_market_id;
    END IF;

    INSERT INTO bets (user_id, market_id, side, amount)
    VALUES (p_user_id, p_market_id, p_side, p_amount)
    RETURNING id INTO v_bet_id;

    INSERT INTO transactions (user_id, market_id, transaction_type, amount)
    VALUES (p_user_id, p_market_id, 'bet_placement', -p_amount);

    RETURN jsonb_build_object(
        'bet_id', v_bet_id,
        'new_balance', v_balance - p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- === Migration 048: Restrict Market Updates ===
-- ============================================================================

DROP POLICY IF EXISTS "Creators can update own markets" ON markets;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'markets'
        AND policyname = 'Admins can update any market'
    ) THEN
        CREATE POLICY "Admins can update any market"
            ON markets FOR UPDATE
            USING (
                EXISTS (
                    SELECT 1 FROM profiles
                    WHERE profiles.id = auth.uid()
                    AND profiles.role IN ('admin', 'super_admin')
                )
            );
    END IF;
END $$;

CREATE OR REPLACE FUNCTION prevent_resolved_market_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'resolved' AND NEW.status = 'resolved' THEN
        IF NEW.title != OLD.title OR NEW.description != OLD.description
           OR NEW.resolution_criteria != OLD.resolution_criteria THEN
            RAISE EXCEPTION 'Cannot modify a resolved market';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_resolved_market ON markets;
CREATE TRIGGER guard_resolved_market
    BEFORE UPDATE ON markets
    FOR EACH ROW EXECUTE FUNCTION prevent_resolved_market_update();


-- ============================================================================
-- === Migration 049: fn_admin_backroll ===
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_backroll_market(
    p_market_id   UUID,
    p_admin_id    UUID,
    p_cutoff_date TIMESTAMPTZ,
    p_close_market BOOLEAN DEFAULT TRUE
) RETURNS JSONB AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_status TEXT;
    v_bet RECORD;
    v_total_refunded NUMERIC := 0;
    v_bets_cancelled INTEGER := 0;
    v_yes_refund NUMERIC := 0;
    v_no_refund NUMERIC := 0;
BEGIN
    SELECT (role IN ('admin', 'super_admin')) INTO v_is_admin
    FROM profiles WHERE id = p_admin_id;

    IF v_is_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'Only admins can perform backroll';
    END IF;

    SELECT status INTO v_status FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

    IF v_status = 'resolved' THEN
        RAISE EXCEPTION 'Cannot backroll a resolved market. Resolve must happen after backroll.';
    END IF;

    FOR v_bet IN
        SELECT id, user_id, side, amount
        FROM bets
        WHERE market_id = p_market_id
          AND created_at > p_cutoff_date
        ORDER BY created_at DESC
    LOOP
        UPDATE profiles SET banana_balance = banana_balance + v_bet.amount
        WHERE id = v_bet.user_id;

        INSERT INTO transactions (user_id, market_id, transaction_type, amount)
        VALUES (v_bet.user_id, p_market_id, 'payout', v_bet.amount);

        IF v_bet.side = 'YES' THEN
            v_yes_refund := v_yes_refund + v_bet.amount;
        ELSE
            v_no_refund := v_no_refund + v_bet.amount;
        END IF;

        v_total_refunded := v_total_refunded + v_bet.amount;
        v_bets_cancelled := v_bets_cancelled + 1;

        DELETE FROM bets WHERE id = v_bet.id;
    END LOOP;

    UPDATE markets SET
        yes_pool_total = GREATEST(0, yes_pool_total - v_yes_refund),
        no_pool_total = GREATEST(0, no_pool_total - v_no_refund)
    WHERE id = p_market_id;

    IF p_close_market THEN
        UPDATE markets SET
            status = 'closed',
            close_at = p_cutoff_date
        WHERE id = p_market_id;
    END IF;

    RETURN jsonb_build_object(
        'market_id', p_market_id,
        'bets_cancelled', v_bets_cancelled,
        'total_refunded', v_total_refunded,
        'new_close_at', p_cutoff_date,
        'status', CASE WHEN p_close_market THEN 'closed' ELSE v_status END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =========================================================================
-- 050 — equipped_badge_id on profiles
-- =========================================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS equipped_badge_id UUID
    REFERENCES badge_definitions(id) ON DELETE SET NULL
    DEFAULT NULL;

-- =========================================================================
-- 051 — avatar_url on profiles
-- =========================================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;

-- =========================================================================
-- 052 — avatars storage bucket
-- =========================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/gif','image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can update own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Avatars are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');


-- =========================================================================
-- 053 — equipped_badges map on profiles
-- =========================================================================
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS equipped_badges JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE profiles p
SET equipped_badges = jsonb_build_object(b.track, p.equipped_badge_id::text)
FROM badge_definitions b
WHERE p.equipped_badge_id = b.id
    AND (
        p.equipped_badges IS NULL
        OR p.equipped_badges = '{}'::jsonb
    );


-- =========================================================================
-- 054 — server-side aggregation RPCs for leaderboard gains and badge stats
-- =========================================================================
CREATE OR REPLACE FUNCTION get_gains_leaderboard(
    p_since TIMESTAMPTZ,
    p_limit INTEGER
) RETURNS TABLE (
    id UUID,
    andrew_id TEXT,
    display_name TEXT,
    banana_balance NUMERIC,
    gains NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH agg AS (
        SELECT t.user_id AS uid, SUM(t.amount)::NUMERIC AS total
        FROM transactions t
        WHERE t.transaction_type = 'payout'
          AND (p_since IS NULL OR t.created_at >= p_since)
        GROUP BY t.user_id
        HAVING SUM(t.amount) > 0
    )
    SELECT
        p.id,
        p.andrew_id,
        p.display_name,
        p.banana_balance,
        ROUND(a.total, 2) AS gains
    FROM agg a
    JOIN profiles p ON p.id = a.uid
    ORDER BY a.total DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_badge_stats(
    p_user_id UUID
) RETURNS TABLE (
    banana_baron NUMERIC,
    oracle BIGINT,
    architect BIGINT,
    degen BIGINT,
    whale NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE((SELECT banana_balance FROM profiles WHERE id = p_user_id), 0)::NUMERIC
            AS banana_baron,
        (
            SELECT COUNT(*)
            FROM bets b
            JOIN markets m ON b.market_id = m.id
            WHERE b.user_id = p_user_id
              AND m.status = 'resolved'
              AND b.side = m.resolved_outcome
        ) AS oracle,
        (
            SELECT COUNT(*)
            FROM markets
            WHERE creator_id = p_user_id
              AND status NOT IN ('pending_review', 'denied')
        ) AS architect,
        (
            SELECT COUNT(*)
            FROM bets
            WHERE user_id = p_user_id
        ) AS degen,
        COALESCE(
            (SELECT MAX(amount) FROM bets WHERE user_id = p_user_id),
            0
        )::NUMERIC AS whale;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- ============================================================================
-- === Migration 062: Badge Definitions RLS ===
-- ============================================================================

ALTER TABLE badge_definitions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'badge_definitions'
          AND policyname = 'Badge definitions are viewable by everyone'
    ) THEN
        CREATE POLICY "Badge definitions are viewable by everyone"
            ON badge_definitions FOR SELECT
            TO public
            USING (true);
    END IF;
END $$;


COMMIT;
