"""Sentry + structured logging foundation.

The single point of import for Sentry concerns. Routers and tests must
never import :mod:`sentry_sdk` directly — they go through this module.

See ``docs/OBSERVABILITY.md`` for the error-handling and diagnostics contract.
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from contextvars import ContextVar
from enum import Enum
from typing import Any
from urllib.parse import parse_qsl, urlencode

import sentry_sdk
from fastapi import HTTPException
from pythonjsonlogger.jsonlogger import JsonFormatter
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.scrubber import DEFAULT_DENYLIST, EventScrubber

from config import get_settings

_request_id: ContextVar[str | None] = ContextVar("_request_id", default=None)
_user_id: ContextVar[str | None] = ContextVar("_user_id", default=None)

_HEALTH_CHECK_PATHS = {"/", "/health", "/api/health"}
_SCRUB_HEADERS = {"authorization", "cookie", "x-api-key"}
# Keys scrubbed anywhere in an event (extras, request data, breadcrumb and span
# data), on top of the SDK's credential denylist. Only the profile UUID may
# identify an account. ``http.query`` is the query string of outgoing Supabase
# requests, whose PostgREST filters can carry search text such as an andrew_id.
_SCRUB_KEYS = [
    "andrew_id", "email", "display_name", "access_token", "refresh_token", "http.query",
]
# Inbound query parameters that can carry account identifiers; ``q`` is the
# super-admin user search, which matches on andrew_id.
_SCRUB_QUERY_PARAMS = {"q", *_SCRUB_KEYS}
_FILTERED = "[Filtered]"
# Accept a caller's request ID only when it is short and log-safe.
_REQUEST_ID_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,128}")

logger = logging.getLogger(__name__)


class ErrorCode(str, Enum):
    # Generic — middleware and fallbacks
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    RATE_LIMITED = "RATE_LIMITED"        # reserved for feature 11
    INTERNAL_ERROR = "INTERNAL_ERROR"

    # Auth
    AUTH_PROFILE_INCOMPLETE = "AUTH_PROFILE_INCOMPLETE"

    # Markets
    MARKET_NOT_FOUND = "MARKET_NOT_FOUND"
    MARKET_NOT_OPEN = "MARKET_NOT_OPEN"
    MARKET_NOT_CLOSED = "MARKET_NOT_CLOSED"
    MARKET_NOT_PENDING_REVIEW = "MARKET_NOT_PENDING_REVIEW"
    MARKET_NOT_PENDING_RESOLUTION = "MARKET_NOT_PENDING_RESOLUTION"
    MARKET_NOT_DISPUTED = "MARKET_NOT_DISPUTED"
    MARKET_NOT_ADMIN_REVIEW = "MARKET_NOT_ADMIN_REVIEW"
    MARKET_ALREADY_RESOLVED = "MARKET_ALREADY_RESOLVED"
    MARKET_CLOSE_DATE_PASSED = "MARKET_CLOSE_DATE_PASSED"
    MARKET_NOT_MULTICHOICE = "MARKET_NOT_MULTICHOICE"
    MARKET_NOT_BINARY = "MARKET_NOT_BINARY"

    # Bets
    BET_INSUFFICIENT_BALANCE = "BET_INSUFFICIENT_BALANCE"
    BET_INVALID_AMOUNT = "BET_INVALID_AMOUNT"
    BET_INVALID_OPTION = "BET_INVALID_OPTION"
    BET_CREATOR_RESTRICTED = "BET_CREATOR_RESTRICTED"

    # Resolution
    RESOLUTION_NOT_CREATOR = "RESOLUTION_NOT_CREATOR"
    RESOLUTION_WINDOW_EXPIRED = "RESOLUTION_WINDOW_EXPIRED"
    DISPUTE_NOT_FOUND = "DISPUTE_NOT_FOUND"
    DISPUTE_ALREADY_FILED = "DISPUTE_ALREADY_FILED"
    DISPUTE_BETTOR_RESTRICTED = "DISPUTE_BETTOR_RESTRICTED"
    DISPUTE_CREATOR_RESTRICTED = "DISPUTE_CREATOR_RESTRICTED"
    DISPUTE_VOTE_DUPLICATE = "DISPUTE_VOTE_DUPLICATE"
    COMMUNITY_VOTE_DUPLICATE = "COMMUNITY_VOTE_DUPLICATE"
    COMMUNITY_VOTE_CREATOR_RESTRICTED = "COMMUNITY_VOTE_CREATOR_RESTRICTED"

    # Daily claim
    CLAIM_ALREADY_TODAY = "CLAIM_ALREADY_TODAY"
    CLAIM_AT_BALANCE_CAP = "CLAIM_AT_BALANCE_CAP"

    # Admin / super-admin
    ADMIN_REQUIRED = "ADMIN_REQUIRED"
    SUPER_ADMIN_REQUIRED = "SUPER_ADMIN_REQUIRED"
    ADMIN_CANNOT_CHANGE_OWN_ROLE = "ADMIN_CANNOT_CHANGE_OWN_ROLE"
    ADMIN_RESOLUTION_CREATOR_RESTRICTED = "ADMIN_RESOLUTION_CREATOR_RESTRICTED"

    # Notifications
    NOTIFICATION_NOT_FOUND = "NOTIFICATION_NOT_FOUND"


class AppError(HTTPException):
    """Expose a safe HTTP error while capturing its underlying cause privately."""

    def __init__(
        self,
        status_code: int,
        code: ErrorCode,
        message: str,
        *,
        original: BaseException | None = None,
        extras: dict[str, Any] | None = None,
        errors: list[dict[str, Any]] | None = None,
    ) -> None:
        # The integrations would otherwise capture a 5xx AppError a second
        # time, without its tag; _before_send drops that duplicate.
        self.reported = original is not None
        if original is not None:
            with sentry_sdk.new_scope() as scope:
                scope.set_tag("error_code", code.value)
                if extras:
                    for key, value in extras.items():
                        scope.set_extra(key, value)
                rid = _request_id.get()
                if rid:
                    scope.set_extra("request_id", rid)
                sentry_sdk.capture_exception(original)

        detail: dict[str, Any] = {"code": code.value, "message": message}
        if errors is not None:
            detail["errors"] = errors
        super().__init__(status_code=status_code, detail=detail)


class _ContextFilter(logging.Filter):
    """Inject request_id + user_id from ContextVars onto every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id.get()
        record.user_id = _user_id.get()
        return True


