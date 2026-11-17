-- Verify real SELECT policies for direct REST-equivalent reads and option joins.
BEGIN;
CREATE FUNCTION pg_temp.check_true(ok boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
    IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF;
END $$;
INSERT INTO auth.users (id, email)
SELECT ('93000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
       'privacy' || i || '@andrew.cmu.edu' FROM generate_series(1,4) i;
UPDATE profiles SET role = 'admin' WHERE id = '93000000-0000-0000-0000-000000000003';
UPDATE profiles SET role = 'super_admin' WHERE id = '93000000-0000-0000-0000-000000000004';
INSERT INTO markets (id,title,description,creator_id,close_at,resolution_criteria,status,market_type,multichoice_type)
SELECT ('94000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
       'Private proposal', 'Private description',
       ('93000000-0000-0000-0000-' || lpad(owner_id::text,12,'0'))::uuid,
       now()+interval '1 day', 'Private criteria', market_status, 'multichoice', 'exclusive'
FROM (VALUES (1,1,'pending_review'), (2,1,'denied'), (3,2,'pending_review'),
             (4,2,'denied'), (5,1,'open'), (6,3,'pending_review'),
             (7,4,'denied')) fixture(i,owner_id,market_status);
INSERT INTO market_options (market_id,label)
SELECT id, 'Private option' FROM markets WHERE id::text LIKE '94000000-%';

SET LOCAL ROLE anon;
SELECT pg_temp.check_true((SELECT count(*) = 1 FROM markets WHERE id::text LIKE '94000000-%'), 'anon only sees public market');
SELECT pg_temp.check_true((SELECT count(*) = 1 FROM market_options WHERE market_id::text LIKE '94000000-%'), 'anon cannot read private option labels');
SELECT pg_temp.check_true(NOT EXISTS(SELECT * FROM markets WHERE id = '94000000-0000-0000-0000-000000000001'), 'guessed private ID invisible');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000001', true);
SELECT pg_temp.check_true((SELECT count(*) = 3 FROM markets WHERE id::text LIKE '94000000-%'), 'creator sees own pending/denied and public');
SELECT pg_temp.check_true((SELECT count(*) = 3 FROM market_options WHERE market_id::text LIKE '94000000-%'), 'creator sees own options');
SELECT pg_temp.check_true(NOT EXISTS(SELECT * FROM markets WHERE id::text LIKE '94000000-%' AND creator_id = '93000000-0000-0000-0000-000000000002'), 'cross-user filter cannot bypass RLS');
SELECT set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000002', true);
SELECT pg_temp.check_true((SELECT count(*) = 3 FROM markets WHERE id::text LIKE '94000000-%'), 'second creator sees own proposals and public');
SELECT pg_temp.check_true(NOT EXISTS(SELECT * FROM markets WHERE id = '94000000-0000-0000-0000-000000000002'), 'other creator cannot read denied detail');
SELECT pg_temp.check_true((SELECT count(*) = 3 FROM market_options WHERE market_id::text LIKE '94000000-%'), 'second creator options scoped');

SELECT set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000003', true);
SELECT pg_temp.check_true((SELECT count(*) = 7 FROM markets WHERE id::text LIKE '94000000-%'), 'admin sees all proposals');
SELECT pg_temp.check_true((SELECT count(*) = 7 FROM market_options WHERE market_id::text LIKE '94000000-%'), 'admin sees all options');
SELECT pg_temp.check_true((SELECT count(*) = 1 FROM markets WHERE id::text LIKE '94000000-%' AND creator_id = auth.uid() AND status IN ('pending_review','denied')), 'admin portfolio remains own only');
SELECT set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.check_true((SELECT count(*) = 7 FROM markets WHERE id::text LIKE '94000000-%'), 'super admin sees all proposals');
SELECT pg_temp.check_true((SELECT count(*) = 7 FROM market_options WHERE market_id::text LIKE '94000000-%'), 'super admin sees all options');
SELECT pg_temp.check_true((SELECT count(*) = 1 FROM markets WHERE id::text LIKE '94000000-%' AND creator_id = auth.uid() AND status IN ('pending_review','denied')), 'super admin portfolio remains own only');
RESET ROLE;
ROLLBACK;
