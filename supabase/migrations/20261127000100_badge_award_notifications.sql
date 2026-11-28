-- One notification per recorded tier, including upgrades within a track.
CREATE UNIQUE INDEX idx_notifications_one_per_badge_tier
    ON public.notifications (user_id, (metadata->>'track'), (metadata->>'tier'))
    WHERE type = 'badge_earned';

CREATE FUNCTION private.notify_badge_earned(
    p_user_id uuid, p_track text, p_tier integer, p_name text
) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO notifications (user_id, type, title, body, metadata)
    VALUES (
        p_user_id, 'badge_earned', 'Badge Earned',
        format('You earned %s (tier %s).', p_name, p_tier),
        jsonb_build_object('track', p_track, 'tier', p_tier, 'name', p_name)
    )
    ON CONFLICT (user_id, (metadata->>'track'), (metadata->>'tier'))
        WHERE type = 'badge_earned'
    DO NOTHING;
EXCEPTION WHEN OTHERS THEN
    -- Keep the award when its notification cannot be stored.
    RAISE WARNING 'Could not create badge_earned notification (SQLSTATE %)', SQLSTATE;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_badge_earned(uuid, text, integer, text)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_and_award_badges(
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
    SELECT tartan_coin_balance INTO v_balance FROM profiles WHERE id = p_user_id;

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
                WHEN 'steel_baron' THEN v_balance
                WHEN 'oracle' THEN v_correct_bets
                WHEN 'architect' THEN v_markets_created
                WHEN 'degen' THEN v_total_bets
                WHEN 'whale' THEN v_max_single_bet
            END;

            IF v_current_value >= v_badge.threshold THEN
                SELECT tier INTO v_current_tier
                FROM user_badges WHERE user_id = p_user_id AND track = v_badge.track;

                IF NOT FOUND OR v_current_tier < v_badge.tier THEN
                    INSERT INTO user_badges AS earned (user_id, badge_id, track, tier)
                    VALUES (p_user_id, v_badge.id, v_badge.track, v_badge.tier)
                    ON CONFLICT (user_id, track) DO UPDATE
                    SET badge_id = EXCLUDED.badge_id, tier = EXCLUDED.tier, earned_at = now()
                    WHERE earned.tier < EXCLUDED.tier;

                    -- A concurrent check may have already awarded this tier or a higher one.
                    IF FOUND THEN
                        v_new_badges := v_new_badges || jsonb_build_object(
                            'track', v_badge.track,
                            'tier', v_badge.tier,
                            'name', v_badge.name
                        );
                        PERFORM private.notify_badge_earned(
                            p_user_id, v_badge.track, v_badge.tier, v_badge.name
                        );
                    END IF;
                END IF;

                CONTINUE;
            END IF;
        END;
    END LOOP;

    RETURN v_new_badges;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
