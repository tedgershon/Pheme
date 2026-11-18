-- Dispute submissions (#49): many concerns, one market-level case.
-- `disputes` stays the canonical case (one row and one voting lifecycle per market).
-- Individual explanations live in `dispute_submissions`; existing disputes are
-- copied in so no explanation is lost.

CREATE TABLE dispute_submissions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id   UUID NOT NULL REFERENCES disputes(id),
    market_id    UUID NOT NULL REFERENCES markets(id),
    submitter_id UUID NOT NULL REFERENCES profiles(id),
    explanation  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT dispute_submissions_one_per_user UNIQUE (dispute_id, submitter_id)
);

CREATE INDEX idx_dispute_submissions_market_id ON dispute_submissions (market_id, created_at);

-- Rows are append-only and reachable only through the functions below, so
-- submitter identity is never readable through the table API.
ALTER TABLE dispute_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE dispute_submissions FROM PUBLIC, anon, authenticated;

INSERT INTO dispute_submissions (dispute_id, market_id, submitter_id, explanation, created_at)
SELECT id, market_id, disputer_id, explanation, created_at FROM disputes;

-- Added after the copy and NOT VALID, so legacy explanations survive unchanged
-- while every new row must be trimmed and 1 to 1000 characters.
ALTER TABLE dispute_submissions ADD CONSTRAINT dispute_submissions_explanation_check
    CHECK (explanation = btrim(explanation) AND char_length(explanation) BETWEEN 1 AND 1000) NOT VALID;

-- Cases are created only by file_dispute (SECURITY DEFINER). The old client INSERT
-- policy let any signed-in user pre-insert a case for any market, skipping creator,
-- state and window checks and blocking the real first filing on the unique market_id.
DROP POLICY "Authenticated users can file disputes" ON disputes;
REVOKE INSERT, UPDATE, DELETE ON TABLE disputes FROM PUBLIC, anon, authenticated;

-- Filing: the first submission opens the case (market -> disputed, 48h voting
-- window); later submissions join it until that same voting deadline. They never
-- move a deadline, never create a second case, and each user may submit once.
CREATE OR REPLACE FUNCTION file_dispute(
    p_market_id   UUID,
    p_disputer_id UUID,
    p_explanation TEXT
) RETURNS JSONB AS $$
DECLARE
    v_claims        JSONB := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    v_explanation   TEXT := btrim(coalesce(p_explanation, ''));
    v_market        markets%ROWTYPE;
    v_dispute       disputes%ROWTYPE;
    v_submission    dispute_submissions%ROWTYPE;
    v_opened        BOOLEAN := FALSE;
