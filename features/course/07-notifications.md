# Feature 07: In-App & Email Notifications

**Phase:** 3 (depends on Phase 2)
**Dependencies:** `02-market-creation-review` (market approval triggers), `01-admin-system` (admin roles), `06-user-profile` (notification badge in dropdown)
**Parallelizable with:** `03-multichoice-markets`

---

## Summary

Build a notification system with two channels: **in-app notifications** (stored in DB, viewable in a notifications page) and **email notifications** via **Resend**. Notifications are triggered when an admin approves or denies a user's proposed market. The user profile dropdown shows an unread notification count, and a visual indicator on the avatar signals unread notifications.

---

## Current State

- No notification system exists (no table, no endpoints, no UI).
- No email integration exists.
- The user profile dropdown (Feature 06) has placeholder slots for notification badges.
- Market approval events (Feature 02) are the primary trigger for notifications.

---

## Database Changes

### Migration 041: Notifications Table

**File:** `backend/supabase/migrations/041_notifications_table.sql`

```sql
CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN (
        'market_approved', 'market_denied', 'market_closed',
        'market_resolved', 'payout_received',
        'badge_earned', 'system'
    )),
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    metadata    JSONB DEFAULT '{}',  -- flexible data (market_id, badge_id, etc.)
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, is_read)
    WHERE is_read = FALSE;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
    ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications"
    ON notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "System can insert notifications"
    ON notifications FOR INSERT WITH CHECK (true);
```

### Migration 042: Unread Notification Count Function

**File:** `backend/supabase/migrations/042_fn_unread_count.sql`

```sql
CREATE OR REPLACE FUNCTION get_unread_notification_count(
    p_user_id UUID
) RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM notifications
        WHERE user_id = p_user_id AND is_read = FALSE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Backend Changes

### New File: `backend/routers/notifications.py`

```python
from fastapi import APIRouter, Depends, Query
from supabase import Client

from dependencies import get_current_user, get_supabase_client, get_user_token, user_auth

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
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
    current_user: dict = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
):
    """Get the count of unread notifications."""
    result = supabase.rpc("get_unread_notification_count", {
        "p_user_id": current_user["id"],
    }).execute()
    return {"count": result.data or 0}


@router.post("/read")
async def mark_notifications_read(
    current_user: dict = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
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
    current_user: dict = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
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
```

### New File: `backend/schemas/notification.py`

```python
from datetime import datetime
from pydantic import BaseModel


class NotificationResponse(BaseModel):
    id: str
    user_id: str
    type: str
    title: str
    body: str
    metadata: dict = {}
    is_read: bool
    created_at: datetime


class UnreadCountResponse(BaseModel):
    count: int
```

### New File: `backend/notification_service.py`

Centralized service for creating notifications and sending emails:

```python
import httpx
from supabase import Client


RESEND_API_KEY = ""  # Set via environment variable
RESEND_FROM = "Pheme <notifications@bananagains.app>"  # Or your verified domain


async def create_notification(
    supabase: Client,
    user_id: str,
    notification_type: str,
    title: str,
    body: str,
    metadata: dict | None = None,
    send_email: bool = False,
    recipient_email: str | None = None,
):
    """Create an in-app notification and optionally send an email."""
    # Insert in-app notification
    supabase.table("notifications").insert({
        "user_id": user_id,
        "type": notification_type,
        "title": title,
        "body": body,
        "metadata": metadata or {},
    }).execute()

    # Send email via Resend if requested
    if send_email and recipient_email and RESEND_API_KEY:
        await _send_email(recipient_email, title, body)


async def _send_email(to: str, subject: str, body: str):
    """Send an email notification via Resend API."""
    async with httpx.AsyncClient() as client:
        await client.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": RESEND_FROM,
                "to": [to],
                "subject": f"Pheme: {subject}",
                "html": f"""
                    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
                        <h2 style="color: #333;">🍌 Pheme</h2>
                        <p>{body}</p>
                        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #888; font-size: 12px;">
                            This is an automated notification from Pheme, CMU's prediction market.
                        </p>
                    </div>
                """,
            },
        )


async def notify_market_approved(
    supabase: Client,
    market: dict,
    review_notes: str | None,
):
    """Send notification when a market is approved."""
    creator_id = market["creator_id"]

    # Get creator's email (andrew_id@andrew.cmu.edu)
    creator = supabase.table("profiles").select("andrew_id").eq("id", creator_id).single().execute()
    email = f"{creator.data['andrew_id']}@andrew.cmu.edu" if creator.data else None

    # Build notification body
    body_parts = [
        f"Your market \"{market['title']}\" has been approved and is now live!",
        "",
        f"Title: {market['title']}",
        f"Description: {market['description']}",
        f"Close Date: {market['close_at']}",
        f"Category: {market['category']}",
    ]
    if review_notes:
        body_parts.append(f"\nAdmin Notes: {review_notes}")

    body = "\n".join(body_parts)

    await create_notification(
        supabase=supabase,
        user_id=creator_id,
        notification_type="market_approved",
        title="Market Approved",
        body=body,
        metadata={"market_id": market["id"]},
        send_email=True,
        recipient_email=email,
    )


