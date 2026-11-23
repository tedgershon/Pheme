\ir governance_fixture.sql
SELECT place_bet('90000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','YES',100);
SELECT place_bet('90000000-0000-0000-0000-000000000003','91000000-0000-0000-0000-000000000001','NO',100);
UPDATE markets SET status='pending_resolution',resolution_window_end=now()-interval '1 hour' WHERE id='91000000-0000-0000-0000-000000000001';
INSERT INTO community_votes (market_id,voter_id,selected_outcome) VALUES
 ('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','YES'),
 ('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003','YES'),
 ('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000005','NO');
SELECT pg_temp.reject_sql($q$SELECT finalize_resolution('91000000-0000-0000-0000-000000000001','NO')$q$,'majority');
CREATE FUNCTION pg_temp.fail_reward() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.transaction_type='resolution_vote_reward' THEN RAISE EXCEPTION 'Injected reward failure'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER injected_reward_failure BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_reward();
SELECT pg_temp.reject_sql($q$SELECT finalize_resolution('91000000-0000-0000-0000-000000000001','YES')$q$,'Injected reward failure');
SELECT pg_temp.check_true((SELECT status='pending_resolution' AND yes_pool_total=100 AND no_pool_total=100 FROM markets WHERE id='91000000-0000-0000-0000-000000000001'),'failure restores state and pools');
SELECT pg_temp.check_true((SELECT tartan_coin_balance=900 FROM profiles WHERE id='90000000-0000-0000-0000-000000000002'),'failure rolls payout back');
SELECT pg_temp.check_true((SELECT count(*)=2 AND sum(amount)=-200 FROM transactions WHERE market_id='91000000-0000-0000-0000-000000000001'),'failure rolls ledger back');
SELECT pg_temp.check_true((SELECT count(*)=0 FROM private.community_settlements WHERE market_id='91000000-0000-0000-0000-000000000001'),'failure removes receipt');
DROP TRIGGER injected_reward_failure ON transactions;
SELECT finalize_resolution('91000000-0000-0000-0000-000000000001','YES');
SELECT finalize_resolution('91000000-0000-0000-0000-000000000001','YES');
SELECT distribute_voter_rewards('91000000-0000-0000-0000-000000000001','YES');
SELECT pg_temp.reject_sql($q$SELECT distribute_voter_rewards('91000000-0000-0000-0000-000000000001','YES',1)$q$,'percentage');
SELECT pg_temp.check_true((SELECT tartan_coin_balance=1104 FROM profiles WHERE id='90000000-0000-0000-0000-000000000002'),'payout and 4 percent reward paid once');
SELECT pg_temp.check_true((SELECT tartan_coin_balance=904 FROM profiles WHERE id='90000000-0000-0000-0000-000000000003'),'winning voter reward independent of bet side');
SELECT pg_temp.check_true((SELECT count(*)=5 AND sum(amount)=8 FROM transactions WHERE market_id='91000000-0000-0000-0000-000000000001'),'exactly one payout and two rewards');
ROLLBACK;
