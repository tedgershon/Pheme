-- Reconcile the historical snapshot and installations that already applied some
-- later patches. No initial table creation, balance edits or automatic promotion.
SET search_path = public, extensions;

-- 031 added option bets but retained the initial binary-only NOT NULL.
ALTER TABLE public.bets ALTER COLUMN side DROP NOT NULL;


-- Restore the unread RPC body as well as its search_path in 060 below.
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


-- Source: archived iterations/054_notification_types_admin_reminder.sql
-- Add new notification types for admin alerts and resolution reminders
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'market_approved', 'market_denied', 'market_closed',
    'market_resolved', 'payout_received',
    'badge_earned', 'system',
    'market_submitted',      -- Admin: new market needs review
    'resolution_reminder'    -- Creator: reminder to resolve closed market
));


-- Source: archived iterations/057_notify_admins_market_submitted_rpc.sql
-- In-app admin alerts when a market is submitted.
-- Direct INSERT into notifications as the creator's JWT is blocked by Supabase/PostgREST
-- for rows where user_id != auth.uid(), even with a permissive WITH CHECK (true) policy.
-- This SECURITY DEFINER RPC runs as the function owner (bypasses RLS on insert) but still
-- enforces auth.uid() = market.creator_id so only the creator can trigger it.

CREATE OR REPLACE FUNCTION public.notify_admins_market_submitted(p_market_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m markets%ROWTYPE;
  creator_name text;
  admin_record RECORD;
  notification_body text;
BEGIN
  SELECT * INTO m FROM markets WHERE id = p_market_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF m.creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the market creator can trigger admin notifications for this market';
  END IF;

  SELECT COALESCE(display_name, andrew_id, 'Unknown') INTO creator_name
  FROM profiles WHERE id = m.creator_id;

  notification_body := format(
    E'A new market has been submitted for review by %s.\n\nTitle: %s\nDescription: %s\nCategory: %s\nClose Date: %s\n\nPlease review the market in the Admin panel.',
    creator_name,
    m.title,
    m.description,
    m.category,
    m.close_at::text
  );

  FOR admin_record IN
    SELECT id FROM profiles WHERE role IN ('admin', 'super_admin')
  LOOP
    INSERT INTO notifications (user_id, type, title, body, metadata)
    VALUES (
      admin_record.id,
      'market_submitted',
      'New Market Awaiting Review',
      notification_body,
      jsonb_build_object('market_id', m.id::text, 'creator_id', m.creator_id::text)
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_admins_market_submitted(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_admins_market_submitted(uuid) TO authenticated;


-- Source: archived iterations/058_notifications_delete_policy.sql
DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;
-- Allow users to delete their own in-app notifications (API uses authenticated JWT).
CREATE POLICY "Users can delete own notifications"
    ON notifications FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);


-- Source: archived iterations/059_notifications_insert_owner_only.sql
DROP POLICY IF EXISTS "Users can mark own notifications read" ON notifications;
-- Strict notifications hardening:
-- 1) No direct client inserts
-- 2) No general updates
-- 3) Allow only mark-as-read (is_read=true) on own rows

DROP POLICY IF EXISTS "System can insert notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;

-- Restrict UPDATE privilege to the is_read column for authenticated users.
REVOKE UPDATE ON TABLE notifications FROM authenticated;
GRANT UPDATE (is_read) ON TABLE notifications TO authenticated;

CREATE POLICY "Users can mark own notifications read"
    ON notifications FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id AND is_read = TRUE);


-- Source: archived iterations/060_notifications_idempotent_market_rpc.sql
-- Fix two blatant issues in notifications:
--
-- 1) get_unread_notification_count was missing search_path, flagged by
--    supabase lint 0011. Matches notify_admins_market_submitted which
--    already sets it correctly.
--
-- 2) notify_market_closed / _approved / _denied used a query-then-insert
--    dedup pattern — two concurrent calls could both see "not found" and
--    both insert. This adds a generated market_id column + partial unique
--    index + a SECURITY DEFINER RPC that wraps the insert in ON CONFLICT
--    DO NOTHING so dedup is atomic.
--
-- Side benefit: the RPC bypasses RLS on its own, so these three notify
-- paths no longer need the service-role client.

ALTER FUNCTION public.get_unread_notification_count(uuid) SET search_path = public;

ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS market_id uuid
    GENERATED ALWAYS AS ((metadata->>'market_id')::uuid) STORED;

