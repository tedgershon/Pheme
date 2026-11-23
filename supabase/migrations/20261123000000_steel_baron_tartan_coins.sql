-- Rename in place: balance values, badge UUIDs, earned dates and thresholds survive.
ALTER TABLE public.profiles RENAME COLUMN banana_balance TO tartan_coin_balance;
ALTER FUNCTION public.claim_daily_bananas(uuid) RENAME TO claim_daily_tartan_coins;

UPDATE public.badge_definitions AS badge
SET track = 'steel_baron', name = rank.name
FROM (VALUES
    (1, 'Mill Apprentice'), (2, 'Steelworker'), (3, 'Mill Foreman'),
    (4, 'Mill Owner'), (5, 'Steel Baron')
) AS rank(tier, name)
WHERE badge.track = 'banana_baron' AND badge.tier = rank.tier;

UPDATE public.user_badges SET track = 'steel_baron' WHERE track = 'banana_baron';

-- A map can contain badges from several tracks. Move only this entry.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.profiles
               WHERE equipped_badges ? 'banana_baron' AND equipped_badges ? 'steel_baron'
                 AND equipped_badges->'banana_baron' IS DISTINCT FROM equipped_badges->'steel_baron') THEN
        RAISE EXCEPTION 'Conflicting equipped balance badges; reconcile the two entries before migrating';
    END IF;
END;
$$;
UPDATE public.profiles
SET equipped_badges = (equipped_badges - 'banana_baron')
    || jsonb_build_object('steel_baron', equipped_badges->'banana_baron')
WHERE equipped_badges ? 'banana_baron';

-- PostgreSQL does not rewrite SQL inside string-bodied routines on column rename.
-- Recompile only these existing engine routines, retaining locking, owner and grants.
DO $$
DECLARE
    routine regprocedure;
BEGIN
    FOREACH routine IN ARRAY ARRAY[
        'public.place_bet(uuid,uuid,text,numeric)'::regprocedure,
        'public.place_multichoice_bet(uuid,uuid,uuid,numeric)'::regprocedure,
        'public.resolve_market(uuid,text,uuid)'::regprocedure,
        'public.resolve_multichoice_market(uuid,uuid[])'::regprocedure,
        'private.settle_binary_market(uuid,text)'::regprocedure,
        'public.admin_resolve_market(uuid,text,uuid)'::regprocedure,
        'public.distribute_voter_rewards(uuid,text,numeric)'::regprocedure,
        'public.admin_backroll_market(uuid,uuid,timestamptz,boolean)'::regprocedure,
        'public.claim_daily_tartan_coins(uuid)'::regprocedure,
        'public.check_claim_eligibility(uuid)'::regprocedure,
        'public.check_and_award_badges(uuid)'::regprocedure
    ] LOOP
        EXECUTE replace(replace(pg_get_functiondef(routine),
            'banana_balance', 'tartan_coin_balance'), 'banana_baron', 'steel_baron');
    END LOOP;
END;
$$;

-- These three RPCs also expose a renamed OUT column. PostgreSQL requires a
-- drop/recreate for this change. Preserve the owner and effective EXECUTE grants
-- (including hosted grants that differ from the current default privileges).
DO $$
DECLARE
    signature text;
    definition text;
    original_owner regrole;
    original_acl aclitem[];
    privilege record;
BEGIN
    FOREACH signature IN ARRAY ARRAY[
        'public.get_gains_leaderboard(timestamptz,integer)',
        'public.get_networth_leaderboard(integer)',
        'public.get_user_badge_stats(uuid)'
    ] LOOP
        SELECT pg_get_functiondef(oid), proowner, coalesce(proacl, acldefault('f', proowner))
        INTO STRICT definition, original_owner, original_acl
        FROM pg_proc WHERE oid = signature::regprocedure;

        EXECUTE format('DROP FUNCTION %s', signature);
        EXECUTE replace(replace(definition, 'banana_balance', 'tartan_coin_balance'),
            'banana_baron', 'steel_baron');
        EXECUTE format('ALTER FUNCTION %s OWNER TO %s', signature, original_owner);

        FOR privilege IN
            SELECT DISTINCT acl.grantee
            FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
            WHERE p.oid = signature::regprocedure
        LOOP
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s', signature,
                CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE privilege.grantee::regrole::text END);
        END LOOP;
        FOR privilege IN SELECT * FROM aclexplode(original_acl) LOOP
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s %s', signature,
                CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE privilege.grantee::regrole::text END,
                CASE WHEN privilege.is_grantable THEN 'WITH GRANT OPTION' ELSE '' END);
        END LOOP;
    END LOOP;
END;
$$;
