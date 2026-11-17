-- Admin resolution queue (#31): AMBIGUOUS refunds and guarded admin settlement.
-- No existing rows are rewritten; constraint changes only widen accepted values.

ALTER TABLE markets DROP CONSTRAINT markets_resolved_outcome_check;
ALTER TABLE markets ADD CONSTRAINT markets_resolved_outcome_check
    CHECK (resolved_outcome IN ('YES', 'NO', 'AMBIGUOUS'));

ALTER TABLE transactions DROP CONSTRAINT transactions_transaction_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_transaction_type_check
    CHECK (transaction_type IN (
        'initial_grant', 'bet_placement', 'payout',
        'voter_stake', 'voter_reward', 'daily_claim',
        'resolution_vote_reward', 'refund'
    ));

-- Keep the verified #38 settlement body unchanged, but move it behind a public
-- wrapper so a direct RPC call cannot settle an escalated market without an admin.
ALTER FUNCTION public.finalize_resolution(uuid, text) RENAME TO settle_binary_market;
ALTER FUNCTION public.settle_binary_market(uuid, text) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.settle_binary_market(uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.finalize_resolution(
    p_market_id UUID,
    p_outcome   TEXT
) RETURNS JSONB AS $$
DECLARE
    v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM markets WHERE id = p_market_id FOR UPDATE;
    -- admin_resolve_market marks its own transaction; nothing else may settle here.
    IF v_status = 'admin_review'
       AND current_setting('pheme.admin_resolution', true) IS DISTINCT FROM p_market_id::text THEN
        RAISE EXCEPTION 'Markets in admin_review require admin resolution';
    END IF;
    RETURN private.settle_binary_market(p_market_id, p_outcome);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION admin_resolve_market(
    p_market_id UUID,
    p_outcome   TEXT,
    p_admin_id  UUID
) RETURNS JSONB AS $$
DECLARE
    v_claims       JSONB := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    v_market       markets%ROWTYPE;
    v_refund       RECORD;
    v_refunded     NUMERIC := 0;
    v_refund_users INTEGER := 0;
    v_result       JSONB;
BEGIN
    IF p_outcome IS NULL OR p_outcome NOT IN ('YES', 'NO', 'AMBIGUOUS') THEN
        RAISE EXCEPTION 'Invalid outcome: must be YES, NO or AMBIGUOUS';
    END IF;

    -- API calls carry the acting admin's JWT; a client cannot name another admin.
    IF v_claims IS NOT NULL
       AND coalesce(v_claims ->> 'role', '') <> 'service_role'
       AND (v_claims ->> 'sub') IS DISTINCT FROM p_admin_id::text THEN
        RAISE EXCEPTION 'Only admins can resolve markets in admin review';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM profiles WHERE id = p_admin_id AND role IN ('admin', 'super_admin')
    ) THEN
        RAISE EXCEPTION 'Only admins can resolve markets in admin review';
    END IF;

    -- Market lock first (as betting/backroll do); waiters re-read the committed status.
    SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Market not found';
    END IF;
    IF v_market.status = 'resolved' THEN
        RAISE EXCEPTION 'Market is already resolved';
    END IF;
    IF v_market.status <> 'admin_review' THEN
        RAISE EXCEPTION 'Market is not in admin_review status';
    END IF;
    IF v_market.creator_id = p_admin_id THEN
        RAISE EXCEPTION 'Market creators cannot resolve their own markets';
    END IF;

    UPDATE disputes SET resolved_by_admin = TRUE WHERE market_id = p_market_id;

    IF p_outcome = 'AMBIGUOUS' THEN
        -- Refund every stake (binary or option) once; pools stay as historical totals.
        PERFORM 1 FROM profiles
        WHERE id IN (SELECT user_id FROM bets WHERE market_id = p_market_id)
        ORDER BY id FOR UPDATE;

        UPDATE markets SET
            status           = 'resolved',
            resolved_outcome = 'AMBIGUOUS',
            resolved_at      = now()
        WHERE id = p_market_id;

        FOR v_refund IN
            SELECT user_id, SUM(amount) AS total
            FROM bets WHERE market_id = p_market_id
            GROUP BY user_id ORDER BY user_id
        LOOP
            UPDATE profiles SET banana_balance = banana_balance + v_refund.total
            WHERE id = v_refund.user_id;

            INSERT INTO transactions (user_id, market_id, transaction_type, amount)
            VALUES (v_refund.user_id, p_market_id, 'refund', v_refund.total);

            v_refunded := v_refunded + v_refund.total;
            v_refund_users := v_refund_users + 1;
        END LOOP;

        RETURN jsonb_build_object(
            'market_id', p_market_id,
            'status', 'resolved',
            'outcome', 'AMBIGUOUS',
            'refunded_total', v_refunded,
            'refunded_users', v_refund_users
        );
    END IF;

    IF v_market.market_type <> 'binary' THEN
        RAISE EXCEPTION 'YES/NO admin resolution requires a binary market';
    END IF;

    PERFORM set_config('pheme.admin_resolution', p_market_id::text, true);
    v_result := finalize_resolution(p_market_id, p_outcome);
    PERFORM set_config('pheme.admin_resolution', '', true);
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.admin_resolve_market(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_market(uuid, text, uuid) TO authenticated, service_role;
