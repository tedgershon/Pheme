\ir governance_fixture.sql
-- Users: 1 creates binary market 1; 4 (admin) creates option market 2; 6 is promoted to admin.
UPDATE profiles SET role = 'admin' WHERE id = '90000000-0000-0000-0000-000000000006';
INSERT INTO markets (id,title,description,creator_id,close_at,resolution_criteria,status)
VALUES ('91000000-0000-0000-0000-000000000003','Payout','Fixture',
 '90000000-0000-0000-0000-000000000001',now()+interval '1 day','Fixture','open');

SELECT place_bet('90000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','YES',100);
SELECT place_bet('90000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','NO',25);
SELECT place_bet('90000000-0000-0000-0000-000000000003','91000000-0000-0000-0000-000000000001','NO',50);
SELECT place_bet('90000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000003','YES',100);
SELECT place_bet('90000000-0000-0000-0000-000000000003','91000000-0000-0000-0000-000000000003','NO',100);
SELECT place_multichoice_bet('90000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000001',30);

-- Wrong state: an open market cannot be adjudicated.
SELECT pg_temp.reject_sql($q$SELECT admin_resolve_market('91000000-0000-0000-0000-000000000003','YES','90000000-0000-0000-0000-000000000004')$q$,'not in admin_review');

INSERT INTO disputes (market_id,disputer_id,explanation,voting_deadline)
VALUES ('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000005','Evidence',now()-interval '1 hour');
UPDATE markets SET status = 'admin_review' WHERE id::text LIKE '91000000-%';

-- Authorization, input and bypass checks leave every wallet untouched.
SELECT pg_temp.reject_sql($q$SELECT admin_resolve_market('91000000-0000-0000-0000-000000000001','AMBIGUOUS','90000000-0000-0000-0000-000000000002')$q$,'Only admins');
SELECT pg_temp.reject_sql($q$SELECT admin_resolve_market('91000000-0000-0000-0000-000000000001','MAYBE','90000000-0000-0000-0000-000000000004')$q$,'Invalid outcome');
SELECT pg_temp.reject_sql($q$SELECT admin_resolve_market('00000000-0000-0000-0000-00000000dead','YES','90000000-0000-0000-0000-000000000004')$q$,'Market not found');
SELECT pg_temp.reject_sql($q$SELECT finalize_resolution('91000000-0000-0000-0000-000000000001','YES')$q$,'require admin resolution');
SELECT pg_temp.check_true(NOT has_function_privilege('anon','public.admin_resolve_market(uuid,text,uuid)','EXECUTE'),'anon cannot call admin resolution');
SELECT pg_temp.check_true(has_function_privilege('authenticated','public.admin_resolve_market(uuid,text,uuid)','EXECUTE'),'signed-in API calls remain possible');
SELECT pg_temp.check_true(NOT has_function_privilege('authenticated','private.settle_binary_market(uuid,text)','EXECUTE'),'settlement body is private');
-- A signed-in caller cannot act as a different admin.
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000005"}',true);
SELECT pg_temp.reject_sql($q$SELECT admin_resolve_market('91000000-0000-0000-0000-000000000001','AMBIGUOUS','90000000-0000-0000-0000-000000000004')$q$,'Only admins');
-- Creators cannot adjudicate their own escalated market, even as admins.
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000004"}',true);
SELECT pg_temp.reject_sql($q$SELECT admin_resolve_market('91000000-0000-0000-0000-000000000002','AMBIGUOUS','90000000-0000-0000-0000-000000000004')$q$,'creators cannot resolve');
SELECT pg_temp.check_true((SELECT count(*)=6 AND sum(amount)=-405 FROM transactions WHERE market_id::text LIKE '91000000-%'),'rejections leave ledger unchanged');

-- AMBIGUOUS refunds each bettor's total once, with the matching admin JWT.
SELECT admin_resolve_market('91000000-0000-0000-0000-000000000001','AMBIGUOUS','90000000-0000-0000-0000-000000000004');
SELECT pg_temp.check_true((SELECT status='resolved' AND resolved_outcome='AMBIGUOUS' AND resolved_at IS NOT NULL
 AND yes_pool_total=100 AND no_pool_total=75 FROM markets WHERE id='91000000-0000-0000-0000-000000000001'),'ambiguous outcome stored; pools kept as history');
