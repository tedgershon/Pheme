\ir governance_fixture.sql
\set market 91000000-0000-0000-0000-000000000001
\set creator 90000000-0000-0000-0000-000000000001
\set bettor 90000000-0000-0000-0000-000000000002
\set submitter 90000000-0000-0000-0000-000000000003
\set admin 90000000-0000-0000-0000-000000000004
\set voter 90000000-0000-0000-0000-000000000005
\set outsider 90000000-0000-0000-0000-000000000006

-- A prior backroll also uses the payout ledger type. Only settlement credits
-- belong in the notification, even if both operations run in one transaction.
SELECT place_bet(:'bettor', :'market', 'YES', 55);
SELECT admin_backroll_market(:'market', :'admin', now()-interval '1 hour', false);
SELECT place_bet(:'bettor', :'market', 'YES', 20);
SELECT place_bet(:'bettor', :'market', 'YES', 10.25);
UPDATE markets SET status='pending_resolution', proposed_outcome='YES', dispute_deadline=now()+interval '1 day'
WHERE id=:'market';
SELECT file_dispute(:'market', :'submitter', 'Private concern');
SELECT cast_dispute_vote(id, :'voter', 'NO') FROM disputes WHERE market_id=:'market';
-- Simulate the coordinator after tallying a quorate dispute.
SELECT finalize_resolution(:'market', 'NO');
SELECT pg_temp.check_true((SELECT array_agg(user_id ORDER BY user_id) =
 ARRAY[:'creator', :'bettor', :'submitter', :'voter']::uuid[]
 AND bool_and(metadata = jsonb_build_object('market_id', :'market', 'outcome', 'NO'))
 FROM notifications WHERE market_id=:'market' AND type='market_resolved'),
 'dispute outcome goes to each participant, with no participant data in metadata');
SELECT pg_temp.check_true((SELECT count(*)=1 AND bool_and(user_id=:'bettor'
 AND metadata @> '{"outcome":"NO", "amount":30.25, "is_refund":true}')
 FROM notifications WHERE market_id=:'market' AND type='payout_received'),
 'no-winning-side refund aggregates the current stakes only');
SELECT pg_temp.check_true((SELECT tartan_coin_balance=1000 FROM profiles WHERE id=:'bettor'),
 'both refunds reach the wallet');
SELECT set_config('request.jwt.claim.sub', :'submitter', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true((SELECT array_agg(type)=ARRAY['market_resolved'] FROM notifications),
 'dispute submitter sees their own outcome without the bettor payout');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'outsider', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true(NOT EXISTS (SELECT FROM notifications), 'unrelated user cannot read settlement metadata');
RESET ROLE;
SELECT pg_temp.check_true(NOT has_function_privilege('authenticated',
 'private.create_market_notification(uuid,text,text,text,uuid,jsonb)', 'EXECUTE'),
 'API roles cannot invoke the settlement insert directly');
SELECT set_config('request.jwt.claim.sub', '', true);

-- Inject notification failure during a second market's payout. Settlement still commits
-- its status and wallet changes, and other recipients still receive their outcome.
\set second_market 91000000-0000-0000-0000-000000000003
INSERT INTO markets (id,title,description,creator_id,close_at,resolution_criteria,status)
VALUES (:'second_market','Delivery test','Fixture',:'creator',now()+interval '1 day','Fixture','open');
SELECT place_bet(:'bettor', :'second_market', 'YES', 25);
SELECT place_bet(:'submitter', :'second_market', 'NO', 75);
UPDATE markets SET status='pending_resolution', proposed_outcome='YES', dispute_deadline=now()-interval '1 second'
WHERE id=:'second_market';
ALTER TABLE notifications ADD CONSTRAINT injected_payout_delivery_failure
CHECK (market_id <> :'second_market' OR type <> 'payout_received') NOT VALID;
SELECT finalize_resolution(:'second_market', 'YES');
SELECT pg_temp.reject_sql(format('SELECT finalize_resolution(%L, %L)', :'second_market', 'YES'),
 'cannot be finalized');
SELECT pg_temp.check_true((SELECT status='resolved' FROM markets WHERE id=:'second_market'),
 'notification failure does not reverse market settlement');
SELECT pg_temp.check_true((SELECT tartan_coin_balance=1075 FROM profiles WHERE id=:'bettor'),
 'notification failure and settlement retry leave the full payout credited once');
SELECT pg_temp.check_true((SELECT count(*)=1 AND sum(amount)=100 FROM transactions
 WHERE market_id=:'second_market' AND transaction_type='payout'), 'one credit in ledger despite delivery failure');
SELECT pg_temp.check_true((SELECT array_agg(type ORDER BY type)=ARRAY['market_resolved','market_resolved','market_resolved']
 FROM notifications WHERE market_id=:'second_market'), 'delivery failure does not prevent outcome notices');
ALTER TABLE notifications DROP CONSTRAINT injected_payout_delivery_failure;

-- Each recorded tier is announced once. Failed award writes produce no notice.
UPDATE profiles SET tartan_coin_balance=5000 WHERE id=:'bettor';
SELECT pg_temp.check_true(jsonb_array_length(check_and_award_badges(:'bettor'))=1, 'first tier awarded');
SELECT pg_temp.check_true(check_and_award_badges(:'bettor')='[]'::jsonb, 'repeat reports no awards');
UPDATE profiles SET tartan_coin_balance=7500 WHERE id=:'bettor';
SELECT pg_temp.check_true(jsonb_array_length(check_and_award_badges(:'bettor'))=1, 'upgrade awarded');
SELECT pg_temp.check_true(check_and_award_badges(:'bettor')='[]'::jsonb, 'repeat after upgrade reports no awards');
SELECT pg_temp.check_true((SELECT array_agg(metadata->>'tier' ORDER BY metadata->>'tier')=ARRAY['1','2']
 AND bool_and(user_id=:'bettor' AND metadata->>'track'='steel_baron' AND body LIKE 'You earned %')
 FROM notifications WHERE type='badge_earned'), 'one private notification for each earned tier');

UPDATE profiles SET tartan_coin_balance=10000 WHERE id=:'bettor';
ALTER TABLE user_badges ADD CONSTRAINT injected_award_failure CHECK (tier <> 3) NOT VALID;
SELECT pg_temp.reject_sql(format('SELECT check_and_award_badges(%L)', :'bettor'), 'injected_award_failure');
SELECT pg_temp.check_true(NOT EXISTS (SELECT FROM notifications WHERE type='badge_earned' AND metadata->>'tier'='3'),
 'failed award generates no notification');
ALTER TABLE user_badges DROP CONSTRAINT injected_award_failure;
ALTER TABLE notifications ADD CONSTRAINT injected_badge_delivery_failure
CHECK (type <> 'badge_earned' OR metadata->>'tier' <> '3') NOT VALID;
SELECT pg_temp.check_true(jsonb_array_length(check_and_award_badges(:'bettor'))=1,
 'badge delivery failure preserves the tier award');
SELECT pg_temp.check_true((SELECT tier=3 FROM user_badges WHERE user_id=:'bettor' AND track='steel_baron'),
 'third tier remains recorded');
SELECT pg_temp.check_true(check_and_award_badges(:'bettor')='[]'::jsonb, 'failed delivery does not cause a repeat award');
ROLLBACK;
