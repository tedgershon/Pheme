-- Catalog contract for the frozen consolidated baseline. Used only by adoption
-- and its regression tests. Differences repaired by the next migration are
-- deliberately excluded. Everything else must match before recording a version.
SET search_path = public, extensions;
CREATE OR REPLACE FUNCTION pg_temp.legacy_contract()
RETURNS TABLE (key text, value text) LANGUAGE sql AS $contract$
WITH app_tables AS (
    SELECT c.oid, c.relname, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
), entries AS (
    SELECT 'table:' || relname AS key, relrowsecurity::text AS value FROM app_tables
    UNION ALL
    SELECT 'column:' || t.relname || '.' || a.attname,
        concat_ws('|', format_type(a.atttypid, a.atttypmod),
            CASE WHEN t.relname = 'bets' AND a.attname = 'side' THEN false ELSE a.attnotnull END,
            pg_get_expr(d.adbin, d.adrelid), a.attgenerated)
    FROM app_tables t JOIN pg_attribute a ON a.attrelid = t.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = t.oid AND d.adnum = a.attnum
    WHERE a.attnum > 0 AND NOT a.attisdropped
      AND NOT (t.relname = 'notifications' AND a.attname = 'market_id')
    UNION ALL
    SELECT 'constraint:' || t.relname || '.' || c.conname, pg_get_constraintdef(c.oid)
    FROM app_tables t JOIN pg_constraint c ON c.conrelid = t.oid
    WHERE c.conname != 'notifications_type_check'
    UNION ALL
    SELECT 'index:' || t.relname || '.' || c.relname, pg_get_indexdef(i.indexrelid)
    FROM app_tables t JOIN pg_index i ON i.indrelid = t.oid
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname != 'idx_notifications_one_per_market_event'
    UNION ALL
    SELECT 'policy:' || schemaname || '.' || tablename || '.' || policyname,
        replace(replace(concat_ws('|', permissive, roles::text, cmd, qual, with_check), chr(13), ''), chr(10), ' ')
    FROM pg_policies
    WHERE (schemaname = 'public' OR (schemaname = 'storage' AND policyname IN (
        'Users can upload own avatar', 'Users can update own avatar', 'Avatars are publicly accessible')))
      AND NOT (tablename = 'notifications' AND policyname IN (
        'System can insert notifications', 'Users can update own notifications',
        'Users can mark own notifications read', 'Users can delete own notifications'))
    UNION ALL
    SELECT 'trigger:' || n.nspname || '.' || c.relname || '.' || t.tgname,
        pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND (n.nspname = 'public' OR (n.nspname = 'auth'
        AND t.tgname IN ('on_auth_user_created', 'enforce_cmu_email_domain')))
    UNION ALL
    SELECT 'function:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        md5(replace(pg_get_functiondef(p.oid), chr(13), ''))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND NOT EXISTS (SELECT FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
      AND p.proname NOT IN ('propose_resolution', 'get_networth_leaderboard',
          'get_unread_notification_count', 'create_market_notification', 'notify_admins_market_submitted')
)
SELECT key, value FROM entries ORDER BY key;
$contract$;
