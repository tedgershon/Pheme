-- psql -X -v ON_ERROR_STOP=1 -v user_id=<confirmed-auth-user-uuid> -f this-file
-- Run as the database operator, never through the public API.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('pheme.bootstrap_user_id', :'user_id', true);
DO $$
DECLARE
    target uuid := current_setting('pheme.bootstrap_user_id')::uuid;
BEGIN
    LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
    IF EXISTS (SELECT FROM public.profiles WHERE role = 'super_admin' AND id != target) THEN
        RAISE EXCEPTION 'A super-admin already exists; use the authorized role-management workflow';
    END IF;
    IF NOT EXISTS (
        SELECT FROM auth.users u JOIN public.profiles p ON p.id = u.id
        WHERE u.id = target AND u.email_confirmed_at IS NOT NULL
          AND lower(u.email) LIKE '%@andrew.cmu.edu'
    ) THEN
        RAISE EXCEPTION 'Target must be an existing confirmed CMU user with a profile';
    END IF;
    UPDATE public.profiles SET role = 'super_admin' WHERE id = target;
END;
$$;
SELECT id, andrew_id, role, is_admin FROM public.profiles
WHERE id = current_setting('pheme.bootstrap_user_id')::uuid;
COMMIT;
