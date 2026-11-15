-- Real PostgreSQL integration assertions; all fixtures roll back.
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
    IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', message; END IF;
END $$;
CREATE FUNCTION pg_temp.reject(statement text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%' || expected || '%' THEN RAISE; END IF;
        rejected := true;
    END;
    PERFORM pg_temp.assert(rejected, 'Expected rejection: ' || statement);
END $$;

SELECT pg_temp.reject($q$INSERT INTO auth.users (id, email) VALUES
    ('10000000-0000-0000-0000-000000000099', 'outsider@example.com')$q$, 'Only @andrew.cmu.edu');
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('10000000-0000-0000-0000-000000000001', 'creator@andrew.cmu.edu', now()),
    ('10000000-0000-0000-0000-000000000002', 'bettor@andrew.cmu.edu', now()),
    ('10000000-0000-0000-0000-000000000003', 'voter@andrew.cmu.edu', now()),
    ('10000000-0000-0000-0000-000000000004', 'operator@andrew.cmu.edu', now());
SELECT pg_temp.assert((SELECT count(*) = 4 FROM transactions WHERE transaction_type = 'initial_grant'
    AND user_id::text LIKE '10000000-%'), 'signup creates profiles and grant ledger');
SELECT pg_temp.assert((SELECT bool_and(role = 'user') FROM profiles WHERE id::text LIKE '10000000-%'),
    'no implicit privileged account');
UPDATE profiles SET role = 'admin' WHERE id = '10000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert((SELECT is_admin FROM profiles WHERE id = '10000000-0000-0000-0000-000000000004'),
    'role sync');

INSERT INTO markets (id, title, description, creator_id, close_at, resolution_criteria, status) VALUES
    ('20000000-0000-0000-0000-000000000001', 'Binary', 'Fixture',
    '10000000-0000-0000-0000-000000000001', now() + interval '1 day', 'Fixture', 'open');
SELECT place_bet('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'YES', 100);
SELECT place_bet('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'NO', 200);
SELECT pg_temp.reject($q$SELECT place_bet('10000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001', 'YES', 10000)$q$, 'Insufficient balance');
SELECT pg_temp.assert((SELECT banana_balance = 900 FROM profiles WHERE id = '10000000-0000-0000-0000-000000000002'),
    'failed bet does not debit');
SELECT pg_temp.assert((SELECT sum(amount) = -300 FROM transactions WHERE market_id = '20000000-0000-0000-0000-000000000001'),
    'bets have ledger entries');
UPDATE markets SET close_at = now() - interval '1 minute' WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT propose_resolution('20000000-0000-0000-0000-000000000001', 'YES', '10000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert((SELECT status = 'pending_resolution' AND dispute_deadline > now()
    AND resolution_window_end > now() FROM markets WHERE id = '20000000-0000-0000-0000-000000000001'),
    'expired-open proposal closes and creates dispute window');
-- Simulate the backend invoking settlement after the dispute window expires.
UPDATE markets SET dispute_deadline = now() - interval '1 second' WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT finalize_resolution('20000000-0000-0000-0000-000000000001', 'YES');
SELECT pg_temp.assert((SELECT banana_balance = 1200 FROM profiles WHERE id = '10000000-0000-0000-0000-000000000002'),
    'binary payout');
SELECT pg_temp.reject($q$SELECT finalize_resolution('20000000-0000-0000-0000-000000000001', 'YES')$q$,
    'cannot be finalized');

INSERT INTO markets (id, title, description, creator_id, close_at, resolution_criteria, status, market_type, multichoice_type) VALUES
    ('20000000-0000-0000-0000-000000000002', 'Options', 'Fixture',
    '10000000-0000-0000-0000-000000000001', now() + interval '1 day', 'Fixture', 'open', 'multichoice', 'exclusive');
INSERT INTO market_options (id, market_id, label) VALUES
    ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'A'),
    ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'B');
SELECT place_multichoice_bet('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001', 100);
SELECT place_multichoice_bet('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000002', 100);
UPDATE markets SET status = 'closed' WHERE id = '20000000-0000-0000-0000-000000000002';
SELECT cast_community_vote('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', 'YES');
UPDATE markets SET status = 'pending_resolution', resolution_window_end = now() - interval '1 second'
    WHERE id = '20000000-0000-0000-0000-000000000002';
SELECT resolve_multichoice_market('20000000-0000-0000-0000-000000000002', ARRAY['30000000-0000-0000-0000-000000000001']::uuid[]);
SELECT pg_temp.assert((SELECT banana_balance = 1300 FROM profiles WHERE id = '10000000-0000-0000-0000-000000000002'),
    'option bet and payout');
SELECT pg_temp.assert((SELECT sum(amount) = 0 FROM transactions WHERE market_id IN (
    '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002')), 'settlement conserves ledger');

SELECT claim_daily_bananas('10000000-0000-0000-0000-000000000002');
SELECT pg_temp.reject($q$SELECT claim_daily_bananas('10000000-0000-0000-0000-000000000002')$q$, 'Already claimed today');
SELECT pg_temp.assert((SELECT banana_balance = 2300 FROM profiles WHERE id = '10000000-0000-0000-0000-000000000002'),
    'claim and rejected repeat are atomic');
