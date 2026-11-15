-- psql -X -v ON_ERROR_STOP=1 -f scripts/db/adopt_legacy.sql
-- Only for an existing consolidated-equivalent database, with writers stopped.
-- A mismatch aborts without recording the baseline. Never bypass this with
-- `migration repair --status applied`; reconcile an unsupported schema first.
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('pheme-migration-adoption'));
\ir legacy_contract.sql
\ir legacy_expected.sql
DO $$
DECLARE differences text;
BEGIN
    SELECT string_agg(coalesce(e.key, a.key), ', ' ORDER BY coalesce(e.key, a.key))
    INTO differences
    FROM legacy_expected e FULL JOIN pg_temp.legacy_contract() a USING (key)
    WHERE e.value IS DISTINCT FROM a.value;
    IF differences IS NOT NULL THEN
        RAISE EXCEPTION 'Unsupported legacy schema; review these catalog differences: %', differences;
    END IF;
    IF to_regprocedure('public.get_unread_notification_count(uuid)') IS NULL THEN
        RAISE EXCEPTION 'Missing prerequisite get_unread_notification_count(uuid)';
    END IF;
    IF NOT EXISTS (SELECT FROM storage.buckets WHERE id = 'avatars' AND public
        AND file_size_limit = 5242880
        AND allowed_mime_types @> ARRAY['image/jpeg','image/png','image/gif','image/webp']) THEN
        RAISE EXCEPTION 'Missing or incompatible avatars bucket';
    END IF;
    IF (SELECT count(*) FROM public.badge_definitions) != 25 THEN
        RAISE EXCEPTION 'Expected the 25 baseline badge definitions; review custom data before adoption';
    END IF;
END;
$$;
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version text PRIMARY KEY,
    statements text[],
    name text
);
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('20261114000000', 'legacy_baseline', ARRAY['-- Adopted after catalog verification; no initial DDL replayed.'])
ON CONFLICT (version) DO NOTHING;
COMMIT;
