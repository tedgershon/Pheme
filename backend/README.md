Create the venv (macOS):
`python -m venv .venv`
Activate it with
`source venv/bin/activate`

Probably similar on Windows. I'd use WSL or bash instead of powershell though. If bash, the setup is the same as above

To run the server, we use uvicorn. FastAPI even says for production you should use FastAPI run, and it also uses uvicorn internally. We have more control over the executable path, hard reload, and server path

`uvicorn main:app --host 127.0.0.1 --port 8000 --reload`

## Error responses

`observability.AppError` is an `HTTPException` with a structured `detail`:
`{"code": "<ErrorCode value>", "message": "<safe message>"}`. Pass an underlying
exception as `original` to capture it in Sentry with the `error_code` tag,
request ID, and optional diagnostic `extras`. Diagnostics stay out of the
HTTP response. Without `original`, no event is captured.

Request validation returns status 422 with code `VALIDATION_FAILED` and an
`errors` list containing `field`, `message`, and `type`. Field paths join the
complete FastAPI location, for example `body.title` or `body.options.0.label`.
Rejected inputs and Pydantic exception context are omitted. Unhandled errors
are reported through `report_and_safe_message` and return status 500 with
code `INTERNAL_ERROR` and message `Internal server error.`

Existing router `HTTPException` responses retain their current behavior until
the router migrations in issues #4–#6. Run `pytest tests/test_error_envelope.py`
for HTTP smoke checks and Sentry capture tests; the Sentry transport stays in
memory and temporary test routes never become production endpoints.

## Supabase migrations

Run the SQL files in `backend/supabase/migrations/` in order inside the Supabase SQL editor.

Notable auth enforcement migrations:

- `005_cmu_email_rls.sql` restricts database access to `@andrew.cmu.edu` users.
- `006_auth_cmu_domain_trigger.sql` blocks account creation unless the email ends with `@andrew.cmu.edu`.

Dispute/voting migration:

- `007_dispute_voting.sql` adds dispute fields and voting RPCs.
