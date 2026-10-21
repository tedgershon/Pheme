from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import get_settings
from dependencies import require_admin
from middleware.request_context import RequestContextMiddleware
from observability import ErrorCode, init_observability, report_and_safe_message
from routers import (
    admin,
    auth,
    bets,
    leaderboard,
    markets,
    notifications,
    portfolio,
    resolution,
    rewards,
)

init_observability()

is_production = get_settings().sentry_environment == "production"
app = FastAPI(
    title="BananaGains API",
    version="0.1.0",
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
    openapi_url=None if is_production else "/openapi.json",
)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "detail": {
                "code": ErrorCode.VALIDATION_FAILED.value,
                "message": "Validation failed.",
                "errors": [
                    {
                        "field": ".".join(str(part) for part in error["loc"]),
                        "message": error["msg"],
                        "type": error["type"],
                    }
                    for error in exc.errors()
                ],
            }
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, HTTPException):
        raise exc
    message = report_and_safe_message(exc, "Internal server error.")
    return JSONResponse(
        status_code=500,
        content={"detail": {"code": ErrorCode.INTERNAL_ERROR.value, "message": message}},
    )


app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(resolution.router)
app.include_router(markets.router)
app.include_router(bets.router)
app.include_router(notifications.router)
app.include_router(portfolio.router)
app.include_router(leaderboard.router)
app.include_router(rewards.router)


@app.get("/")
def health_check():
    return {"status": "ok", "service": "bananagains-api"}


# Temporary smoke-test endpoint for verifying Sentry capture end-to-end.
# Gated to development to avoid exposing an arbitrary 500-trigger in prod.
if get_settings().sentry_environment == "development":

    @app.post("/api/__sentry-test")
    def _sentry_test(_current_user: Annotated[dict, Depends(require_admin)]) -> dict:
        raise RuntimeError("sentry-test: intentional failure for verification")
