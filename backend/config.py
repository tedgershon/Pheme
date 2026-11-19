import re
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_key: str = ""
    # Service role key (backend only). Bypasses RLS for server-side inserts like notifications.
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    cors_origins: list[str] = ["http://localhost:3000"]
    # Optional full-match pattern for origins that change per deployment, such as
    # Vercel previews. Anchor it to your own project and team: credentials are allowed.
    cors_origin_regex: str | None = None

    sentry_dsn: str = ""
    sentry_environment: str = "development"
    sentry_release: str | None = None
    sentry_traces_sample_rate: float = 0.1

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @field_validator("cors_origin_regex")
    @classmethod
    def validate_cors_origin_regex(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        v = v.strip()
        try:
            re.compile(v)
        except re.error as exc:
            raise ValueError(f"CORS_ORIGIN_REGEX is not a valid regular expression: {exc}") from exc
        return v


def cors_options(settings: Settings) -> dict:
    """CORSMiddleware arguments; the regex is matched against the whole origin."""
    return {
        "allow_origins": settings.cors_origins,
        "allow_origin_regex": settings.cors_origin_regex,
        "allow_credentials": True,
        "allow_methods": ["*"],
        "allow_headers": ["*"],
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
