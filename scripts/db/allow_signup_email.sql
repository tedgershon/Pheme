-- Operator only: psql -X -v ON_ERROR_STOP=1 -v email=person@example.com -f this-file
-- Permits signup only. Confirmation and a separate role assignment are still required.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO private.signup_email_exceptions (email)
VALUES (lower(btrim(:'email')))
ON CONFLICT (email) DO NOTHING;
SELECT email, created_at FROM private.signup_email_exceptions
WHERE email = lower(btrim(:'email'));
COMMIT;
