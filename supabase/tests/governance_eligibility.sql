\ir governance_fixture.sql
SELECT pg_temp.reject_sql($q$SELECT place_multichoice_bet(
 '90000000-0000-0000-0000-000000000004','91000000-0000-0000-0000-000000000002',
 '92000000-0000-0000-0000-000000000001',10)$q$, 'creators cannot');
UPDATE profiles SET role='user' WHERE id='90000000-0000-0000-0000-000000000004';
SELECT pg_temp.reject_sql($q$SELECT place_multichoice_bet(
 '90000000-0000-0000-0000-000000000004','91000000-0000-0000-0000-000000000002',
 '92000000-0000-0000-0000-000000000001',10)$q$, 'creators cannot');
UPDATE markets SET close_at=now()-interval '1 second' WHERE id='91000000-0000-0000-0000-000000000002';
SELECT pg_temp.reject_sql($q$SELECT place_multichoice_bet(
 '90000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000002',
 '92000000-0000-0000-0000-000000000001',10)$q$, 'Market has closed');
SELECT pg_temp.check_true((SELECT pool_total=0 FROM market_options WHERE id='92000000-0000-0000-0000-000000000001'),'rejected bets leave pool unchanged');
SELECT pg_temp.check_true((SELECT count(*)=0 FROM transactions WHERE market_id='91000000-0000-0000-0000-000000000002'),'rejected bets leave ledger unchanged');
SELECT pg_temp.check_true((SELECT bool_and(banana_balance=1000) FROM profiles WHERE id::text LIKE '90000000-%'),'rejected bets leave wallets unchanged');
SELECT place_bet('90000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','YES',10);
UPDATE markets SET status='pending_resolution', proposed_outcome='YES', dispute_deadline=now()+interval '1 day'
WHERE id='91000000-0000-0000-0000-000000000001';
SELECT pg_temp.reject_sql($q$SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Review')$q$,'creator cannot');
UPDATE profiles SET role='admin' WHERE id='90000000-0000-0000-0000-000000000001';
SELECT pg_temp.reject_sql($q$SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Review')$q$,'creator cannot');
UPDATE markets SET dispute_deadline=NULL WHERE id='91000000-0000-0000-0000-000000000001';
SELECT pg_temp.reject_sql($q$SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003','Review')$q$,'proposal and dispute deadline');
UPDATE markets SET dispute_deadline=now()+interval '1 day', proposed_outcome=NULL WHERE id='91000000-0000-0000-0000-000000000001';
SELECT pg_temp.reject_sql($q$SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003','Review')$q$,'proposal and dispute deadline');
UPDATE markets SET proposed_outcome='YES' WHERE id='91000000-0000-0000-0000-000000000001';
SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','The proposed outcome conflicts with the published result.');
SELECT pg_temp.check_true((SELECT disputer_id='90000000-0000-0000-0000-000000000002' AND explanation='The proposed outcome conflicts with the published result.' FROM disputes WHERE market_id='91000000-0000-0000-0000-000000000001'),'bettor filing preserves submitter and explanation under market');
SELECT pg_temp.reject_sql(format('SELECT cast_dispute_vote(%L,%L,%L)',(SELECT id FROM disputes WHERE market_id='91000000-0000-0000-0000-000000000001'),'90000000-0000-0000-0000-000000000002','YES'),'placed bets cannot');
SELECT pg_temp.reject_sql($q$SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000005','Review')$q$,'pending_resolution');
ROLLBACK;
