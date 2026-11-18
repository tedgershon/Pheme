"""Exercise fresh bootstrap and legacy adoption on an isolated local Supabase.

Requires Docker, Python 3.12+, and `npm ci` at the repository root. Never reads
application .env files or accepts a remote database URL. The only reset target
is the harness-owned project `pheme-issue36` in `.migration-test/`.
"""

import re
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from governance_concurrency import verify as verify_governance_concurrency

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".migration-test"
CONTAINER = "supabase_db_pheme-issue36"
CLI = ROOT / "node_modules/supabase/bin/supabase"
if not CLI.exists():
    CLI = CLI.with_suffix(".exe")
MIGRATIONS = sorted((ROOT / "supabase/migrations").glob("*.sql"))
BASELINE, REPAIR = MIGRATIONS[:2]


def run(args, *, sql=None, fail=False):
    result = subprocess.run(
        [str(arg) for arg in args],
        input=sql,
        text=True,
        encoding="utf-8",
        capture_output=True,
        cwd=ROOT,
        check=False,
    )
    if fail:
        if result.returncode == 0:
            raise AssertionError("Expected command to fail")
        return result.stderr
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout.strip()


def cli(*args, fail=False):
    return run([CLI, *args, "--workdir", WORK], fail=fail)


def psql(sql, *, fail=False):
    return run(
        [
            "docker",
            "exec",
            "-i",
            CONTAINER,
            "psql",
            "-X",
            "-qAt",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
        ],
        sql=sql,
        fail=fail,
    )


def read_sql(path):
    """Expand psql relative includes so the same scripts work over docker stdin."""
    path = ROOT / path
    return re.sub(
        r"^\\ir (.+)$",
        lambda m: read_sql(path.parent / m[1]),
        path.read_text(encoding="utf-8"),
        flags=re.MULTILINE,
    )


def reset(files):
    folder = WORK / "supabase/migrations"
    folder.mkdir(parents=True, exist_ok=True)
    # Delete only SQL copies owned by this harness, never application migrations.
    for path in folder.glob("*.sql"):
        path.unlink()
    for path in files:
        shutil.copyfile(path, folder / path.name)
    cli("db", "reset", "--local")


def catalog():
    # Complete public schema dump includes repaired objects, grants and policies.
    dump = run(
        [
            "docker",
            "exec",
            CONTAINER,
            "pg_dump",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "--schema-only",
            "--schema=public",
            "--no-owner",
        ]
    )
    return "\n".join(
        line
        for line in dump.splitlines()
        if not line.startswith(("--", "\\restrict", "\\unrestrict"))
    )


def preserved_rows():
    return psql("""
        SELECT jsonb_build_object(
            'profiles', (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM profiles p),
            'markets', (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM markets m),
            'disputes', (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM disputes d),
            'bets', (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM bets b),
            'ledger', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t),
            'notifications', (SELECT jsonb_agg(to_jsonb(n) - 'market_id' ORDER BY id) FROM notifications n)
        );
    """)


