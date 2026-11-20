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

## Deploy to Vercel

The frontend and backend are separate Vercel projects importing the same
repository. Before launch both use this hosted Pheme project; after it becomes
production, Preview must point at a non-production project instead.

| Project | Root Directory | Environment variables (Production and Preview) |
| --- | --- | --- |
| Backend | `backend` | `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `CORS_ORIGINS`, `CORS_ORIGIN_REGEX` |
| Frontend | `frontend` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN` (optionally `SENTRY_ORG`, `SENTRY_PROJECT`) |

- [backend/vercel.json](../backend/vercel.json) routes every path to `main.py`.
  The service-role key belongs to the backend project only.
- Add variables by hand rather than through the Supabase marketplace
  integration, which copies the service-role key and database URLs into every
  project it links.
- Use a non-production `SENTRY_ENVIRONMENT` such as `staging` until launch,
  and the same value for the frontend's `NEXT_PUBLIC_SENTRY_ENVIRONMENT` and
  `SENTRY_ENVIRONMENT`. Never use `development` on a deployment: it mounts
  `/api/__sentry-test`.
- The backend and frontend use separate Sentry projects and DSNs. The frontend
  `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` hold the same frontend DSN.
  `SENTRY_AUTH_TOKEN` is an organization token used only at build time to
  upload source maps; never give it a `NEXT_PUBLIC_` name. Set
  `SENTRY_ORG`/`SENTRY_PROJECT` when the Sentry slugs differ from the defaults
  in [next.config.ts](../frontend/next.config.ts).
- Leave `SENTRY_RELEASE` unset: the backend's `resolve_release` and the
  frontend's Sentry build plugin both use Vercel's `VERCEL_GIT_COMMIT_SHA`.
  This requires the project setting that exposes system environment variables
  (on by default).
- `NEXT_PUBLIC_*` values are fixed at build time; redeploy after changing them.
- Point `NEXT_PUBLIC_API_URL` at the backend's production domain. Vercel's
  default Deployment Protection covers preview URLs, so a protected backend
  preview would answer browser requests with a login page.
- Set backend `CORS_ORIGINS` to a JSON array containing the frontend's
  production domain (and `http://localhost:3000` if local servers share the
  backend). Set `CORS_ORIGIN_REGEX` to
  `https://<frontend-project>-[a-z0-9-]+-<team-slug>\.vercel\.app`, which matches
  both `<project>-<hash>-<team>` and `<project>-git-<branch>-<team>` preview
  URLs. The pattern must match the whole origin and credentials are allowed,
  so never widen it to all of `vercel.app`. Redeploy the backend afterwards.
- In Supabase Auth → URL Configuration, add the redirect URLs
  `https://<frontend-domain>/auth/callback` and
  `https://*-<team-slug>.vercel.app/**`. The Google client is unchanged because
  its redirect URI is the Supabase callback.

Check `GET /` on the backend returns `{"status": "ok", ...}`. On the deployed
frontend, confirm Google sign-in returns to the Vercel site and survives a
reload, markets load without CORS errors in the browser console, and avatar
upload and removal work. Repeat sign-in once on a preview deployment.

### Verify Sentry

Run this after changing Sentry settings or the error-reporting code. It uses
real failures and needs no fault-injection route. Record each event link.

1. **Tagged handled error.** While the daily claim is available, open
   `/portfolio` in two tabs and claim in both. The second shows "Already
   claimed today." Its backend event has `error_code` `CLAIM_ALREADY_TODAY`,
   `user.id` equal to your profile UUID, `extra.request_id`, the staging
   environment and the deployed commit as its release.
2. **Unhandled error and correlation.** Open
   `/markets/not-a-uuid`. A malformed ID fails Postgres UUID parsing in
   `GET /api/markets/{id}` and returns a real 500. In the browser's network
   panel, note the response's `x-request-id`. Expect a backend event tagged
   `INTERNAL_ERROR` with that `extra.request_id`, and a browser `ApiError`
   event in the frontend project tagged with the same `request_id` and
   `http_status` `500`. The server prefetch for the same page may add a
   server-side frontend event with its own request ID. If malformed IDs later
   return 404, use another real unhandled failure for this step.
3. **Readable stack and source maps.** The browser event's stack shows
   original source such as `src/lib/api.ts`, not minified chunks. The release
   under Settings → Source Maps lists an uploaded artifact bundle.
4. **Privacy.** In both events, the `authorization` and `cookie` headers show
   `[Filtered]`; frames have no local variables; no `andrew_id`, email,
   display name or token value appears in tags, extras, request data or
   breadcrumbs. The user context contains only the UUID.
5. **Alerts.** Alert rules that notify people filter on
   `environment:production`, so staging and preview events do not page anyone.
6. **Disabled locally.** With `SENTRY_DSN` unset, the backend logs
   `Sentry DSN not set; skipping Sentry init` and requests behave normally.

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