async def notify_market_denied(
    supabase: Client,
    market: dict,
    review_notes: str,
):
    """Send notification when a market is denied."""
    creator_id = market["creator_id"]

    creator = supabase.table("profiles").select("andrew_id").eq("id", creator_id).single().execute()
    email = f"{creator.data['andrew_id']}@andrew.cmu.edu" if creator.data else None

    body = (
        f"Your market \"{market['title']}\" was not approved.\n\n"
        f"Admin Feedback: {review_notes}\n\n"
        "Please review the feedback and consider resubmitting with the suggested changes."
    )

    await create_notification(
        supabase=supabase,
        user_id=creator_id,
        notification_type="market_denied",
        title="Market Not Approved",
        body=body,
        metadata={"market_id": market["id"]},
        send_email=True,
        recipient_email=email,
    )


async def notify_market_closed(
    supabase: Client,
    market: dict,
):
    """Send notification + email to the market creator the instant their market closes.

    This prompts the creator to propose a resolution. The 24h community
    voting window has already begun (Feature 04), so the creator should
    act promptly.
    """
    creator_id = market["creator_id"]

    creator = supabase.table("profiles").select("andrew_id").eq("id", creator_id).single().execute()
    email = f"{creator.data['andrew_id']}@andrew.cmu.edu" if creator.data else None

    body = (
        f"Your market \"{market['title']}\" has just closed and is no longer accepting bets.\n\n"
        "A 24-hour resolution period has begun. During this time, community members "
        "can vote on the outcome. As the market creator, you can also propose a "
        "resolution.\n\n"
        "Please visit the market page to review the results and propose your resolution."
    )

    await create_notification(
        supabase=supabase,
        user_id=creator_id,
        notification_type="market_closed",
        title="Your Market Has Closed — Time to Resolve",
        body=body,
        metadata={"market_id": market["id"]},
        send_email=True,
        recipient_email=email,
    )
```

### Modify: `backend/config.py`

Add Resend configuration:

```python
class Settings(BaseSettings):
    # ... existing ...
    resend_api_key: str = ""
    notification_from_email: str = "Pheme <notifications@bananagains.app>"
```

### Modify: `backend/routers/admin.py`

After a market is approved or denied, trigger the notification:

```python
from notification_service import notify_market_approved, notify_market_denied

@router.post("/api/admin/markets/{market_id}/review")
async def review_market(...):
    # ... existing review logic ...

    # After successful review, fetch the full market for notification
    market = supabase.table("markets").select("*").eq("id", market_id).single().execute()

    if body.action == "approve":
        await notify_market_approved(supabase, market.data, body.notes)
    else:
        await notify_market_denied(supabase, market.data, body.notes)

    return result.data
```

### Modify: `backend/routers/markets.py` — `_apply_lazy_transitions`

When a market is lazily transitioned from `open` to `closed`, fire the "market closed" notification to the creator immediately:

```python
from notification_service import notify_market_closed

# Inside _apply_lazy_transitions, after closing expired markets:
if close_ids:
    supabase.table("markets").update({"status": "closed"}).in_("id", close_ids).execute()

    # Notify each market's creator that their market has closed
    for m in markets:
        if m["id"] in close_ids:
            import asyncio
            try:
                asyncio.get_event_loop().run_until_complete(
                    notify_market_closed(supabase, m)
                )
            except RuntimeError:
                asyncio.run(notify_market_closed(supabase, m))