def _configure_logging(environment: str) -> None:
    """Wire JSON formatter (prod) or plain formatter (dev) onto the root logger.

    A filter injects ``request_id`` and ``user_id`` from the ContextVars onto
    every record so they appear in the formatted output.
    """

    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler()
    if environment == "production":
        formatter: logging.Formatter = JsonFormatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s %(request_id)s %(user_id)s",
            rename_fields={"levelname": "level", "asctime": "timestamp"},
        )
    else:
        formatter = logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s [req=%(request_id)s user=%(user_id)s] %(message)s"
        )
    handler.setFormatter(formatter)
    handler.addFilter(_ContextFilter())
    root.addHandler(handler)
    root.setLevel(logging.INFO)


def _scrub_query_string(event: dict[str, Any]) -> None:
    request = event.get("request")
    if not isinstance(request, dict):
        return
    query = request.get("query_string")
    if isinstance(query, str) and query:
        pairs = parse_qsl(query, keep_blank_values=True)
        request["query_string"] = urlencode(
            [(k, _FILTERED if k.lower() in _SCRUB_QUERY_PARAMS else v) for k, v in pairs],
            safe="[]",
        )


def _before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
    """Deduplicate and tag AppError events, attach the request ID, strip secrets.

    The configured ``EventScrubber`` handles denylisted keys at any depth.
    """

    exc_info = hint.get("exc_info") or (None, None, None)
    exc = exc_info[1]
    if isinstance(exc, AppError):
        if exc.reported:
            return None  # Already captured through its original exception.
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        if "code" in detail:
            event.setdefault("tags", {})["error_code"] = detail["code"]

    rid = _request_id.get()
    if rid:
        event.setdefault("extra", {}).setdefault("request_id", rid)

    request = event.get("request") or {}
    headers = request.get("headers")
    if isinstance(headers, dict):
        for key in list(headers.keys()):
            if key.lower() in _SCRUB_HEADERS:
                headers[key] = _FILTERED
    elif isinstance(headers, list):
        for idx, item in enumerate(headers):
            if isinstance(item, (list, tuple)) and len(item) == 2:
                name, _ = item
                if isinstance(name, str) and name.lower() in _SCRUB_HEADERS:
                    headers[idx] = [name, _FILTERED]
    _scrub_query_string(event)

    return event


