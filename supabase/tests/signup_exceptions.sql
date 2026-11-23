-- All fixtures roll back; exercise the operator exception boundary using real roles.
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

SELECT pg_temp.reject($q$INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES ('81000000-0000-0000-0000-000000000001', 'outsider@example.com',
    '{"role":"super_admin","approved":true}')$q$, 'Only @andrew.cmu.edu');

SET LOCAL ROLE anon;
SELECT pg_temp.reject('SELECT * FROM private.signup_email_exceptions', 'permission denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject($q$INSERT INTO private.signup_email_exceptions (email)
    VALUES ('outsider@example.com')$q$, 'permission denied');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.reject($q$INSERT INTO private.signup_email_exceptions (email)
    VALUES ('outsider@example.com')$q$, 'permission denied');
RESET ROLE;

INSERT INTO private.signup_email_exceptions (email) VALUES ('operator@example.com');
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES ('81000000-0000-0000-0000-000000000002', 'Operator@example.com', now());
SELECT pg_temp.assert((SELECT role = 'user' AND NOT is_admin AND tartan_coin_balance = 1000
    FROM profiles WHERE id = '81000000-0000-0000-0000-000000000002'),
    'exception permits signup with ordinary role and a fresh wallet');
SELECT pg_temp.assert((SELECT count(*) = 1 AND sum(amount) = 1000
    FROM transactions WHERE user_id = '81000000-0000-0000-0000-000000000002'
    AND transaction_type = 'initial_grant'), 'one transactional initial grant');
SELECT pg_temp.reject($q$UPDATE auth.users SET email = 'unapproved@example.com'
    WHERE id = '81000000-0000-0000-0000-000000000002'$q$, 'Only @andrew.cmu.edu');
ROLLBACK;
