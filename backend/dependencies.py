from contextlib import contextmanager
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import get_settings
from observability import set_user_context
from supabase import Client, create_client

_security = HTTPBearer(auto_error=False)
_security_optional = HTTPBearer(auto_error=False)

_supabase_client: Client | None = None
_supabase_service_client: Client | None = None


def get_supabase_client() -> Client:
    """Return a Supabase client.  Always initialised when URL + key are set."""
    global _supabase_client
    if _supabase_client is None:
        s = get_settings()
        if not s.supabase_url or not s.supabase_key:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Supabase URL and key must be configured",
            )
        _supabase_client = create_client(s.supabase_url, s.supabase_key)
    return _supabase_client


def get_supabase_service_client() -> Client | None:
    """Supabase client with service role — bypasses RLS. Use for trusted server writes."""
    global _supabase_service_client
    s = get_settings()
    if not s.supabase_url or not s.supabase_service_role_key:
        return None
    if _supabase_service_client is None:
        _supabase_service_client = create_client(
            s.supabase_url,
            s.supabase_service_role_key,
        )
    return _supabase_service_client


def _resolve_user(token: str, supabase: Client) -> dict:
    """Validate a Supabase JWT and return the matching profile row."""
    try:
        user_response = supabase.auth.get_user(token)
        user = user_response.user
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc

    profile_response = (
        supabase.table("profiles").select("*").eq("id", user.id).single().execute()
    )

    if profile_response.data is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found. Please complete onboarding.",
        )

    return profile_response.data


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_security)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
) -> dict:
    """Required auth -- returns the authenticated user's profile or 401."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    profile = _resolve_user(credentials.credentials, supabase)
    set_user_context(profile["id"])
    return profile


async def get_user_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_security)],
) -> str | None:
    """Return the raw JWT from the Authorization header, or None."""
    if credentials is None:
        return None
    return credentials.credentials


@contextmanager
def user_auth(supabase: Client, token: str | None):
    """Temporarily set the user's JWT on the PostgREST client so RLS
    policies that reference ``auth.uid()`` resolve to the real user."""
    if token:
        supabase.postgrest.auth(token)
    try:
        yield supabase
    finally:
        if token:
            supabase.postgrest.auth(get_settings().supabase_key)


async def require_admin(
    current_user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    """Require the user to be an admin or super_admin."""
    if current_user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
    return current_user


async def require_super_admin(
    current_user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    """Require the user to be a super_admin."""
    if current_user.get("role") != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required.")
    return current_user


async def get_current_user_optional(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_security_optional)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
) -> dict | None:
    """Optional auth -- returns profile if a valid token is present, else None."""
    if credentials is None:
        return None
    try:
        profile = _resolve_user(credentials.credentials, supabase)
        set_user_context(profile["id"])
        return profile
    except HTTPException:
        return None
