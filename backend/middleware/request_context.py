"""Request-context middleware: x-request-id header round-trip."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from observability import (
    ErrorCode,
    begin_request,
    clear_user_context,
    report_and_safe_message,
)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Read/generate x-request-id, populate the request ContextVar, echo back.

    Mounted inside ``CORSMiddleware`` in ``main.py`` so every response it
    returns, including the 500 below, carries CORS headers. Clears user
    context in ``finally`` to avoid leakage across requests that share an
    asyncio task.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        rid = begin_request(request.headers.get("x-request-id"))
        try:
            try:
                response = await call_next(request)
            except Exception as exc:  # noqa: BLE001 - report any route failure safely
                # Report here, while request and user context are still set.
                # Starlette's outer error handler would run after the finally
                # below and outside CORS, so the browser could read neither
                # the envelope nor the request ID.
                message = report_and_safe_message(
                    exc, "Internal server error.", code=ErrorCode.INTERNAL_ERROR,
                )
                response = JSONResponse(
                    status_code=500,
                    content={"detail": {"code": ErrorCode.INTERNAL_ERROR.value, "message": message}},
                )
            response.headers["x-request-id"] = rid
            return response
        finally:
            clear_user_context()
