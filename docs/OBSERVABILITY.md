# Observability and error handling

## Backend

[observability.py](../backend/observability.py) centralizes logging, Sentry
initialization, request/user context, `ErrorCode` and `AppError`. Routers use
these helpers rather than importing the Sentry SDK directly.

`RequestContextMiddleware` reads or generates an `x-request-id`, returns it
on the response and clears request/user context after the request. A
caller-supplied ID is kept only when it is 1 to 128 characters of letters,
digits, `.`, `_` or `-`; otherwise a new one is generated. CORS exposes the
header so the browser can read it. Authentication attaches the profile UUID
with `set_user_context`.
Production logging uses JSON; development logs include readable context.

`AppError(status_code, code, message, original=..., extras=...)` produces:

```json
{"detail": {"code": "MARKET_NOT_FOUND", "message": "Market not found."}}
```

When `original` is supplied, it captures the exception with an `error_code`
tag, request ID and diagnostic extras. Without `original`, a 4xx `AppError`
emits no event; a 5xx one is captured by the SDK's FastAPI integration, and
`before_send` adds its `error_code` tag. `before_send` drops the integration's
second capture of a 5xx `AppError` that already reported its `original`, so
each failure produces one tagged event. Keep diagnostic data out of the HTTP
message.

In practice, events carry the database-mapped codes raised in RPC `except`
blocks (betting, claims, resolution, disputes, admin review and resolution)
and `INTERNAL_ERROR`. Ordinary guard and validation errors, such as
`MARKET_NOT_FOUND` from a missing row, do not emit events.

FastAPI request validation returns 422 with `VALIDATION_FAILED` and an
`errors` list of `field`, `message` and `type`. Field paths include the
location prefix, such as `body.title` or `body.options.0.label`.
Rejected inputs and Pydantic exception context are omitted. Unexpected
exceptions are reported by `RequestContextMiddleware`, while request and user
context are still set, with an `INTERNAL_ERROR` tag; it returns the generic
500 `INTERNAL_ERROR` envelope inside CORS so the browser can read it and its
request ID. The global `Exception` handler in `main.py` remains a fallback for
failures outside that middleware.

Every router and shared authentication use the envelope; no router raises a
plain `HTTPException`. Portfolio and leaderboard need no local error wrapper:
unexpected failures use the safe 500 path above. Framework errors such as an
unmatched route or unsupported HTTP method retain FastAPI's default format.

Missing or rejected credentials return 401 `UNAUTHORIZED`; a missing profile
returns 400 `AUTH_PROFILE_INCOMPLETE`. Profile field/action validation uses
400 `VALIDATION_FAILED`. Missing and non-owned notification mutations both
return 404 `NOTIFICATION_NOT_FOUND`; owner success remains 200 with
`{"status":"ok"}`. Expired community voting returns 409
`RESOLUTION_WINDOW_EXPIRED`. Betting and claim RPC errors use specific codes
only for recognized database errors; diagnostic text never becomes the message.

Public community-vote and badge reads resolve optional authentication, and
their local failure handlers capture the signed-in user with the event.
Anonymous and invalid-token reads remain public.

## Frontend

`frontend/src/lib/api.ts` exposes `ApiError` and `parseApiError`.
Structured responses expose `code`, `userMessage` and `fieldErrors`.
Legacy text/malformed responses use `Request failed (<status>).` rather
than displaying the raw body. The `raw` and compatibility `body` properties
are diagnostic data; do not render them.

