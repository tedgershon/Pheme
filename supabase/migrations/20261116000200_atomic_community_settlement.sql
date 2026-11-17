-- Private receipt protects rewards from replay and records atomic completion.
CREATE TABLE private.community_settlements (
    market_id uuid PRIMARY KEY REFERENCES public.markets(id),
    outcome text NOT NULL CHECK (outcome IN ('YES','NO')),
    rewards_paid boolean NOT NULL DEFAULT false
);
REVOKE ALL ON private.community_settlements FROM PUBLIC, anon, authenticated, service_role;
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
    PERFORM 1 FROM markets WHERE id=p_market_id AND status='resolved' AND resolved_outcome=p_winning_outcome FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rewards require a matching resolved market'; END IF;
    IF p_reward_pct IS DISTINCT FROM 0.04::numeric THEN RAISE EXCEPTION 'Reward percentage must be 0.04'; END IF;
    IF NOT EXISTS (SELECT 1 FROM private.community_settlements WHERE market_id=p_market_id AND outcome=p_winning_outcome) THEN
        RAISE EXCEPTION 'Rewards require an atomic community settlement';
    END IF;
    IF EXISTS (SELECT 1 FROM private.community_settlements WHERE market_id=p_market_id AND rewards_paid) THEN RETURN; END IF;
    UPDATE private.community_settlements SET rewards_paid=true WHERE market_id=p_market_id;
    SELECT yes_pool_total + no_pool_total INTO v_total_pool
    FROM markets WHERE id = p_market_id;

    IF v_total_pool IS NULL OR v_total_pool <= 0 THEN
        RETURN;
    END IF;

    v_reward_pool := v_total_pool * p_reward_pct;

    SELECT count(*) INTO v_winner_count
    FROM community_votes
    WHERE market_id = p_market_id AND selected_outcome = p_winning_outcome;

    IF v_winner_count = 0 THEN
        RETURN;
    END IF;

    v_reward_each := round(v_reward_pool / v_winner_count, 2);

    IF v_reward_each <= 0 THEN
        RETURN;
    END IF;

    FOR v_voter IN
        SELECT voter_id FROM community_votes
        WHERE market_id = p_market_id AND selected_outcome = p_winning_outcome ORDER BY voter_id
    LOOP
        UPDATE profiles
        SET banana_balance = banana_balance + v_reward_each
        WHERE id = v_voter.voter_id;

        INSERT INTO transactions (user_id, market_id, transaction_type, amount)
        VALUES (v_voter.voter_id, p_market_id, 'resolution_vote_reward', v_reward_each);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
-- 014: function — shared payout logic called by all 3 resolution paths

CREATE OR REPLACE FUNCTION finalize_resolution(
    p_market_id UUID,
    p_outcome   TEXT
) RETURNS JSONB AS $$
DECLARE
    v_status TEXT;
    v_market markets%ROWTYPE;
    v_yes integer;
    v_no integer;
    v_community boolean;
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

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Market not found';
    END IF;

    SELECT * INTO v_market FROM markets WHERE id=p_market_id;
    IF v_status='resolved' AND EXISTS (SELECT 1 FROM private.community_settlements WHERE market_id=p_market_id AND outcome=p_outcome AND rewards_paid) THEN
        RETURN jsonb_build_object('market_id',p_market_id,'status','resolved','outcome',p_outcome);
    END IF;
    v_community := v_status='pending_resolution' AND v_market.proposed_outcome IS NULL;
    IF v_community THEN
        IF v_market.market_type <> 'binary' OR v_market.resolution_window_end IS NULL OR clock_timestamp() < v_market.resolution_window_end THEN
            RAISE EXCEPTION 'Community resolution window has not ended or market is not binary';
        END IF;
        SELECT count(*) FILTER (WHERE selected_outcome='YES'), count(*) FILTER (WHERE selected_outcome='NO')
        INTO v_yes,v_no FROM community_votes WHERE market_id=p_market_id;
        IF v_yes+v_no < 3 OR v_yes=v_no OR p_outcome <> (CASE WHEN v_yes>v_no THEN 'YES' ELSE 'NO' END) THEN
            RAISE EXCEPTION 'Community quorum and majority must match outcome';
        END IF;
        INSERT INTO private.community_settlements (market_id,outcome) VALUES (p_market_id,p_outcome);
    END IF;
    -- Deterministic profile lock order across payouts and voter rewards.
    PERFORM 1 FROM profiles WHERE id IN (
        SELECT user_id FROM bets WHERE market_id=p_market_id
        UNION SELECT voter_id FROM community_votes WHERE market_id=p_market_id
    ) ORDER BY id FOR UPDATE;
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

    -- no one bet on winning side: refund everyone
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
        -- proportional payout to winners
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

    IF v_community THEN PERFORM distribute_voter_rewards(p_market_id,p_outcome); END IF;
    RETURN jsonb_build_object(
        'market_id', p_market_id,
        'status', 'resolved',
        'outcome', p_outcome
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
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
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Market not found';
    END IF;

    -- Allow voting during closed, pending_resolution states while within resolution window
    IF v_status NOT IN ('closed', 'pending_resolution') THEN
        RAISE EXCEPTION 'Market is not in the resolution period';
    END IF;

    IF v_resolution_end IS NULL THEN
        RAISE EXCEPTION 'Resolution window has not been set for this market';
    END IF;

    IF clock_timestamp() >= v_resolution_end THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
