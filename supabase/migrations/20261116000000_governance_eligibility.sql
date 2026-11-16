-- 015: function — file a dispute during pending_resolution window

CREATE OR REPLACE FUNCTION file_dispute(
    p_market_id   UUID,
    p_disputer_id UUID,
    p_explanation TEXT
) RETURNS JSONB AS $$
DECLARE
    v_status TEXT;
    v_creator UUID;
    v_proposal TEXT;
    v_dispute_deadline  TIMESTAMPTZ;
    v_dispute_id       UUID;
BEGIN
    SELECT status, dispute_deadline, creator_id, proposed_outcome INTO v_status, v_dispute_deadline, v_creator, v_proposal
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Market not found';
    END IF;

    IF v_status != 'pending_resolution' THEN
        RAISE EXCEPTION 'Market is not in pending_resolution status';
    END IF;

    IF v_proposal IS NULL OR v_dispute_deadline IS NULL THEN
        RAISE EXCEPTION 'A creator proposal and dispute deadline are required';
    END IF;
    IF p_disputer_id = v_creator THEN
        RAISE EXCEPTION 'Market creator cannot file disputes';
    END IF;
    IF EXISTS (SELECT 1 FROM bets WHERE market_id = p_market_id AND user_id = p_disputer_id) THEN
        RAISE EXCEPTION 'Users who placed bets cannot file disputes';
    END IF;
    IF clock_timestamp() >= v_dispute_deadline THEN
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
    SELECT banana_balance INTO v_balance
    FROM profiles WHERE id = p_user_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
    IF v_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

    -- Lock market and check status
    SELECT status, market_type, creator_id, close_at INTO v_market_status, v_market_type, v_creator, v_close_at
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;
    IF v_market_status != 'open' THEN RAISE EXCEPTION 'Market is not open for betting'; END IF;
    IF v_market_type != 'multichoice' THEN RAISE EXCEPTION 'Market is not multichoice'; END IF;

    IF p_user_id = v_creator THEN RAISE EXCEPTION 'Market creators cannot place bets on their own markets'; END IF;
    IF clock_timestamp() >= v_close_at THEN RAISE EXCEPTION 'Market has closed'; END IF;

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