SELECT pg_temp.check_true((SELECT resolved_by_admin FROM disputes WHERE market_id='91000000-0000-0000-0000-000000000001'),'dispute marked admin-resolved');
SELECT pg_temp.check_true((SELECT count(*)=2 AND sum(amount)=175 FROM transactions WHERE market_id='91000000-0000-0000-0000-000000000001' AND transaction_type='refund'),'one refund entry per bettor');
SELECT pg_temp.check_true((SELECT sum(amount)=0 FROM transactions WHERE market_id='91000000-0000-0000-0000-000000000001'),'market ledger nets to zero');
SELECT pg_temp.check_true((SELECT tartan_coin_balance=900 FROM profiles WHERE id='90000000-0000-0000-0000-000000000003'),'NO bettor refunded; market 3 stake still open');

-- Replays and outcome changes are rejected; nothing is credited twice.
SELECT set_config('request.jwt.claims','',true);
SELECT pg_temp.reject_sql($q$SELECT admin_resolve_market('91000000-0000-0000-0000-000000000001','AMBIGUOUS','90000000-0000-0000-0000-000000000004')$q$,'already resolved');
SELECT pg_temp.reject_sql($q$SELECT admin_resolve_market('91000000-0000-0000-0000-000000000001','YES','90000000-0000-0000-0000-000000000004')$q$,'already resolved');
SELECT pg_temp.reject_sql($q$SELECT finalize_resolution('91000000-0000-0000-0000-000000000001','YES')$q$,'cannot be finalized');
SELECT pg_temp.check_true((SELECT count(*)=5 FROM transactions WHERE market_id='91000000-0000-0000-0000-000000000001'),'replays add no ledger rows');

-- Option markets: YES/NO is refused (#32); AMBIGUOUS refunds option stakes.
SELECT pg_temp.reject_sql($q$SELECT admin_resolve_market('91000000-0000-0000-0000-000000000002','YES','90000000-0000-0000-0000-000000000006')$q$,'requires a binary market');
SELECT admin_resolve_market('91000000-0000-0000-0000-000000000002','AMBIGUOUS','90000000-0000-0000-0000-000000000006');
SELECT pg_temp.check_true((SELECT sum(amount)=0 AND count(*) FILTER (WHERE transaction_type='refund')=1 FROM transactions WHERE market_id='91000000-0000-0000-0000-000000000002'),'option stake refunded once');
SELECT pg_temp.check_true((SELECT pool_total=30 FROM market_options WHERE id='92000000-0000-0000-0000-000000000001'),'option pool kept as history');

-- YES pays winners through the unchanged binary settlement.
SELECT admin_resolve_market('91000000-0000-0000-0000-000000000003','YES','90000000-0000-0000-0000-000000000006');
SELECT pg_temp.check_true((SELECT status='resolved' AND resolved_outcome='YES' FROM markets WHERE id='91000000-0000-0000-0000-000000000003'),'YES outcome stored');
SELECT pg_temp.check_true((SELECT count(*)=1 AND sum(amount)=200 FROM transactions WHERE market_id='91000000-0000-0000-0000-000000000003' AND transaction_type='payout'),'winner paid full pool once');
SELECT pg_temp.check_true((SELECT tartan_coin_balance=1100 FROM profiles WHERE id='90000000-0000-0000-0000-000000000002'),'bettor wallet: 1000-125-100-30+125+30+200');
SELECT pg_temp.check_true((SELECT tartan_coin_balance=900 FROM profiles WHERE id='90000000-0000-0000-0000-000000000003'),'losing bettor not paid');
SELECT pg_temp.check_true(current_setting('pheme.admin_resolution',true)='','admin marker cleared after settlement');
SELECT pg_temp.reject_sql($q$SELECT admin_resolve_market('91000000-0000-0000-0000-000000000003','NO','90000000-0000-0000-0000-000000000006')$q$,'already resolved');
ROLLBACK;