def _before_send_transaction(
    event: dict[str, Any], hint: dict[str, Any]
) -> dict[str, Any] | None:
    """Drop health-check transactions to keep performance noise low."""

    transaction = event.get("transaction")
    if isinstance(transaction, str) and transaction in _HEALTH_CHECK_PATHS:
        return None
    _scrub_query_string(event)
    return event


def sentry_options(
    *,
    environment: str,
    release: str | None,
    traces_sample_rate: float,
) -> dict[str, Any]:
    """``sentry_sdk.init`` options other than the DSN, shared with the tests."""

    return {
        "environment": environment,
        # None lets the SDK detect the release (SENTRY_RELEASE, local Git).
        "release": release,
        "traces_sample_rate": traces_sample_rate,
        "send_default_pii": False,
        # Frame locals include the full profile row and raw ASGI headers
        # (bearer token, cookies), which key-based scrubbing cannot reach.
        "include_local_variables": False,
        "event_scrubber": EventScrubber(denylist=[*DEFAULT_DENYLIST, *_SCRUB_KEYS], recursive=True),
        "integrations": [
            FastApiIntegration(transaction_style="endpoint"),
            StarletteIntegration(),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
        "before_send": _before_send,
        "before_send_transaction": _before_send_transaction,
    }


def resolve_release(configured: str | None) -> str | None:
    """Prefer ``SENTRY_RELEASE``, then the deployed Vercel commit.

    The Python SDK does not read ``VERCEL_GIT_COMMIT_SHA``, and a Vercel
    deployment has no Git checkout to detect. The frontend build plugin reads
    the same variable, so both projects report the same release.
    """

    return configured or os.environ.get("VERCEL_GIT_COMMIT_SHA") or None


def init_observability() -> None:
    """Initialize Sentry + structured logging. Call once at app startup.

    No-ops cleanly when ``SENTRY_DSN`` is unset — logs a single INFO line
    confirming the skip and otherwise leaves logging untouched-ish (still
    swaps the formatter so request_id/user_id appear locally).
    """

    settings = get_settings()
    _configure_logging(settings.sentry_environment)

    if not settings.sentry_dsn:
        logger.info("Sentry DSN not set; skipping Sentry init")
        return

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        **sentry_options(
            environment=settings.sentry_environment,
            release=resolve_release(settings.sentry_release),
            traces_sample_rate=settings.sentry_traces_sample_rate,
        ),
    )


def begin_request(request_id: str | None = None) -> str:
    """Set this request's ID, keeping a caller's ID only when it is log-safe."""

    if not (request_id and _REQUEST_ID_PATTERN.fullmatch(request_id)):
        request_id = None
    rid = request_id or uuid.uuid4().hex
    _request_id.set(rid)
    return rid


def set_user_context(user_id: str | None) -> None:
    """Tag the current request with an authenticated user UUID."""

    _user_id.set(user_id)
    sentry_sdk.set_user({"id": user_id} if user_id else None)


def clear_user_context() -> None:
    """Clear both request and user context. Called at request teardown."""

    _request_id.set(None)
    _user_id.set(None)
    sentry_sdk.set_user(None)


def report_and_safe_message(
    exc: BaseException,
    user_message: str,
    *,
    level: str = "error",
    code: ErrorCode | None = None,
    extras: dict[str, Any] | None = None,
) -> str:
    """Capture ``exc`` to Sentry with full context, return only the safe message.

    Foundational helper for doc 13's ``AppError``. Routers use this in
    ``except`` blocks to keep raw exception text out of user responses
    while preserving everything in Sentry.
    """

    with sentry_sdk.new_scope() as scope:
        scope.level = level
        if code is not None:
            scope.set_tag("error_code", code.value)
        if extras:
            for key, value in extras.items():
                scope.set_extra(key, value)
        rid = _request_id.get()
        if rid:
            scope.set_extra("request_id", rid)
        sentry_sdk.capture_exception(exc)
    return user_message
