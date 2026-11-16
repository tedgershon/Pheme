BEGIN;
CREATE FUNCTION pg_temp.check_true(ok boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
    IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF;
END $$;
CREATE FUNCTION pg_temp.reject_sql(statement text, expected text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected IN SQLERRM) = 0 THEN RAISE; END IF;
        RETURN;
    END;
    RAISE EXCEPTION 'Expected rejection: %', statement;
END $$;
INSERT INTO auth.users (id, email)
SELECT ('90000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
       'governance' || i || '@andrew.cmu.edu' FROM generate_series(1,6) i;
UPDATE profiles SET role = 'admin' WHERE id = '90000000-0000-0000-0000-000000000004';
INSERT INTO markets (id,title,description,creator_id,close_at,resolution_criteria,status)
VALUES ('91000000-0000-0000-0000-000000000001','Governance','Fixture',
 '90000000-0000-0000-0000-000000000001',now()+interval '1 day','Fixture','open');
INSERT INTO markets (id,title,description,creator_id,close_at,resolution_criteria,status,market_type,multichoice_type)
VALUES ('91000000-0000-0000-0000-000000000002','Options','Fixture',
 '90000000-0000-0000-0000-000000000004',now()+interval '1 day','Fixture','open','multichoice','exclusive');
INSERT INTO market_options (id,market_id,label) VALUES
 ('92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002','A');