BEGIN
    -- API calls carry the submitter's JWT; a client cannot file as someone else.
    IF v_claims IS NOT NULL
       AND coalesce(v_claims ->> 'role', '') <> 'service_role'
       AND (v_claims ->> 'sub') IS DISTINCT FROM p_disputer_id::text THEN
        RAISE EXCEPTION 'Disputes can only be filed as the signed-in user';
    END IF;

    IF char_length(v_explanation) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Explanation must be 1 to 1000 characters';
    END IF;

    -- The market lock serializes concurrent submissions and retries.
    SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Market not found';
    END IF;
    IF p_disputer_id = v_market.creator_id THEN
        RAISE EXCEPTION 'Market creator cannot file disputes';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_disputer_id) THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    IF v_market.status = 'pending_resolution' THEN
        IF v_market.proposed_outcome IS NULL OR v_market.dispute_deadline IS NULL THEN
            RAISE EXCEPTION 'A creator proposal and dispute deadline are required';
        END IF;
        IF clock_timestamp() >= v_market.dispute_deadline THEN
            RAISE EXCEPTION 'Dispute window has expired';
        END IF;

        INSERT INTO disputes (market_id, disputer_id, explanation, voting_deadline)
        VALUES (p_market_id, p_disputer_id, v_explanation, now() + interval '48 hours')
        RETURNING * INTO v_dispute;
        UPDATE markets SET status = 'disputed' WHERE id = p_market_id;
        v_opened := TRUE;
    ELSIF v_market.status = 'disputed' THEN
        SELECT * INTO v_dispute FROM disputes WHERE market_id = p_market_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Dispute not found';
        END IF;
        IF clock_timestamp() >= v_dispute.voting_deadline THEN
            RAISE EXCEPTION 'Dispute submission window has expired';
        END IF;
        IF EXISTS (
            SELECT 1 FROM dispute_submissions
            WHERE dispute_id = v_dispute.id AND submitter_id = p_disputer_id
        ) THEN
            RAISE EXCEPTION 'You have already submitted a concern for this market';
        END IF;
    ELSE
        RAISE EXCEPTION 'Market is not in pending_resolution or disputed status';
    END IF;

    INSERT INTO dispute_submissions (dispute_id, market_id, submitter_id, explanation)
    VALUES (v_dispute.id, p_market_id, p_disputer_id, v_explanation)
    RETURNING * INTO v_submission;

    RETURN jsonb_build_object(
        'id', v_submission.id,
        'dispute_id', v_dispute.id,
        'market_id', p_market_id,
        'submitter_id', p_disputer_id,
        'explanation', v_submission.explanation,
        'voting_deadline', v_dispute.voting_deadline,
        'opened_case', v_opened,
        'created_at', v_submission.created_at
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Public view: explanations are visible so neutral voters can weigh them, but
-- submitters are anonymous. Only the caller's own rows are flagged.
CREATE FUNCTION list_dispute_submissions(
    p_market_id UUID,
    p_limit     INTEGER DEFAULT 50,
    p_offset    INTEGER DEFAULT 0
) RETURNS JSONB AS $$
    SELECT jsonb_build_object(
        'total', (SELECT count(*) FROM dispute_submissions WHERE market_id = p_market_id),
        'has_submitted', coalesce(auth.uid() IS NOT NULL AND EXISTS (
            SELECT 1 FROM dispute_submissions
            WHERE market_id = p_market_id AND submitter_id = auth.uid()
        ), FALSE),
        'items', coalesce((
            SELECT jsonb_agg(item ORDER BY created_at, id) FROM (
                SELECT jsonb_build_object(
                           'id', id,
                           'explanation', explanation,
                           'created_at', created_at,
                           'is_mine', submitter_id IS NOT DISTINCT FROM auth.uid()
                       ) AS item, created_at, id
                FROM dispute_submissions
                WHERE market_id = p_market_id
                ORDER BY created_at, id
                LIMIT least(greatest(p_limit, 1), 100) OFFSET greatest(p_offset, 0)
            ) page
        ), '[]'::jsonb)
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- Admin view: submitters and their relationship to the market. A refunded
-- bettor has a bet-placement ledger entry but no remaining bet.
CREATE FUNCTION admin_dispute_submissions(p_market_ids UUID[])
RETURNS TABLE (
    id            UUID,
    market_id     UUID,
    explanation   TEXT,
    created_at    TIMESTAMPTZ,
    submitter_id  UUID,
    andrew_id     TEXT,
    display_name  TEXT,
    bettor_context TEXT
) AS $$
DECLARE
    v_claims JSONB := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
BEGIN
    IF coalesce(v_claims ->> 'role', '') <> 'service_role' AND NOT EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin', 'super_admin')
    ) THEN
        RAISE EXCEPTION 'Only admins can review dispute submissions';
    END IF;

    RETURN QUERY
    SELECT s.id, s.market_id, s.explanation, s.created_at, s.submitter_id,
           p.andrew_id, p.display_name,
           CASE
               WHEN EXISTS (SELECT 1 FROM bets b WHERE b.market_id = s.market_id AND b.user_id = s.submitter_id)
                   THEN 'active'
               WHEN EXISTS (
                   SELECT 1 FROM transactions t
                   WHERE t.market_id = s.market_id AND t.user_id = s.submitter_id
                     AND t.transaction_type = 'bet_placement'
               ) THEN 'refunded'
               ELSE 'none'
           END
    FROM dispute_submissions s
    JOIN profiles p ON p.id = s.submitter_id
    WHERE s.market_id = ANY (p_market_ids)
    ORDER BY s.created_at, s.id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.list_dispute_submissions(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_dispute_submissions(uuid, integer, integer)
    TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_dispute_submissions(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dispute_submissions(uuid[]) TO authenticated, service_role;
