from typing import Annotated

from fastapi import APIRouter, Depends, Query

from dependencies import (
    get_current_user,
    get_supabase_client,
    get_user_token,
    user_auth,
)
from supabase import Client

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    *,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """List the user's notifications, newest first."""
    with user_auth(supabase, token):
        result = (
            supabase.table("notifications")
            .select("*")
            .eq("user_id", current_user["id"])
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
    return result.data or []


@router.get("/unread-count")
async def get_unread_count(
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
):
    """Get the count of unread notifications."""
    result = supabase.rpc("get_unread_notification_count", {
        "p_user_id": current_user["id"],
    }).execute()
    return {"count": result.data or 0}


@router.post("/read")
async def mark_notifications_read(
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Mark all unread notifications as read."""
    with user_auth(supabase, token):
        supabase.table("notifications") \
            .update({"is_read": True}) \
            .eq("user_id", current_user["id"]) \
            .eq("is_read", False) \
            .execute()
    return {"status": "ok"}


@router.post("/{notification_id}/read")
async def mark_single_read(
    notification_id: str,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Mark a single notification as read."""
    with user_auth(supabase, token):
        supabase.table("notifications") \
            .update({"is_read": True}) \
            .eq("id", notification_id) \
            .eq("user_id", current_user["id"]) \
            .execute()
    return {"status": "ok"}


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: str,
    current_user: Annotated[dict, Depends(get_current_user)],
    supabase: Annotated[Client, Depends(get_supabase_client)],
    token: str | None = Depends(get_user_token),
):
    """Delete a notification owned by the current user."""
    with user_auth(supabase, token):
        supabase.table("notifications") \
            .delete() \
            .eq("id", notification_id) \
            .eq("user_id", current_user["id"]) \
            .execute()
    return {"status": "ok"}