SELECT pg_temp.reject($q$INSERT INTO transactions (user_id, transaction_type, amount) VALUES
    ('10000000-0000-0000-0000-000000000002', 'daily_claim', 1)$q$, 'idx_unique_daily_claim');
-- Controlled balance fixture for the cap boundary, rolled back with this test.
UPDATE profiles SET banana_balance = 4500 WHERE id = '10000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert((claim_daily_bananas('10000000-0000-0000-0000-000000000004')->>'claimed_amount')::numeric = 500,
    'claim stops at the 5000 cap');
SELECT pg_temp.assert((check_claim_eligibility('10000000-0000-0000-0000-000000000004')->>'eligible')::boolean = false,
    'cap and claimed eligibility');
UPDATE profiles SET banana_balance = 5000 WHERE id = '10000000-0000-0000-0000-000000000003';
SELECT pg_temp.reject($q$SELECT claim_daily_bananas('10000000-0000-0000-0000-000000000003')$q$, 'daily claim cap');
INSERT INTO transactions (user_id, transaction_type, amount, created_at) VALUES
    ('10000000-0000-0000-0000-000000000001', 'daily_claim', 1, '2020-01-01 04:30:00+00'),
    ('10000000-0000-0000-0000-000000000001', 'daily_claim', 1, '2020-01-01 05:30:00+00');
SELECT pg_temp.reject($q$INSERT INTO transactions (user_id, transaction_type, amount, created_at) VALUES
    ('10000000-0000-0000-0000-000000000001', 'daily_claim', 1, '2020-01-02 04:30:00+00')$q$,
    'idx_unique_daily_claim');
SELECT pg_temp.assert((SELECT gain = 300 FROM get_networth_leaderboard(100)
    WHERE id = '10000000-0000-0000-0000-000000000002'), 'net worth subtracts grants and claims');
SELECT * FROM get_gains_leaderboard(NULL, 10);
SELECT * FROM get_user_badge_stats('10000000-0000-0000-0000-000000000002');
SELECT check_and_award_badges('10000000-0000-0000-0000-000000000002');
UPDATE profiles SET avatar_url = 'https://example.com/avatar.png', equipped_badges = '{"oracle": "fixture"}'
    WHERE id = '10000000-0000-0000-0000-000000000002';

SELECT create_market_notification('10000000-0000-0000-0000-000000000002', 'market_resolved', 'Resolved', 'Fixture',
    '20000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert(create_market_notification('10000000-0000-0000-0000-000000000002', 'market_resolved', 'Resolved', 'Fixture',
    '20000000-0000-0000-0000-000000000001') IS NULL, 'atomic notification deduplication');
INSERT INTO notifications (user_id, type, title, body) VALUES
    ('10000000-0000-0000-0000-000000000003', 'resolution_reminder', 'Reminder', 'Fixture');
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT notify_admins_market_submitted('20000000-0000-0000-0000-000000000001');
RESET ROLE;
SELECT pg_temp.assert((SELECT count(*) = 1 FROM notifications WHERE type = 'market_submitted'
    AND user_id = '10000000-0000-0000-0000-000000000004'), 'admin submission RPC');
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*) = 1 FROM notifications), 'owner-only notification reads');
SELECT pg_temp.reject($q$INSERT INTO notifications (user_id, type, title, body) VALUES
    ('10000000-0000-0000-0000-000000000002', 'system', 'Forged', 'Fixture')$q$, 'row-level security');
SELECT pg_temp.reject($q$UPDATE notifications SET title = 'Forged'$q$, 'permission denied');
UPDATE notifications SET is_read = true;
SELECT pg_temp.assert(get_unread_notification_count('10000000-0000-0000-0000-000000000002') = 0, 'mark read');
SELECT pg_temp.reject('UPDATE notifications SET is_read = false', 'row-level security');
DELETE FROM notifications;
SELECT pg_temp.assert((SELECT count(*) = 0 FROM notifications), 'delete own notifications');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
SELECT pg_temp.assert((SELECT count(*) = 0 FROM notifications), 'anonymous notifications hidden');
SELECT pg_temp.assert((SELECT count(*) = 25 FROM badge_definitions), 'public badge definitions');
WITH removed AS (DELETE FROM badge_definitions RETURNING id)
SELECT pg_temp.assert((SELECT count(*) = 0 FROM removed), 'anonymous badge mutations blocked by RLS');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE authenticated;
INSERT INTO storage.objects (bucket_id, name) VALUES
    ('avatars', '10000000-0000-0000-0000-000000000002/test.png');
SELECT pg_temp.reject($q$INSERT INTO storage.objects (bucket_id, name) VALUES
    ('avatars', '10000000-0000-0000-0000-000000000003/test.png')$q$, 'row-level security');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
SELECT pg_temp.assert((SELECT count(*) = 1 FROM storage.objects WHERE bucket_id = 'avatars'), 'public avatar reads');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert((SELECT count(*) = 2 FROM notifications WHERE user_id::text LIKE '10000000-%'), 'service role reads remaining notifications');
RESET ROLE;
ROLLBACK;
