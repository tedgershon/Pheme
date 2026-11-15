-- Explicit operator-approved signup exceptions; no accounts or roles are seeded.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE private.signup_email_exceptions (
    email text PRIMARY KEY CHECK (email = lower(btrim(email)) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.signup_email_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.signup_email_exceptions FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_cmu_email_domain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.email IS NULL OR (
        lower(NEW.email) NOT LIKE '%@andrew.cmu.edu'
        AND NOT EXISTS (
            SELECT FROM private.signup_email_exceptions
            WHERE email = lower(NEW.email)
        )
    ) THEN
        RAISE EXCEPTION 'Only @andrew.cmu.edu emails or operator-approved accounts are allowed.';
    END IF;
    RETURN NEW;
END;
$$;

-- Apply the same restriction to email changes; metadata cannot grant an exception.
DROP TRIGGER enforce_cmu_email_domain ON auth.users;
CREATE TRIGGER enforce_cmu_email_domain
    BEFORE INSERT OR UPDATE OF email ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.enforce_cmu_email_domain();
