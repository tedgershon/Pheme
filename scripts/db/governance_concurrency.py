"""Concurrent direct RPC regression cases on the migration harness database."""

from concurrent.futures import ThreadPoolExecutor


def verify(psql, read_sql):
    # The caller owns the fixed disposable database; these rows never reach hosted DBs.
    psql(read_sql('supabase/tests/governance_fixture.sql').replace('BEGIN;', '', 1))
    market = '91000000-0000-0000-0000-000000000001'
    option_market = '91000000-0000-0000-0000-000000000002'
    bettor = '90000000-0000-0000-0000-000000000002'
    admin = '90000000-0000-0000-0000-000000000004'
    psql(f"""
        SELECT place_bet('{bettor}','{market}','YES',100);
        SELECT place_multichoice_bet('{bettor}','{option_market}','92000000-0000-0000-0000-000000000001',30);
        UPDATE markets SET status='pending_resolution', resolution_window_end=now()-interval '1 hour' WHERE id='{market}';
        INSERT INTO community_votes (market_id,voter_id,selected_outcome)
        SELECT '{market}',id,'YES' FROM profiles WHERE id::text IN (
          '{bettor}','90000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000005');
    """)
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda _: psql(f"SET statement_timeout='15s'; SELECT finalize_resolution('{market}','YES');"), range(6)))
        list(pool.map(lambda _: psql(f"SET statement_timeout='15s'; SELECT admin_backroll_market('{option_market}','{admin}',now()-interval '1 hour',false);"), range(6)))
    assert psql(f"SELECT count(*) FROM transactions WHERE market_id='{market}' AND transaction_type='payout'") == '1'
    assert psql(f"SELECT count(*) FROM transactions WHERE market_id='{market}' AND transaction_type='resolution_vote_reward'") == '3'
    assert psql(f"SELECT count(*) FROM transactions WHERE market_id='{option_market}' AND transaction_type='payout'") == '1'
    assert psql(f"SELECT banana_balance=1001.33 FROM profiles WHERE id='{bettor}'") == 't'
    assert psql(f"SELECT sum(amount)=0 FROM transactions WHERE market_id='{option_market}'") == 't'
    assert psql(f"SELECT pool_total=0 FROM market_options WHERE market_id='{option_market}'") == 't'
    # Concurrent admin submissions: exactly one AMBIGUOUS settlement and one refund per bettor.
    review_market = '91000000-0000-0000-0000-000000000003'
    psql(f"""
        INSERT INTO markets (id,title,description,creator_id,close_at,resolution_criteria,status)
        VALUES ('{review_market}','Review','Fixture','90000000-0000-0000-0000-000000000001',
                now()+interval '1 day','Fixture','open');
        SELECT place_bet('{bettor}','{review_market}','YES',40);
        SELECT place_bet('90000000-0000-0000-0000-000000000003','{review_market}','NO',60);
        UPDATE markets SET status='admin_review' WHERE id='{review_market}';
    """)

    def admin_resolve(_):
        try:
            psql(f"SET statement_timeout='15s'; SELECT admin_resolve_market('{review_market}','AMBIGUOUS','{admin}');")
            return True
        except RuntimeError as error:
            assert 'already resolved' in str(error), error
            return False

    with ThreadPoolExecutor(max_workers=6) as pool:
        assert sum(pool.map(admin_resolve, range(6))) == 1
    assert psql(f"SELECT count(*) FROM transactions WHERE market_id='{review_market}' AND transaction_type='refund'") == '2'
    assert psql(f"SELECT sum(amount)=0 FROM transactions WHERE market_id='{review_market}'") == 't'
    assert psql(f"SELECT resolved_outcome FROM markets WHERE id='{review_market}'") == 'AMBIGUOUS'
    psql("""
        DELETE FROM private.community_settlements WHERE market_id::text LIKE '91000000-%';
        DELETE FROM community_votes WHERE market_id::text LIKE '91000000-%';
        DELETE FROM bets WHERE market_id::text LIKE '91000000-%';
        DELETE FROM market_options WHERE market_id::text LIKE '91000000-%';
        DELETE FROM transactions WHERE user_id::text LIKE '90000000-%';
        DELETE FROM markets WHERE id::text LIKE '91000000-%';
        DELETE FROM auth.users WHERE id::text LIKE '90000000-%';
    """)
