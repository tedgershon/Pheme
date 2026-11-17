-- 016: function — cast a vote on a dispute (neutral users only)

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

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispute not found';
    END IF;

    IF now() >= v_voting_deadline THEN
        RAISE EXCEPTION 'Voting window has expired';
    END IF;

    SELECT status, creator_id INTO v_market_status, v_creator_id
    FROM markets WHERE id = v_market_id FOR UPDATE;

    IF v_market_status != 'disputed' THEN
        RAISE EXCEPTION 'Market is not in disputed status';
    END IF;

    -- neutrality: not the creator
    IF p_voter_id = v_creator_id THEN
        RAISE EXCEPTION 'Market creator cannot vote on disputes';
    END IF;

    -- neutrality: not a bettor
    IF EXISTS (SELECT 1 FROM bets WHERE market_id = v_market_id AND user_id = p_voter_id) OR EXISTS (SELECT 1 FROM transactions WHERE market_id = v_market_id AND user_id = p_voter_id AND transaction_type = 'bet_placement') THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
-- 049_fn_admin_backroll.sql
-- Admin backroll: cancel bets placed after a given cutoff date
-- and refund those bettors. Adjust pool totals accordingly.

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
    IF p_cutoff_date IS NULL THEN RAISE EXCEPTION 'Cutoff is required'; END IF;
    -- Verify admin
    SELECT (role IN ('admin', 'super_admin')) INTO v_is_admin
    FROM profiles WHERE id = p_admin_id;

    IF v_is_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'Only admins can perform backroll';
    END IF;

    -- Lock market
    SELECT status INTO v_status FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

    IF v_status = 'resolved' THEN
        RAISE EXCEPTION 'Cannot backroll a resolved market. Resolve must happen after backroll.';
    END IF;

    -- Find and refund bets placed after the cutoff
    FOR v_bet IN
        SELECT id, user_id, side, option_id, amount
        FROM bets
        WHERE market_id = p_market_id
          AND created_at > p_cutoff_date
        ORDER BY user_id, id
    LOOP
        -- Refund the user
        UPDATE profiles SET banana_balance = banana_balance + v_bet.amount
        WHERE id = v_bet.user_id;

        -- Record refund transaction
        INSERT INTO transactions (user_id, market_id, transaction_type, amount)
        VALUES (v_bet.user_id, p_market_id, 'payout', v_bet.amount);

        -- Track pool adjustments
        IF v_bet.option_id IS NOT NULL THEN
            UPDATE market_options SET pool_total = pool_total - v_bet.amount
            WHERE id = v_bet.option_id AND pool_total >= v_bet.amount;
            IF NOT FOUND THEN RAISE EXCEPTION 'Option pool accounting mismatch'; END IF;
        ELSIF v_bet.side = 'YES' THEN
            v_yes_refund := v_yes_refund + v_bet.amount;
        ELSE
            v_no_refund := v_no_refund + v_bet.amount;
        END IF;

        v_total_refunded := v_total_refunded + v_bet.amount;
        v_bets_cancelled := v_bets_cancelled + 1;

        -- Delete the bet
        DELETE FROM bets WHERE id = v_bet.id;
    END LOOP;

    -- Adjust pool totals
    UPDATE markets SET
        yes_pool_total = yes_pool_total - v_yes_refund,
        no_pool_total = no_pool_total - v_no_refund
    WHERE id = p_market_id;

    -- Optionally close the market with the cutoff as the true close time
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
-- 047_harden_place_bet.sql
-- Harden the place_bet function:
--   1. Check close_at timestamp (lazy close at bet time) in addition to status
--   2. Prevent market creators from betting on their own markets
-- Concurrency note: FOR UPDATE locks on both profiles and markets rows
-- ensure that concurrent bets by the same user or on the same market
-- are serialized. PostgreSQL guarantees no lost updates or dirty reads.

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

    SELECT status, close_at, creator_id INTO v_market_status, v_close_at, v_creator_id
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

    -- Creator cannot bet on their own market
    IF p_user_id = v_creator_id THEN
        RAISE EXCEPTION 'Market creators cannot place bets on their own markets';
    END IF;

    -- Check both status AND close_at timestamp
    IF v_market_status != 'open' THEN
        RAISE EXCEPTION 'Market is not open for betting';
    END IF;

    IF v_close_at <= now() THEN
        UPDATE markets SET status = 'closed' WHERE id = p_market_id;
        RAISE EXCEPTION 'Market has closed';
    END IF;

    SELECT banana_balance INTO v_balance
    FROM profiles WHERE id = p_user_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
    IF v_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;


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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
CREATE OR REPLACE FUNCTION place_multichoice_bet(
    p_user_id   UUID,
    p_market_id UUID,
    p_option_id UUID,
    p_amount    NUMERIC
) RETURNS JSONB AS $$
DECLARE
    v_balance NUMERIC;
    v_creator UUID;
    v_close_at TIMESTAMPTZ;
    v_market_status TEXT;
    v_market_type   TEXT;
    v_option_market UUID;
    v_bet_id        UUID;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Bet amount must be positive';
    END IF;

    -- Verify option belongs to the market
    SELECT market_id INTO v_option_market
    FROM market_options WHERE id = p_option_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Option not found';
    END IF;

    IF v_option_market != p_market_id THEN
        RAISE EXCEPTION 'Option does not belong to this market';
    END IF;

    -- Lock user and check balance
    SELECT status, market_type, creator_id, close_at INTO v_market_status, v_market_type, v_creator, v_close_at
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;
    IF v_market_status != 'open' THEN RAISE EXCEPTION 'Market is not open for betting'; END IF;
    IF v_market_type != 'multichoice' THEN RAISE EXCEPTION 'Market is not multichoice'; END IF;

    IF p_user_id = v_creator THEN RAISE EXCEPTION 'Market creators cannot place bets on their own markets'; END IF;
    IF clock_timestamp() >= v_close_at THEN RAISE EXCEPTION 'Market has closed'; END IF;

    SELECT banana_balance INTO v_balance
    FROM profiles WHERE id = p_user_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
    IF v_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

    -- Lock market and check status

    -- Deduct balance
    UPDATE profiles SET banana_balance = banana_balance - p_amount WHERE id = p_user_id;

    -- Update option pool
    UPDATE market_options SET pool_total = pool_total + p_amount WHERE id = p_option_id;

    -- Record the bet
    INSERT INTO bets (user_id, market_id, option_id, amount)
    VALUES (p_user_id, p_market_id, p_option_id, p_amount)
    RETURNING id INTO v_bet_id;

    -- Record transaction
    INSERT INTO transactions (user_id, market_id, transaction_type, amount)
    VALUES (p_user_id, p_market_id, 'bet_placement', -p_amount);

    RETURN jsonb_build_object(
        'bet_id', v_bet_id,
        'new_balance', v_balance - p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
