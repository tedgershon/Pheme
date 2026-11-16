# Hosted Supabase with local application servers

Pheme currently uses one hosted Supabase project for manual development, with
the option to prepare that same project for production later. Local Docker
Supabase remains the disposable migration/test target. No BananaGains database,
accounts, OAuth credentials or balances are reused.

The hosted project's name is a label, not an environment boundary. Before it
serves real users, remove controlled test data through a reviewed procedure and
configure production URLs, backups and release checks. After launch, run
destructive tests only locally or in a separate non-production environment.
A separate hosted staging project is optional; previews must not run test writes
against the live production database.

## Connect and migrate

Install the pinned CLI with `npm ci` and allow its binary installer as described
in [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md). From the repository root:

```powershell
npx --no-install supabase login
npx --no-install supabase projects list
npx --no-install supabase link --project-ref PROJECT_REF
npx --no-install supabase migration list --linked
npx --no-install supabase db push --linked --dry-run
```

Confirm the linked reference is the intended project, and inspect its public
schema before applying the baseline. For a fresh, empty application database:

```powershell
npx --no-install supabase db push --linked
npx --no-install supabase migration list --linked
```

The second command must show matching local/remote migration versions. These
commands were used for the initial hosted bootstrap on 2026-11-15. Never apply
the fresh baseline to an existing application schema; use the documented
[legacy adoption procedure](MIGRATIONS.md) where applicable. Do not use a hosted
reset to apply an upgrade.

## Configure Google and application URLs

Use an independent Google OAuth **Web application** client for Pheme. Select
the External audience and add intended test users while in Testing mode.
Use only the basic identity scopes (`openid`, `email`, `profile`).

| Setting | Development value |
| --- | --- |
| Google authorized JavaScript origin | `http://localhost:3000` |
| Google authorized redirect URI | `https://PROJECT_REF.supabase.co/auth/v1/callback` |
| Supabase Auth Site URL | `http://localhost:3000` |
| Supabase Auth additional redirect URL | `http://localhost:3000/auth/callback` |

In the hosted Supabase dashboard, open Authentication → Sign In / Providers →
Google, enter the new client ID/secret, enable Google, and save. Keep nonce checks
enabled. A saved credential does not imply the provider's enable switch is on.
The project's `/auth/v1/settings` response must report Google enabled.

Configure hosted Auth URLs in its dashboard. Local `supabase/config.toml` and
root `.env` configure Docker and do not automatically configure hosted Auth.
Do not push the complete local config into the hosted project. Store Google
secrets in Supabase's provider settings, never in frontend environment variables.

Verified/published Google branding is a later public-launch task in
[issue #44](https://github.com/tedgershon/Pheme/issues/44). Until then, Google may
display the Supabase authentication domain on the consent screen.

## Configure and run the local applications

With the CLI logged in and linked to the intended project:

```powershell
.venv/Scripts/python.exe scripts/configure_hosted_env.py --project-ref PROJECT_REF
```

This reads that project's API keys through the CLI without printing them. It
writes ignored `backend/.env` and `frontend/.env.local`, preserving unrelated
settings. Only the anon key reaches the frontend; the service-role key stays
in the backend. Session validation uses hosted Supabase Auth, so the backend
does not need a copied JWT signing secret. The helper changes app environment
files only; it does not change database data or hosted configuration.

Restart both application servers using the commands in
[LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md#environment-files-and-application-servers).
Use `http://localhost:3000/auth` for sign-in. Confirm the API's market reads reach
the hosted project and browser requests pass the configured localhost CORS check.

## Operator account and verification

Ordinary signup still requires an Andrew email. Before an external operator
account signs in, use `scripts/db/allow_signup_email.sql` against the **hosted**
database. After real Google sign-in confirms the intended identity, use
`scripts/db/bootstrap_super_admin.sql` against the same database with its UUID.
The scripts' `psql` invocations are documented in [MIGRATIONS.md](MIGRATIONS.md).
The Docker commands in the local guide affect only the Docker database.

The hosted operator run used the Supabase Management API to execute the same
bootstrap SQL transaction, substituting the verified UUID for the psql input and
checking the expected email again before promotion. No passwords, access tokens,
or user-specific approvals are committed. Signup approval and role promotion
are separate actions; the role script refuses to replace another super-admin.

Record real sign-in/callback success, confirmed profiles, one 1,000-banana initial
grant per new user, ordinary/admin role separation, and successful admin/user
management access. Read-only database checks corroborate browser results but
do not replace them. Detailed operator evidence belongs in the setup issue.