Use `parseApiError(error, fallback)` to normalize API errors, cancellations,
network failures and unknown exceptions. Caller migration is tracked in
[#7](https://github.com/tedgershon/Pheme/issues/7). Consumers must map full
backend field paths to their form inputs: paths arrive as `body.<field>` (for
example `body.title`), and Pydantic messages carry a `Value error, ` prefix.
`frontend/src/lib/market-form.ts` (`mapFieldErrors`) normalizes both for the
create-market form.

Browser Sentry is initialized in `frontend/instrumentation-client.ts`, the
file Next.js loads in the browser; Turbopack, the default bundler, ignores the
older `sentry.client.config.ts` name. Server and edge runtimes use
`sentry.server.config.ts` and `sentry.edge.config.ts` through
`instrumentation.ts`, whose `onRequestError` reports server rendering errors.
`src/app/global-error.tsx` reports React render errors. `SessionProvider`
attaches only the user UUID and clears it on sign-out.

The fetch helper reports 5xx API responses with `error_code`, `http_status`
and `request_id` tags; the last matches `extra.request_id` on the backend
event for the same request. 4xx responses are expected outcomes and are not
reported. The reported path omits the query string. `ApiError.requestId`
exposes the ID to callers.

`withSentryConfig` uploads source maps when `SENTRY_AUTH_TOKEN` is set at build
time. Its organization/project default to `bananagains`/`bananagains-frontend`
(service identifiers, not product copy) and can be overridden with
`SENTRY_ORG`/`SENTRY_PROJECT`.

## Configuration

| Setting | Purpose |
| --- | --- |
| Backend `SENTRY_DSN` | Enables server event delivery; leave blank locally to disable |
| Backend `SENTRY_ENVIRONMENT` | Defaults to development; production also disables API schema routes |
| Backend `SENTRY_RELEASE` | Optional; when unset, `resolve_release` uses Vercel's `VERCEL_GIT_COMMIT_SHA`, then the SDK's own detection (the local Git commit) |
| Backend `SENTRY_TRACES_SAMPLE_RATE` | Defaults to 0.1 |
| Frontend `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Browser configuration |
| Frontend `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | Server/edge configuration |
| Build `SENTRY_AUTH_TOKEN` | Privileged source-map upload credential; never expose through a public variable |
| Build `SENTRY_ORG`, `SENTRY_PROJECT` | Optional source-map upload target overrides |

The Sentry build plugin sets the frontend release at build time and also
detects `VERCEL_GIT_COMMIT_SHA`, so on Vercel the frontend and backend report
the same commit.

Templates are in the backend and frontend environment example files. SDK code
does not establish that hosted projects, alerts or source-map uploads are
configured. Verify a deployed event, correct environment/release, a readable
stack and source-map upload with the smoke test in
[HOSTED_DEVELOPMENT.md](HOSTED_DEVELOPMENT.md#verify-sentry).

## Data handling and verification

Avoid account names, email, tokens and keys in diagnostics. The backend SDK
does not record stack-frame local variables: they hold the full profile row
and the raw ASGI headers, including the bearer token and cookies. Its event
scrubber replaces `andrew_id`, `email`, `display_name`, `access_token`,
`refresh_token` and the SDK's default credential keys at any depth (extras,
request data, breadcrumb and span data). It also replaces `http.query`, the
query string of outgoing Supabase requests, whose PostgREST filters can carry
search text. `before_send` filters the `authorization`, `cookie` and
`x-api-key` headers, and in the inbound query string the `q` parameter (the
super-admin user search) and identifier-named parameters. The browser config
removes `andrew_id` from `event.user`. These are key-based filters; free text
in an exception message is not scrubbed. Use UUIDs and minimal relevant
context.

From `backend/`, run:

```sh
pytest tests/test_error_envelope.py tests/test_market_errors.py tests/test_rpc_error_handling.py tests/test_remaining_router_errors.py tests/test_authorization_inventory.py tests/test_sentry_capture.py
```

The `sentry_events` fixture builds the SDK client from the production
`sentry_options()` (integrations, scrubber and hooks) with an in-memory
transport. `test_sentry_capture.py` covers one tagged event per failure,
request/user context on unhandled errors, CORS on the 500 response and
scrubbing. The endpoint matrix tests also require every event a failing cell
captures to carry the response's `error_code`, request ID and user. Together
they exercise every `ErrorCode` raised with `original`.

These tests exercise response safety, in-memory Sentry capture, notification
owner/non-owner behavior, and the full mounted-route dependency inventory.
They use isolated API fixtures, not a hosted database; they do not establish
SQL/RLS correctness or deployed Sentry delivery. The
development-only `POST /api/__sentry-test` requires admin authorization.
With `SENTRY_ENVIRONMENT=production`, that route is absent and `/docs`,
`/redoc` and `/openapi.json` are disabled.

From `frontend/`, run `pnpm test` for the API error-parser and 5xx reporting
tests. Browser coverage remains planned work.
