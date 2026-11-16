\ir governance_fixture.sql
SELECT place_bet('90000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','YES',20);
SELECT place_multichoice_bet('90000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000001',30);
SELECT admin_backroll_market('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000004',now()-interval '1 hour',false);
SELECT admin_backroll_market('91000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000004',now()-interval '1 hour',false);
SELECT pg_temp.check_true((admin_backroll_market('91000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000004',now()-interval '1 hour',false)->>'total_refunded')::numeric=0,'repeat refund is empty');
SELECT pg_temp.check_true((SELECT banana_balance=1000 FROM profiles WHERE id='90000000-0000-0000-0000-000000000002'),'refund restores wallet');
SELECT pg_temp.check_true((SELECT pool_total=0 FROM market_options WHERE id='92000000-0000-0000-0000-000000000001'),'option pool refunded');
SELECT pg_temp.check_true((SELECT bool_and(yes_pool_total=0 AND no_pool_total=0) FROM markets WHERE id::text LIKE '91000000-%'),'binary pools refunded, option refunds do not alter binary pools');
SELECT pg_temp.check_true((SELECT sum(amount)=0 AND count(*)=4 FROM transactions WHERE market_id::text LIKE '91000000-%'),'one debit and refund per bet');
SELECT pg_temp.check_true((SELECT count(*)=0 FROM bets WHERE market_id::text LIKE '91000000-%'),'refunded bets removed');
UPDATE markets SET status='pending_resolution',proposed_outcome='YES',dispute_deadline=now()+interval '1 day' WHERE id='91000000-0000-0000-0000-000000000001';
SELECT pg_temp.reject_sql($q$SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','Review')$q$,'placed bets cannot');
SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003','Review');
SELECT pg_temp.reject_sql(format('SELECT cast_dispute_vote(%L,%L,%L)',(SELECT id FROM disputes WHERE market_id='91000000-0000-0000-0000-000000000001'),'90000000-0000-0000-0000-000000000002','YES'),'placed bets cannot');
SELECT cast_dispute_vote(id,'90000000-0000-0000-0000-000000000005','YES') FROM disputes WHERE market_id='91000000-0000-0000-0000-000000000001';
ROLLBACK;