def verify():
    verify_governance_concurrency(psql, read_sql)
    for test in sorted((ROOT / 'supabase/tests').glob('governance_*.sql')):
        if test.name != 'governance_fixture.sql':
            psql(read_sql(test))
    psql(read_sql("supabase/tests/application.sql"))
    psql(read_sql("supabase/tests/signup_exceptions.sql"))
    psql(read_sql("supabase/tests/market_privacy.sql"))
    # Check every literal app RPC exists in the database, including service calls.
    rpc_names = set()
    for path in (ROOT / "backend").rglob("*.py"):
        rpc_names.update(
            re.findall(r'\.rpc\(\s*[\'"]([^\'"]+)', path.read_text(encoding="utf-8"))
        )
    actual = set(
        psql(
            "SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace"
        ).splitlines()
    )
    assert rpc_names <= actual, f"Missing app RPCs: {rpc_names - actual}"
    versions = psql(
        "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version"
    ).splitlines()
    assert versions == [path.name[:14] for path in MIGRATIONS], versions
    # Concurrent sessions exercise the capped function and its unique-index backstop.
    user = "40000000-0000-0000-0000-000000000001"
    psql(
        f"INSERT INTO auth.users (id, email) VALUES ('{user}', 'race@andrew.cmu.edu');"
    )

    def claim(_):
        result = subprocess.run(
            [
                "docker",
                "exec",
                "-i",
                CONTAINER,
                "psql",
                "-X",
                "-qAt",
                "-U",
                "postgres",
                "-v",
                "ON_ERROR_STOP=1",
            ],
            input=f"SELECT claim_daily_bananas('{user}');",
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode:
            assert "Already claimed today" in result.stderr, result.stderr
        return result.returncode == 0

    with ThreadPoolExecutor(max_workers=6) as pool:
        assert sum(pool.map(claim, range(6))) == 1
    assert psql(f"SELECT banana_balance FROM profiles WHERE id = '{user}'") == "2000"
    assert (
        psql(
            f"SELECT count(*) FROM transactions WHERE user_id = '{user}' AND transaction_type = 'daily_claim'"
        )
        == "1"
    )
    print(
        "  app RPCs, ledger, RLS, notifications and concurrent claims passed",
        flush=True,
    )


def verify_operator_bootstrap():
    target = "80000000-0000-0000-0000-000000000001"
    other = "80000000-0000-0000-0000-000000000002"
    script = read_sql("scripts/db/bootstrap_super_admin.sql")
    psql(f"""INSERT INTO auth.users (id, email) VALUES
        ('{target}', 'bootstrap@andrew.cmu.edu'), ('{other}', 'bootstrapother@andrew.cmu.edu');""")
    error = psql(f"\\set user_id {target}\n" + script, fail=True)
    assert "existing confirmed CMU user" in error, error
    psql(
        f"UPDATE auth.users SET email_confirmed_at = now() WHERE id IN ('{target}', '{other}');"
    )
    psql(f"\\set user_id {target}\n" + script)
    psql(f"\\set user_id {target}\n" + script)
    assert (
        psql(
            f"SELECT role || ':' || is_admin::text FROM profiles WHERE id = '{target}'"
        )
        == "super_admin:true"
    )
    error = psql(f"\\set user_id {other}\n" + script, fail=True)
    assert "super-admin already exists" in error, error
    psql(f"""DELETE FROM transactions WHERE user_id IN ('{target}', '{other}');
        DELETE FROM auth.users WHERE id IN ('{target}', '{other}');""")
    # Exact operator approval permits non-CMU bootstrap, but never bypasses confirmation.
    allow = read_sql("scripts/db/allow_signup_email.sql")
    psql("\\set email externaloperator@example.com\n" + allow)
    psql("\\set email externaloperator@example.com\n" + allow)
    psql(
        f"INSERT INTO auth.users (id, email) VALUES ('{target}', 'externaloperator@example.com');"
    )
    error = psql(f"\\set user_id {target}\n" + script, fail=True)
    assert "existing confirmed" in error, error
    psql(f"UPDATE auth.users SET email_confirmed_at = now() WHERE id = '{target}';")
    psql(
        "DELETE FROM private.signup_email_exceptions WHERE email = 'externaloperator@example.com';"
    )
    error = psql(f"\\set user_id {target}\n" + script, fail=True)
    assert "operator-approved" in error, error
    psql("\\set email externaloperator@example.com\n" + allow)
    psql(f"\\set user_id {target}\n" + script)
    psql(f"\\set user_id {target}\n" + script)
    assert psql(f"SELECT role FROM profiles WHERE id = '{target}'") == "super_admin"
    psql(f"""DELETE FROM transactions WHERE user_id = '{target}';
        DELETE FROM auth.users WHERE id = '{target}';
        DELETE FROM private.signup_email_exceptions WHERE email = 'externaloperator@example.com';""")
    print("  explicit super-admin bootstrap and refusal checks passed", flush=True)


def main():
    if not CLI.exists():
        raise SystemExit("Run npm ci first (allow Supabase's binary-install script).")
    config = (ROOT / "supabase/config.toml").read_text(encoding="utf-8")
    config, replaced = re.subn(
        r"(?m)^project_id = .*$", 'project_id = "pheme-issue36"', config
    )
    assert replaced == 1, "Could not isolate the test project; refusing to start/reset"
    # Browser OAuth credentials must never be required by the disposable SQL tests.
    config = re.sub(
        r"(\[auth.external.google\]\s*\n)enabled = true",
        r"\1enabled = false",
        config,
    )
    config = re.sub(
        r"(?m)^(port|shadow_port|inspector_port) = (\d+)$",
        lambda m: f"{m[1]} = {int(m[2]) + 10000}",
        config,
    )
    (WORK / "supabase").mkdir(parents=True, exist_ok=True)
    (WORK / "supabase/config.toml").write_text(config, encoding="utf-8")
    cli(
        "start",
        "--exclude",
        "studio,postgres-meta,edge-runtime,logflare,vector,realtime,imgproxy",
    )
    print("Fresh bootstrap via supabase db reset", flush=True)
    reset(MIGRATIONS)
    fresh = catalog()
    verify()
    verify_operator_bootstrap()
    for patched in (False, True):
        print(f"Legacy upgrade (later patches already applied: {patched})", flush=True)
        reset([])
        psql(read_sql("backend/supabase/migrations/consolidated_all_migrations.sql"))
        psql(read_sql("supabase/tests/legacy_fixture.sql"))
        if patched:
            # Existing deployments may have any subset of the later fixes.
            psql("BEGIN;\n" + REPAIR.read_text(encoding="utf-8") + "\nCOMMIT;")
        before = preserved_rows()
        # Unsupported schemas must fail before recording any adopted version.
        psql("ALTER TABLE profiles ADD COLUMN unexpected_drift text;")
        error = psql(read_sql("scripts/db/adopt_legacy.sql"), fail=True)
        assert "Unsupported legacy schema" in error, error
        assert (
            psql("SELECT to_regclass('supabase_migrations.schema_migrations') IS NULL")
            == "t"
        )
        psql("ALTER TABLE profiles DROP COLUMN unexpected_drift;")
        psql(read_sql("scripts/db/adopt_legacy.sql"))
        psql(read_sql("scripts/db/adopt_legacy.sql"))  # safe retry
        for path in MIGRATIONS:
            shutil.copyfile(path, WORK / "supabase/migrations" / path.name)
        if not patched:
            psql("""INSERT INTO notifications (id, user_id, type, title, body, metadata)
                SELECT '70000000-0000-0000-0000-000000000001', user_id, type, title, body, metadata
                FROM notifications LIMIT 1;""")
            error = cli("migration", "up", "--local", fail=True)
            assert "idx_notifications_one_per_market_event" in error, error
            assert (
                psql("SELECT count(*) FROM supabase_migrations.schema_migrations")
                == "1"
            )
            assert (
                psql(
                    "SELECT attnotnull FROM pg_attribute WHERE attrelid = 'bets'::regclass AND attname = 'side'"
                )
                == "t"
            )
            psql(
                "DELETE FROM notifications WHERE id = '70000000-0000-0000-0000-000000000001';"
            )
        cli("migration", "up", "--local")
        assert before == preserved_rows(), "Upgrade changed existing application data"
        # Dispute explanations move into the submissions table unchanged.
        assert (
            psql(
                "SELECT count(*) || ':' || min(explanation) || ':' || min(submitter_id::text) "
                "FROM dispute_submissions WHERE dispute_id = '61000000-0000-0000-0000-000000000001'"
            )
            == "1:  Legacy concern.  :50000000-0000-0000-0000-000000000002"
        ), "Legacy dispute explanation was not preserved"
        assert fresh == catalog(), "Fresh and upgraded schemas differ"
        verify()
        cli("migration", "up", "--local")  # no pending versions, no replay
    print("All migration scenarios passed.", flush=True)


if __name__ == "__main__":
    main()
