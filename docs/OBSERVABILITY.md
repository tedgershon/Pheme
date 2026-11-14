# Observability and error handling

## Backend

[observability.py](../backend/observability.py) centralizes logging, Sentry
initialization, request/user context, `ErrorCode` and `AppError`. Routers use
these helpers rather than importing the Sentry SDK directly.

`RequestContextMiddleware` reads or generates an `x-request-id`, returns it
on the response and clears request/user context after the request.
Authentication attaches the profile UUID with `set_user_context`.
Production logging uses JSON; development logs include readable context.

`AppError(status_code, code, message, original=..., extras=...)` produces:

```json
{"detail": {"code": "MARKET_NOT_FOUND", "message": "Market not found."}}
```

When `original` is supplied, it captures the exception with an `error_code`
tag, request ID and diagnostic extras. Without `original`, it does not emit
a Sentry event. Keep diagnostic data out of the HTTP message.

FastAPI request validation returns 422 with `VALIDATION_FAILED` and an
`errors` list of `field`, `message` and `type`. Field paths include the
location prefix, such as `body.title` or `body.options.0.label`.
Rejected inputs and Pydantic exception context are omitted. Unexpected
exceptions are captured through `report_and_safe_message` and return a
generic 500 `INTERNAL_ERROR` response.

The envelope is a rollout in progress. Markets routes use it except for the
legacy admin-resolution handler; other routers and authentication dependencies
still include plain `HTTPException` paths. Remaining migrations are in
[#5](https://github.com/tedgershon/Pheme/issues/5),
[#6](https://github.com/tedgershon/Pheme/issues/6) and
[#10](https://github.com/tedgershon/Pheme/issues/10).
Do not assume every 4xx/5xx already has the same body.

## Frontend

`frontend/src/lib/api.ts` exposes `ApiError` and `parseApiError`.
Structured responses expose `code`, `userMessage` and `fieldErrors`.
Legacy text/malformed responses use `Request failed (<status>).` rather
than displaying the raw body. The `raw` and compatibility `body` properties
are diagnostic data; do not render them.

Use `parseApiError(error, fallback)` to normalize API errors, cancellations,
network failures and unknown exceptions. Caller migration is tracked in
[#7](https://github.com/tedgershon/Pheme/issues/7); per-field form display is
tracked in [#21](https://github.com/tedgershon/Pheme/issues/21). Consumers must
map full backend field paths to their form inputs.

The frontend has browser/server/edge Sentry config files, an instrumentation
hook and `withSentryConfig`. `SessionProvider` attaches only the user UUID
and clears it on sign-out. The existing Sentry organization/project names in
`next.config.ts` are service identifiers, not product-copy examples.

## Configuration

| Setting | Purpose |
| --- | --- |
| Backend `SENTRY_DSN` | Enables server event delivery; leave blank locally to disable |
| Backend `SENTRY_ENVIRONMENT` | Defaults to development; production also disables API schema routes |
| Backend `SENTRY_RELEASE` | Optional release identifier; set explicitly in deployment |
| Backend `SENTRY_TRACES_SAMPLE_RATE` | Defaults to 0.1 |
| Frontend `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Browser configuration |
| Frontend `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | Server/edge configuration |
| Build `SENTRY_AUTH_TOKEN` | Privileged source-map upload credential; never expose through a public variable |

Templates are in the backend and frontend environment example files. SDK code
does not establish that hosted projects, alerts or source-map uploads are
configured. Verify a deployed event, correct environment/release, a readable
stack and source-map upload with a controlled smoke test.

## Data handling and verification

Avoid account names, email, tokens and keys in diagnostics. Backend
`before_send` filters selected request headers and a top-level `andrew_id`
extra; the browser config removes `andrew_id` from `event.user`. These
are specific filters, not a guarantee that arbitrary nested payloads are safe.
Use UUIDs and minimal relevant context.

From `backend/`, run:

```sh
pytest tests/test_error_envelope.py tests/test_market_errors.py
```

These tests exercise response safety and in-memory Sentry capture. The
development-only `POST /api/__sentry-test` requires admin authorization.
With `SENTRY_ENVIRONMENT=production`, that route is absent and `/docs`,
`/redoc` and `/openapi.json` are disabled.

From `frontend/`, run `pnpm test` for the API error-parser tests.
Broader capture verification is tracked in
[#2](https://github.com/tedgershon/Pheme/issues/2); API and browser coverage
remain planned work.