```

**Also integrate with `close_expired_markets()` (the pg_cron function):**
Since the Postgres function cannot call Python, the notification must be triggered at the API layer. The lazy transition approach above handles the common case. For the pg_cron path, add a secondary check: when the Resolutions page or market detail page is loaded and a market is newly in `closed` status, check if a `market_closed` notification already exists for that market's creator. If not, send one. This ensures the email goes out regardless of which path closes the market.

Alternatively, implement the notification as a Supabase Edge Function triggered by a database webhook on the `markets` table when `status` changes to `closed`. This is more reliable than relying on lazy transitions:

```sql
-- In Supabase Dashboard → Database → Webhooks:
-- Table: markets
-- Event: UPDATE
-- Filter: status = 'closed' AND old.status = 'open'
-- Webhook URL: your-edge-function-url/notify-market-closed
```

### Modify: `backend/main.py`

Register the notifications router:
```python
from routers import notifications
app.include_router(notifications.router)
```

---

## Resend Setup Instructions

1. **Create a Resend account:** Go to https://resend.com and sign up.
2. **Add a domain** (or use the free `onboarding@resend.dev` for testing).
3. **Get the API key** from Resend dashboard.
4. **Add to `backend/.env`:**
   ```
   resend_api_key=re_xxxxxxxxxxxxxxxxxxxx
   notification_from_email=Pheme <notifications@yourdomain.com>
   ```
5. **For production:** Verify a custom domain in Resend for better deliverability.

---

## Frontend Changes

### New Page: `frontend/src/app/notifications/page.tsx`

**Notifications Page:**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import * as api from "@/lib/api";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, string>;
  is_read: boolean;
  created_at: string;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNotifications();
    // Mark all as read when page is opened
    api.markNotificationsRead();
  }, []);

  async function loadNotifications() {
    try {
      const data = await api.listNotifications();
      setNotifications(data);
    } catch {}
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Stay up to date with your markets and activity
        </p>
      </section>

      {loading ? (
        <Spinner className="size-6" />
      ) : notifications.length === 0 ? (
        <p className="text-muted-foreground">No notifications yet.</p>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <Card key={n.id} size="sm" className={n.is_read ? "opacity-60" : ""}>
              <CardContent className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{n.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(n.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {n.body}
                </p>
                {n.metadata?.market_id && (
                  <a
                    href={`/markets/${n.metadata.market_id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    View Market →
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Update: `frontend/src/components/user-menu.tsx`

Add the unread notification count and visual indicator:

**In the component:**
```tsx
const [unreadCount, setUnreadCount] = useState(0);

useEffect(() => {
  if (!isDemo) {
    api.getUnreadNotificationCount().then((data) => setUnreadCount(data.count));
  }
}, [isDemo]);
```

**On the avatar button (indicator dot):**
```tsx
<button onClick={() => setOpen(!open)} className="relative">
  {/* Avatar (existing) */}
  {unreadCount > 0 && (
    <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-danger border-2 border-white" />
  )}
</button>
```

**On the "Notifications" menu item:**
```tsx
<Link href="/notifications" className="flex items-center justify-between ...">
  <div className="flex items-center gap-3">
    <Bell size={16} />
    <span>Notifications</span>
  </div>
  {unreadCount > 0 && (
    <span className="inline-flex items-center justify-center size-5 rounded-full bg-danger text-danger-foreground text-xs font-bold">
      {unreadCount > 9 ? "9+" : unreadCount}
    </span>
  )}
</Link>
```

The indicator styling should be:
- A small **red dot** on the avatar circle (before opening the dropdown) — simple `bg-danger` circle, positioned at top-right of the avatar
- A **numbered badge** next to "Notifications" in the dropdown — uses `bg-danger text-danger-foreground` with the count
- Both should clear when the user visits the notifications page (which calls `markNotificationsRead`)

### Update: `frontend/src/lib/api.ts`

```typescript
// Notifications
export function listNotifications(params?: { limit?: number; offset?: number }): Promise<NotificationResponse[]> {
  const sp = new URLSearchParams();
  if (params?.limit != null) sp.set("limit", String(params.limit));
  if (params?.offset != null) sp.set("offset", String(params.offset));
  const qs = sp.toString();
  return apiFetch(`/api/notifications${qs ? `?${qs}` : ""}`);
}

export function getUnreadNotificationCount(): Promise<{ count: number }> {
  return apiFetch("/api/notifications/unread-count");
}

export function markNotificationsRead(): Promise<{ status: string }> {
  return apiFetch("/api/notifications/read", { method: "POST" });
}
```

### Update: `frontend/src/lib/types.ts`

```typescript
export interface NotificationResponse {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, string>;
  is_read: boolean;
  created_at: string;
}
```

---

## Notification Types and Triggers

| Type | Trigger | Title | Body |
|------|---------|-------|------|
| `market_approved` | Admin approves market | "Market Approved" | Market details + admin notes |
| `market_denied` | Admin denies market | "Market Not Approved" | Feedback + admin notes |
| `market_closed` | Market's `close_at` passes | "Your Market Has Closed" | Prompt to resolve + market link |
| `market_resolved` | Market resolves | "Market Resolved" | Outcome + payout info |
| `payout_received` | User receives payout | "Payout Received" | Amount + market title |
| `badge_earned` | User earns badge (Feature 09) | "Badge Earned" | Badge name + description |
| `system` | General system notification | Varies | Varies |

For this feature, implement `market_approved`, `market_denied`, and `market_closed`. Other types will be added by their respective features.

---

## Testing Checklist

- [ ] When admin approves a market, creator receives an in-app notification
- [ ] When admin denies a market, creator receives an in-app notification with admin notes
- [ ] When a market closes (via lazy transition or pg_cron), creator receives an in-app notification prompting resolution
- [ ] Email is sent to creator's @andrew.cmu.edu address for market approval, denial, **and closure**
- [ ] Market-closed email body explains the 24h resolution window and prompts the creator to propose a resolution
- [ ] Only one `market_closed` notification is sent per market (no duplicates from lazy vs. cron paths)
- [ ] Unread notification count shows correctly in user menu
- [ ] Red dot appears on avatar when there are unread notifications
- [ ] Visiting notifications page marks all as read
- [ ] Unread count and dot clear after visiting notifications
- [ ] Notifications page shows all notifications with correct formatting
- [ ] "View Market" link works for market-related notifications
- [ ] Notifications are ordered newest first
- [ ] Email contains market details and admin notes
