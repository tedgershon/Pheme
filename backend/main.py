from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from dependencies import require_admin
from middleware.request_context import RequestContextMiddleware
from observability import init_observability
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