-- one-per-market rule only applies to lifecycle events; reminders and
-- system notifs can still repeat
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_one_per_market_event
    ON public.notifications (user_id, type, market_id)
    WHERE market_id IS NOT NULL
        AND type IN (
            'market_approved',
            'market_denied',
            'market_closed',
            'market_resolved',
            'payout_received',
            'market_submitted'
        );

CREATE OR REPLACE FUNCTION public.create_market_notification(
    p_user_id uuid,
    p_type text,
    p_title text,
    p_body text,
    p_market_id uuid,
    p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_id uuid;
    v_metadata jsonb;
BEGIN
    -- keep the blast radius of this SECURITY DEFINER narrow
    IF p_type NOT IN (
        'market_approved','market_denied','market_closed',
        'market_resolved','payout_received','market_submitted'
    ) THEN
        RAISE EXCEPTION 'type % not allowed through create_market_notification', p_type;
    END IF;
    IF p_market_id IS NULL THEN
        RAISE EXCEPTION 'p_market_id is required';
    END IF;

    v_metadata := COALESCE(p_metadata, '{}'::jsonb)
                  || jsonb_build_object('market_id', p_market_id::text);

    INSERT INTO public.notifications (user_id, type, title, body, metadata)
    VALUES (p_user_id, p_type, p_title, p_body, v_metadata)
    ON CONFLICT (user_id, type, market_id)
        WHERE market_id IS NOT NULL
            AND type IN (
                'market_approved','market_denied','market_closed',
                'market_resolved','payout_received','market_submitted'
            )
    DO NOTHING
    RETURNING id INTO v_id;

    RETURN v_id;  -- NULL when dedup hit
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.create_market_notification(uuid, text, text, text, uuid, jsonb)
    TO authenticated, service_role;


-- Source: archived iterations/061_fn_networth_leaderboard.sql
-- Gain-in-coins leaderboard: net_worth - deposits.
--
-- Net worth = banana_balance + sum of stake on unresolved bets. In a
-- pari-mutuel pool the mark-to-market value of an open bet is its stake,
-- so adding stakes back is the fair valuation.
--
-- Deposits = sum of initial_grant + daily_claim transactions. Subtracting
-- these strips out "free money" from sign-ins so the number reflects
-- trading skill alone, not tenure on the platform.
--
-- Ranked by gain desc; can be negative for users sitting on losses.

DROP FUNCTION IF EXISTS public.get_networth_leaderboard(integer);

CREATE FUNCTION public.get_networth_leaderboard(p_limit integer)
RETURNS TABLE (
    id uuid,
    andrew_id text,
    display_name text,
    banana_balance numeric,
    gain numeric,
    equipped_badge_id uuid,
    equipped_badges jsonb,
    avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH open_stakes AS (
        SELECT b.user_id, COALESCE(SUM(b.amount), 0) AS stake
        FROM bets b
        JOIN markets m ON m.id = b.market_id
        WHERE m.status NOT IN ('resolved', 'denied')
        GROUP BY b.user_id
    ),
    deposits AS (
        SELECT t.user_id, COALESCE(SUM(t.amount), 0) AS total
        FROM transactions t
        WHERE t.transaction_type IN ('initial_grant', 'daily_claim')
        GROUP BY t.user_id
    )
    SELECT
        p.id,
        p.andrew_id,
        p.display_name,
        p.banana_balance,
        (p.banana_balance + COALESCE(s.stake, 0) - COALESCE(d.total, 0)) AS gain,
        p.equipped_badge_id,
        p.equipped_badges,
        p.avatar_url
    FROM profiles p
    LEFT JOIN open_stakes s ON s.user_id = p.id
    LEFT JOIN deposits d ON d.user_id = p.id
    ORDER BY gain DESC
    LIMIT p_limit;
$$;


-- Source: archived top-level proposal patch (not iteration 021).
-- 021: allow propose_resolution to auto-close markets once close_at has passed

CREATE OR REPLACE FUNCTION propose_resolution(
    p_market_id   UUID,
    p_outcome     TEXT,
    p_proposer_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_status     TEXT;
    v_creator_id UUID;
    v_close_at   TIMESTAMPTZ;
BEGIN
    IF p_outcome NOT IN ('YES', 'NO') THEN
        RAISE EXCEPTION 'Invalid outcome: must be YES or NO';
    END IF;

    SELECT status, creator_id, close_at INTO v_status, v_creator_id, v_close_at
    FROM markets WHERE id = p_market_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Market not found';
    END IF;

    IF v_status = 'open' AND v_close_at <= now() THEN
        UPDATE markets SET status = 'closed' WHERE id = p_market_id;
        v_status := 'closed';
    END IF;

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
