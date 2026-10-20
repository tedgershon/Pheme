# Feature 11: Real-Time Event Infrastructure — Redis + WebSockets

**Phase:** 5 (depends on all prior phases)
**Dependencies:** All features 01–10 (this layers on top of the complete application)
**Parallelizable with:** Nothing — this is a cross-cutting infrastructure change
**Branch:** `feature/redis-websockets` (non-main; merge only when real-time updates become necessary)

---

## Summary

Replace the current optimistic-local-state + on-demand-refetch model with a push-based real-time architecture. Add a Redis instance for pub/sub event fan-out and response caching. Add a WebSocket endpoint on FastAPI so the frontend receives live updates without polling or manual refresh. Retain optimistic local updates for the acting user; WebSockets add **cross-client synchronization** so that all connected users see changes within seconds.

**This feature also migrates the FastAPI backend from Vercel to Fly.io** to support persistent WebSocket connections. The Next.js frontend remains on Vercel.

---

## Branch Strategy

This feature lives on a **dedicated branch** (`feature/redis-websockets`), not `main`. The current app on `main` works correctly without real-time updates — it uses optimistic local state and on-demand re-fetching. This branch should be merged when:

- The user base grows enough that stale data across clients becomes a real UX problem.
- Live demos require two browsers to stay in sync.
- You want to showcase real-time infrastructure on your resume.

The branch includes **two categories of changes:**
1. **Backend migration** — move FastAPI from Vercel serverless to Fly.io persistent hosting.
2. **Real-time layer** — add Redis, WebSocket endpoint, and frontend integration.

Both happen together because moving the backend is a prerequisite for WebSockets (Vercel serverless cannot hold long-lived connections).

---

## Current State

- `DataProvider.tsx` loads all markets, bets, and transactions **once on mount**.
- After a user action (bet, resolve, dispute), the acting client applies an **optimistic local state patch** and sometimes fires a targeted re-fetch (e.g., `listBetsForMarket`).
- **No other connected client is notified.** If User A places a bet, User B sees stale pool totals until they navigate away and remount, or perform their own action.
- Two queries currently use TanStack Query's `refetchInterval: 30_000` as a stopgap for live data:
  - The resolutions list — `frontend/src/app/resolutions/page.tsx`
  - The notification unread-count badge — `frontend/src/lib/query/queries/notifications.ts`
  These polls are the **only** automatic background fetches in the app. Every other view relies on mount, `refetchOnWindowFocus`, or post-mutation `qc.invalidateQueries` calls. **This feature removes both polls** — WebSocket events become the single mechanism for automatic updates across the codebase.
- No Redis dependency exists in the project.
- Both frontend and backend are deployed on **Vercel**.

### Why Vercel Can't Support This Feature

Vercel runs backend code as **serverless functions** — each request spins up an isolated instance that terminates after responding. WebSockets require a long-lived process to hold the bidirectional connection. Vercel functions time out after 10–60 seconds and have no persistent memory between invocations. The `ConnectionManager` pattern — which holds WebSocket connections in memory and listens to Redis pub/sub in a background task — is fundamentally incompatible with serverless.

**Solution:** Migrate the FastAPI backend to **Fly.io**, which runs persistent containers. The frontend stays on Vercel (Next.js on Vercel is ideal and doesn't need to move).

---

## Architecture Overview

```
┌─────────────┐        ┌──────────────────────────┐        ┌─────────────┐
│  Next.js     │──REST──►│  FastAPI on Fly.io        │◄──────►│  Redis      │
│  Frontend    │        │  (persistent process)     │        │  (Upstash   │
│  (Vercel)    │        │                          │        │   or Fly)   │
│              │        │  ┌────────────────────┐  │        │             │
│  WebSocket   │◄──ws──►│  │ ConnectionManager  │  │        │  pub/sub    │
│  Provider    │        │  │ (rooms + users)    │◄─┼──sub──►│  cache      │
│              │        │  └────────────────────┘  │        │  rate-limit │
│  useMarket   │        │                          │        └─────────────┘
│  Updates()   │        │  REST routers publish     │
│              │        │  events after mutations   │        ┌─────────────┐
│  useRealTime │        │                          │◄──────►│  Supabase   │
│  Notifs()    │        │  /ws endpoint serves      │        │  (Postgres) │
│              │        │  WebSocket connections    │        └─────────────┘
└─────────────┘        └──────────────────────────┘
```

**Key design decisions:**
- **One backend serves both REST and WebSocket.** No relay service, no split architecture. REST endpoints and the `/ws` endpoint live in the same FastAPI process.
- REST endpoints remain the source of truth for mutations. WebSockets are read-only push channels.
- The frontend connects to **one backend URL** for both REST (`https://`) and WebSocket (`wss://`) traffic.
- Redis pub/sub enables horizontal scaling: if you later run multiple Fly.io instances, events published by Instance A reach WebSocket clients on Instance B.
- **WebSockets are the default automatic-update mechanism.** After this feature, **no query in the codebase uses `refetchInterval`**. TanStack Query refetches are triggered by exactly three things: (a) initial mount / route prefetch, (b) `refetchOnWindowFocus` returning to a stale tab, and (c) `qc.invalidateQueries` calls fired by WebSocket event handlers. Background polling is not used anywhere — any new "live" surface added later must publish a Redis event and listen on the WS channel rather than introducing a `setInterval` or `refetchInterval`.

---

## Backend Migration: Vercel → Fly.io

### Why Fly.io

- Persistent containers (not serverless) — supports WebSocket connections and background tasks.
- Free tier includes 3 shared-CPU VMs with 256MB RAM each — sufficient for this app.
- Built-in load balancing across instances when you scale.
- Simple deployment from a Dockerfile via `fly deploy`.
- Supports Redis as a managed add-on (Upstash integration) or you can use external Upstash.

### Migration Steps

1. **Create a `Dockerfile`** in `backend/`:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

2. **Initialize Fly.io app:**

```bash
cd backend
fly launch --name bananagains-api
```

3. **Set secrets** (equivalent to Vercel environment variables):

```bash
fly secrets set \
  SUPABASE_URL=https://xxx.supabase.co \
  SUPABASE_KEY=eyJ... \
  SUPABASE_JWT_SECRET=xxx \
  REDIS_URL=rediss://default:xxx@us1-xxx.upstash.io:6379 \
  CORS_ORIGINS=https://bananagains.vercel.app
```

4. **Deploy:**

```bash
fly deploy
```

5. **Update frontend environment variable** in Vercel:

```
NEXT_PUBLIC_API_URL=https://bananagains-api.fly.dev
```

The frontend's `api.ts` already reads `NEXT_PUBLIC_API_URL` — no code change needed, just the env var.

6. **Remove or disable the Vercel backend deployment** (the FastAPI project on Vercel). The frontend Vercel project stays.

### What Changes in the Backend Code

Nothing, for the migration itself. The FastAPI app runs the same code on Fly.io as it did on Vercel. The Dockerfile just wraps it in a container. All the Redis + WebSocket additions (below) are layered on top.

---

## Redis Roles

**Provider:** Use **Upstash Redis** (serverless-friendly managed Redis with a generous free tier). Provision via the Upstash console or Fly.io's Upstash integration (`fly redis create`). Set `REDIS_URL` to the standard Redis protocol connection string.

### 1. Pub/Sub Event Fan-Out

When a mutation occurs (bet placed, market resolved, vote cast), the REST endpoint handler publishes a lightweight event to a Redis channel. The `ConnectionManager` subscribes to relevant channels and forwards events to connected WebSocket clients.

**Channels:**

| Channel Pattern | Published When | Payload |
|---|---|---|
| `market:{id}` | Bet placed, market status change, pool update | `{ type, market_id, data }` |
| `market:{id}:votes` | Community vote cast on this market | `{ type, market_id, yes_count, no_count }` |
| `global:markets` | New market approved, market resolved | `{ type, market_id, status }` |
| `global:leaderboard` | Market resolved (payouts changed balances) | `{ type }` |
| `user:{id}` | Notification created for this user | `{ type, notification }` |

### 2. Response Caching

Cache expensive read-only queries with short TTLs to reduce Supabase load.

| Cache Key | Source Endpoint | TTL | Invalidated By |
|---|---|---|---|
| `cache:markets:hot` | `GET /api/markets/hot` | 10s | Any bet placement |
| `cache:markets:trending` | `GET /api/markets/trending` | 30s | New market approval, bet |
| `cache:markets:top` | `GET /api/markets/top` | 30s | Any bet placement |
| `cache:leaderboard:weekly` | `GET /api/leaderboard/weekly` | 60s | Market resolution |

Cache invalidation strategy: **TTL-based with event-driven early invalidation.** When a bet is placed, delete the `cache:markets:hot` key so the next request rebuilds it. If no invalidation event occurs, the TTL expires naturally.

### 3. Rate Limiting

Sliding window counters per user per endpoint, stored in Redis.

| Endpoint | Limit | Window |
|---|---|---|
| `POST /api/markets/{id}/bets` | 10 requests | 60 seconds |
| `POST /api/markets` | 5 requests | 24 hours |
| `POST /api/auth/claim-daily` | 1 request | 24 hours (already enforced by DB, Redis is defense-in-depth) |
| `POST /api/markets/{id}/community-vote` | 1 request | per market (already enforced by DB unique constraint) |
| WebSocket connections | 3 concurrent | per user |

---

## Backend Changes

### New Dependency

Add `redis>=5.0.0` to `backend/requirements.txt`:

```
redis>=5.0.0
```

Redis 5.x is the modern async-native client (formerly `aioredis` was separate; it merged into `redis-py` in v4.2+).

### Configuration Changes

**Modify:** `backend/config.py`

```python
class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_jwt_secret: str = ""

    redis_url: str = "redis://localhost:6379/0"

    cors_origins: list[str] = ["http://localhost:3000"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}
```

Add `REDIS_URL` to `backend/.env`:
```
REDIS_URL=redis://localhost:6379/0
```

### New File: `backend/redis_client.py`

Manages the async Redis connection pool and provides publish/cache helpers.

```python
import json
import redis.asyncio as redis
from config import get_settings

_pool: redis.Redis | None = None


async def get_redis() -> redis.Redis:
    global _pool
    if _pool is None:
        _pool = redis.from_url(
            get_settings().redis_url,
            decode_responses=True,
        )
    return _pool


async def close_redis():
    global _pool
    if _pool:
        await _pool.aclose()
        _pool = None


async def publish_event(channel: str, event: dict):
    r = await get_redis()
    await r.publish(channel, json.dumps(event))


async def cache_get(key: str) -> dict | list | None:
    r = await get_redis()
    raw = await r.get(key)
    if raw is None:
        return None
    return json.loads(raw)


async def cache_set(key: str, value, ttl_seconds: int):
    r = await get_redis()
    await r.set(key, json.dumps(value), ex=ttl_seconds)


async def cache_delete(key: str):
    r = await get_redis()
    await r.delete(key)


async def rate_limit_check(key: str, limit: int, window_seconds: int) -> bool:
    """Returns True if the request is allowed, False if rate-limited."""
    r = await get_redis()
    current = await r.incr(key)
    if current == 1:
        await r.expire(key, window_seconds)
    return current <= limit
```

### New File: `backend/ws_manager.py`

WebSocket connection manager with Redis pub/sub integration.

```python
import asyncio
import json
import redis.asyncio as redis
from fastapi import WebSocket
from redis_client import get_redis

class ConnectionManager:
    def __init__(self):
        self._market_rooms: dict[str, set[WebSocket]] = {}
        self._user_channels: dict[str, set[WebSocket]] = {}
        self._global_clients: set[WebSocket] = set()
        self._pubsub: redis.client.PubSub | None = None
        self._listener_task: asyncio.Task | None = None

    async def start(self):
        """Start the Redis pub/sub listener. Call once at app startup."""
        r = await get_redis()
        self._pubsub = r.pubsub()
        await self._pubsub.psubscribe(
            "market:*",
            "global:*",
            "user:*",
        )
        self._listener_task = asyncio.create_task(self._listen())

    async def stop(self):
        if self._listener_task:
            self._listener_task.cancel()
        if self._pubsub:
            await self._pubsub.unsubscribe()
            await self._pubsub.aclose()

    async def _listen(self):
        """Background task: read Redis pub/sub messages and fan out to WebSockets."""
        try:
            async for message in self._pubsub.listen():
                if message["type"] not in ("message", "pmessage"):
                    continue

                channel = message.get("channel", "")
                data = message.get("data", "")

                if isinstance(data, str):
                    try:
                        payload = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                else:
                    continue

                await self._route_message(channel, payload)
        except asyncio.CancelledError:
            pass

    async def _route_message(self, channel: str, payload: dict):
        targets: set[WebSocket] = set()

        if channel.startswith("market:"):
            parts = channel.split(":")
            market_id = parts[1] if len(parts) >= 2 else None
            if market_id and market_id in self._market_rooms:
                targets = self._market_rooms[market_id]

        elif channel.startswith("global:"):
            targets = self._global_clients

        elif channel.startswith("user:"):
            user_id = channel.split(":")[1] if ":" in channel else None
            if user_id and user_id in self._user_channels:
                targets = self._user_channels[user_id]

        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self._remove_connection(ws)

    def _remove_connection(self, ws: WebSocket):
        self._global_clients.discard(ws)
        for room in self._market_rooms.values():
            room.discard(ws)
        for ch in self._user_channels.values():
            ch.discard(ws)

    def connect_global(self, ws: WebSocket):
        self._global_clients.add(ws)

    def subscribe_market(self, ws: WebSocket, market_id: str):
        self._market_rooms.setdefault(market_id, set()).add(ws)

    def unsubscribe_market(self, ws: WebSocket, market_id: str):
        if market_id in self._market_rooms:
            self._market_rooms[market_id].discard(ws)

    def subscribe_user(self, ws: WebSocket, user_id: str):
        self._user_channels.setdefault(user_id, set()).add(ws)

    def disconnect(self, ws: WebSocket):
        self._remove_connection(ws)


manager = ConnectionManager()
```

### New File: `backend/routers/ws.py`

WebSocket endpoint. Accepts subscription commands from the client to join/leave market rooms.

```python
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from dependencies import get_supabase_client
from ws_manager import manager

router = APIRouter(tags=["websocket"])


def _authenticate_ws(token: str, supabase) -> dict | None:
    """Validate a Supabase JWT and return the profile, or None."""
    try:
        user_response = supabase.auth.get_user(token)
        user = user_response.user
        if user is None:
            return None
        profile = (
            supabase.table("profiles")
            .select("id, andrew_id, display_name, role")
            .eq("id", user.id)
            .single()
            .execute()
        )
        return profile.data
    except Exception:
        return None


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    supabase = get_supabase_client()
    user: dict | None = None

    manager.connect_global(ws)

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"error": "invalid JSON"})
                continue

            action = msg.get("action")

            if action == "auth":
                token = msg.get("token")
                if token:
                    user = _authenticate_ws(token, supabase)
                    if user:
                        manager.subscribe_user(ws, user["id"])
                        await ws.send_json({
                            "type": "auth_ok",
                            "user_id": user["id"],
                        })
                    else:
                        await ws.send_json({"type": "auth_fail"})

            elif action == "subscribe_market":
                market_id = msg.get("market_id")
                if market_id:
                    manager.subscribe_market(ws, market_id)
                    await ws.send_json({
                        "type": "subscribed",
                        "market_id": market_id,
                    })

            elif action == "unsubscribe_market":
                market_id = msg.get("market_id")
                if market_id:
                    manager.unsubscribe_market(ws, market_id)

            elif action == "ping":
                await ws.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(ws)
```

### Modify: `backend/main.py`

Register the WebSocket router and manage the `ConnectionManager` and Redis lifecycle via FastAPI's lifespan.

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from redis_client import close_redis
from routers import auth, bets, leaderboard, markets, portfolio, ws
from ws_manager import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    await manager.start()
    yield
    await manager.stop()
    await close_redis()


app = FastAPI(title="Pheme API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(markets.router)
app.include_router(bets.router)
app.include_router(portfolio.router)
app.include_router(leaderboard.router)
app.include_router(ws.router)


@app.get("/")
def health_check():
    return {"status": "ok", "service": "bananagains-api"}
```

### Modify: `backend/routers/bets.py` — Publish Events After Bet

After a successful `place_bet` RPC call, publish the updated pool totals to the market channel so all subscribers see the new probability instantly.

```python
from redis_client import publish_event, cache_delete

@router.post("/{market_id}/bets", ...)
async def place_bet(...):
    # ... existing RPC call ...

    # After successful bet, fetch updated pool totals and broadcast
    updated = (
        supabase.table("markets")
        .select("yes_pool_total, no_pool_total, status")
        .eq("id", market_id)
        .single()
        .execute()
    )
    if updated.data:
        await publish_event(f"market:{market_id}", {
            "type": "market.pool_update",
            "market_id": market_id,
            "yes_pool_total": updated.data["yes_pool_total"],
            "no_pool_total": updated.data["no_pool_total"],
        })

    await cache_delete("cache:markets:hot")
    await cache_delete("cache:markets:trending")
    await cache_delete("cache:markets:top")

    return result.data
```

Apply the same pattern to every mutation endpoint:

| Endpoint | Event Published | Channel |
|---|---|---|
| `POST /api/markets/{id}/bets` | `market.pool_update` | `market:{id}` |
| `POST /api/markets/{id}/resolve` | `market.status_change` | `market:{id}`, `global:markets` |
| `POST /api/markets/{id}/dispute` | `market.status_change` | `market:{id}` |
| `POST /api/markets/{id}/dispute/vote` | `market.vote_update` | `market:{id}` |
| `POST /api/markets/{id}/community-vote` | `market.vote_update` | `market:{id}:votes` |
| `POST /api/admin/markets/{id}/approve` | `market.approved` | `global:markets`, `user:{creator_id}` |
| `POST /api/admin/markets/{id}/deny` | `market.denied` | `user:{creator_id}` |
| `POST /api/admin/markets/{id}/backroll` | `market.status_change` | `market:{id}` |
| Market finalization (lazy transition) | `market.resolved` + `global:leaderboard` | `market:{id}`, `global:leaderboard` |
| Notification creation (any trigger) | `notification.new` | `user:{user_id}` |

### Modify: Existing Endpoints — Add Response Caching

Example for `GET /api/markets/hot`:

```python
from redis_client import cache_get, cache_set

@router.get("/hot", response_model=list[MarketResponse])
async def get_hot_markets(...):
    cached = await cache_get("cache:markets:hot")
    if cached is not None:
        return cached

    # ... existing query logic ...

    result = _apply_lazy_transitions(markets[:limit], supabase)
    await cache_set("cache:markets:hot", result, ttl_seconds=10)
    return result
```

### New Middleware: Rate Limiting

**New file:** `backend/middleware/rate_limit.py`

```python
from fastapi import Request, HTTPException
from redis_client import rate_limit_check


async def check_rate_limit(
    request: Request,
    key_prefix: str,
    limit: int,
    window: int,
):
    user = getattr(request.state, "current_user", None)
    identifier = user["id"] if user else request.client.host
    key = f"ratelimit:{key_prefix}:{identifier}"
    allowed = await rate_limit_check(key, limit, window)
    if not allowed:
        raise HTTPException(429, "Rate limit exceeded. Try again later.")
```

Add rate limit calls at the top of mutation endpoints:

```python
@router.post("/{market_id}/bets", ...)
async def place_bet(..., request: Request):
    await check_rate_limit(request, "place_bet", limit=10, window=60)
    # ... rest of handler ...
```

---

## Frontend Changes

### New File: `frontend/src/lib/WebSocketProvider.tsx`

Context provider that manages a single WebSocket connection per session. Exposes hooks for subscribing to market updates and real-time notifications.

```tsx
"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "./supabase";

type EventHandler = (event: Record<string, unknown>) => void;

interface WSContextValue {
  connected: boolean;
  subscribeMarket: (marketId: string) => void;
  unsubscribeMarket: (marketId: string) => void;
  addListener: (type: string, handler: EventHandler) => () => void;
}

const WSCtx = createContext<WSContextValue>({
  connected: false,
  subscribeMarket: () => {},
  unsubscribeMarket: () => {},
  addListener: () => () => {},
});

export function useWebSocket() {
  return useContext(WSCtx);
}

// Same backend as REST, just over ws:// instead of http://
const WS_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000")
  .replace(/^http/, "ws") + "/ws";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 30000;

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const [connected, setConnected] = useState(false);
  const reconnectDelay = useRef(RECONNECT_BASE_MS);
  const subscribedMarkets = useRef<Set<string>>(new Set());

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = async () => {
      setConnected(true);
      reconnectDelay.current = RECONNECT_BASE_MS;

      if (supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          ws.send(JSON.stringify({
            action: "auth",
            token: session.access_token,
          }));
        }
      }

      for (const marketId of subscribedMarkets.current) {
        ws.send(JSON.stringify({
          action: "subscribe_market",
          market_id: marketId,
        }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const type = payload.type as string;
        const handlers = listenersRef.current.get(type);
        if (handlers) {
          for (const handler of handlers) {
            handler(payload);
          }
        }
        const wildcardHandlers = listenersRef.current.get("*");
        if (wildcardHandlers) {
          for (const handler of wildcardHandlers) {
            handler(payload);
          }
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setTimeout(() => {
        reconnectDelay.current = Math.min(
          reconnectDelay.current * 2,
          RECONNECT_MAX_MS,
        );
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      send({ action: "ping" });
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [send]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const subscribeMarket = useCallback((marketId: string) => {
    subscribedMarkets.current.add(marketId);
    send({ action: "subscribe_market", market_id: marketId });
  }, [send]);

  const unsubscribeMarket = useCallback((marketId: string) => {
    subscribedMarkets.current.delete(marketId);
    send({ action: "unsubscribe_market", market_id: marketId });
  }, [send]);

  const addListener = useCallback(
    (type: string, handler: EventHandler): (() => void) => {
      if (!listenersRef.current.has(type)) {
        listenersRef.current.set(type, new Set());
      }
      listenersRef.current.get(type)!.add(handler);
      return () => {
        listenersRef.current.get(type)?.delete(handler);
      };
    },
    [],
  );

  return (
    <WSCtx.Provider
      value={{ connected, subscribeMarket, unsubscribeMarket, addListener }}
    >
      {children}
    </WSCtx.Provider>
  );
}
```

### New File: `frontend/src/lib/useMarketUpdates.ts`

Hook for components that need live market data.

```typescript
import { useEffect } from "react";
import { useWebSocket } from "./WebSocketProvider";

export function useMarketUpdates(
  marketId: string,
  onPoolUpdate: (data: { yes_pool_total: number; no_pool_total: number }) => void,
  onStatusChange?: (data: { status: string; resolved_outcome?: string }) => void,
  onVoteUpdate?: (data: { yes_count: number; no_count: number }) => void,
) {
  const { subscribeMarket, unsubscribeMarket, addListener } = useWebSocket();

  useEffect(() => {
    subscribeMarket(marketId);
    return () => unsubscribeMarket(marketId);
  }, [marketId, subscribeMarket, unsubscribeMarket]);

  useEffect(() => {
    const removals: (() => void)[] = [];

    removals.push(
      addListener("market.pool_update", (event) => {
        if (event.market_id === marketId) {
          onPoolUpdate({
            yes_pool_total: event.yes_pool_total as number,
            no_pool_total: event.no_pool_total as number,
          });
        }
      }),
    );

    if (onStatusChange) {
      removals.push(
        addListener("market.status_change", (event) => {
          if (event.market_id === marketId) {
            onStatusChange({
              status: event.status as string,
              resolved_outcome: event.resolved_outcome as string | undefined,
            });
          }
        }),
      );
    }

    if (onVoteUpdate) {
      removals.push(
        addListener("market.vote_update", (event) => {
          if (event.market_id === marketId) {
            onVoteUpdate({
              yes_count: event.yes_count as number,
              no_count: event.no_count as number,
            });
          }
        }),
      );
    }

    return () => removals.forEach((r) => r());
  }, [marketId, onPoolUpdate, onStatusChange, onVoteUpdate, addListener]);
}
```

### New File: `frontend/src/lib/useRealtimeNotifications.ts`

Hook for the notification indicator in the user menu.

```typescript
import { useEffect, useState } from "react";
import { useWebSocket } from "./WebSocketProvider";

export function useRealtimeNotifications(
  onNewNotification?: (notification: Record<string, unknown>) => void,
) {
  const { addListener } = useWebSocket();
  const [unreadDelta, setUnreadDelta] = useState(0);

  useEffect(() => {
    const remove = addListener("notification.new", (event) => {
      setUnreadDelta((prev) => prev + 1);
      onNewNotification?.(event.notification as Record<string, unknown>);
    });
    return remove;
  }, [addListener, onNewNotification]);

  const resetDelta = () => setUnreadDelta(0);

  return { unreadDelta, resetDelta };
}
```

### Modify: `frontend/src/app/layout.tsx`

Wrap the app with `WebSocketProvider` (inside `SessionProvider`, outside `DataProvider`):

```tsx
<SessionProvider>
  <WebSocketProvider>
    <DataProvider>
      {children}
    </DataProvider>
  </WebSocketProvider>
</SessionProvider>
```

### Modify: `frontend/src/app/markets/[id]/page.tsx`

Integrate `useMarketUpdates` to receive live pool updates:

```tsx
import { useMarketUpdates } from "@/lib/useMarketUpdates";

// Inside the component, after market state is established:
useMarketUpdates(
  id,
  useCallback((data) => {
    setFetchedMarket((prev) =>
      prev ? { ...prev, ...data } : prev,
    );
  }, []),
  useCallback((data) => {
    setFetchedMarket((prev) =>
      prev ? { ...prev, ...data } : prev,
    );
  }, []),
);
```

### Modify: `frontend/src/lib/DataProvider.tsx`

Add a global listener for market-level events to keep the markets array current:

```tsx
import { useWebSocket } from "./WebSocketProvider";

// Inside DataProvider:
const { addListener } = useWebSocket();

useEffect(() => {
  const removePoolListener = addListener("market.pool_update", (event) => {
    const mid = event.market_id as string;
    setMarkets((prev) =>
      prev.map((m) =>
        m.id === mid
          ? {
              ...m,
              yes_pool_total: event.yes_pool_total as number,
              no_pool_total: event.no_pool_total as number,
            }
          : m,
      ),
    );
  });

  const removeStatusListener = addListener("market.status_change", (event) => {
    const mid = event.market_id as string;
    setMarkets((prev) =>
      prev.map((m) =>
        m.id === mid ? { ...m, status: event.status as string } : m,
      ),
    );
  });

  return () => {
    removePoolListener();
    removeStatusListener();
  };
}, [addListener]);
```

---

## Retiring Existing `refetchInterval` Polls

This feature **removes the two `refetchInterval: 30_000` calls** currently in the codebase and replaces them with WebSocket-driven cache invalidation. Both must be removed in the same change set as the WebSocket layer is added — leaving them in place would mean the app polls *and* pushes, which defeats the point.

### 1. Resolutions list — `frontend/src/app/resolutions/page.tsx`

**Today:**

```tsx
const { data: markets = [], isLoading } = useQuery({
  ...resolutionMarketsQuery(),
  refetchInterval: 30_000,
});
```

**After this feature:**

```tsx
const { data: markets = [], isLoading } = useQuery(resolutionMarketsQuery());
```

The freshness comes from a global WS listener (registered once in `WebSocketProvider` or a sibling hook) that invalidates the resolutions key whenever an event arrives that could change which markets belong on this page:

```tsx
useEffect(() => {
  const removals = [
    addListener("market.status_change", () => {
      qc.invalidateQueries({ queryKey: queryKeys.markets.resolutions });
    }),
    addListener("market.vote_update", () => {
      qc.invalidateQueries({ queryKey: queryKeys.markets.resolutions });
    }),
    addListener("market.resolved", () => {
      qc.invalidateQueries({ queryKey: queryKeys.markets.resolutions });
    }),
  ];
  return () => removals.forEach((r) => r());
}, [addListener, qc]);
```

The 1-second `setInterval` countdown timer in the same file (`useResolutionCountdown`) **stays** — it is purely a UI string formatter (`"2h 14m 03s"`) and does not fetch anything.

### 2. Notification unread-count badge — `frontend/src/lib/query/queries/notifications.ts`

**Today:**

```ts
queryOptions({
  queryKey: queryKeys.notifications.unreadCount,
  queryFn: () => api.getUnreadNotificationCount(),
  staleTime: STALE.NOTIFICATIONS,
  refetchInterval: 30_000,
});
```

**After this feature:**

```ts
queryOptions({
  queryKey: queryKeys.notifications.unreadCount,
  queryFn: () => api.getUnreadNotificationCount(),
  staleTime: STALE.NOTIFICATIONS,
});
```

The `useRealtimeNotifications` hook described above subscribes to `notification.new` and either bumps the cached count via `qc.setQueryData` or invalidates `queryKeys.notifications.unreadCount` to force a refetch. Marking notifications as read continues to invalidate via the existing `invalidateAfterNotificationsRead` helper.

### 3. Surfaces that don't poll today but should also be live

The same WebSocket-first principle applies to the views that have no polling today and rely on stale-time + window-focus refetch. After this feature they get pushed updates too — no `refetchInterval` is added to any of them:

| View | File | Driving event(s) | Action |
|---|---|---|---|
| Markets dashboard list | `frontend/src/app/markets/markets-client.tsx` | `market.pool_update`, `market.status_change`, `market.approved` | Global listener invalidates `queryKeys.markets.list(...)` |
| Market detail page | `frontend/src/app/markets/[id]/detail-client.tsx` | `market.pool_update`, `market.status_change`, `market.vote_update` | `useMarketUpdates(id, ...)` (defined above) |
| Hot / Trending / Top sections | same as dashboard | `market.pool_update` | Global listener invalidates `queryKeys.markets.hot/trending/top` |
| Leaderboard | `frontend/src/app/leaderboard/...` | `leaderboard.update` | Global listener invalidates leaderboard keys |

### Lint-level guard against regressions

Add a project-level rule (ESLint custom rule, `rg` check in CI, or a comment in `frontend/src/lib/query/staleTimes.ts`) that flags any new `refetchInterval` usage. The chosen mechanism is up to the implementer; the requirement is that re-introducing background polling be a deliberate, reviewed exception rather than a silent default.

---

## Graceful Degradation

The WebSocket connection is **optional**. If Redis is unavailable or the WebSocket fails to connect:

1. The frontend falls back to the existing behavior (optimistic local state, no cross-client sync).
2. REST endpoints continue to work normally — Redis caching and event publishing are wrapped in try/except and silently degrade.
3. Rate limiting falls back to no enforcement (the DB-level constraints still prevent abuse like double daily claims or duplicate votes).

Implementation: wrap all `publish_event`, `cache_get`, `cache_set`, and `rate_limit_check` calls in try/except blocks in the backend:

```python
async def safe_publish(channel: str, event: dict):
    try:
        await publish_event(channel, event)
    except Exception:
        pass  # Redis unavailable; degrade silently
```

---

## Local Development Setup

For local development, you run **four things** (three existing + one new):

| Terminal | Command | Port |
|---|---|---|
| 1 | `cd backend && uvicorn main:app --reload` | 8000 |
| 2 | `cd frontend && pnpm dev` | 3000 |
| 3 | Redis server | 6379 |

No separate relay service needed — the backend serves both REST and WebSocket on port 8000.

### Redis

**Option A: Docker (recommended)**
```bash
docker run -d --name bananagains-redis -p 6379:6379 redis:7-alpine
```

**Option B: Native install**
- macOS: `brew install redis && brew services start redis`
- Ubuntu: `sudo apt install redis-server && sudo systemctl start redis`
- Windows: Use WSL2 or Docker Desktop

### Verify

```bash
redis-cli ping
# → PONG
```

### Environment

Add to `backend/.env`:
```
REDIS_URL=redis://localhost:6379/0
```

---

## Deployment

After this feature, Pheme runs on two platforms:

| Service | Platform | URL |
|---|---|---|
| Frontend (Next.js) | Vercel | `https://bananagains.vercel.app` (unchanged) |
| Backend (FastAPI) | Fly.io | `https://bananagains-api.fly.dev` (migrated from Vercel) |
| Redis | Upstash | Managed (new) |

### 1. Provision Upstash Redis

Option A: Via Upstash console (https://console.upstash.com) — create a free Redis database, copy the `redis://` connection string.

Option B: Via Fly.io CLI:
```bash
fly redis create
```

Set `REDIS_URL` as a Fly.io secret:
```bash
fly secrets set REDIS_URL=rediss://default:xxx@fly-bananagains-redis.upstash.io:6379
```

### 2. Deploy Backend to Fly.io

```bash
cd backend
fly launch --name bananagains-api
fly secrets set \
  SUPABASE_URL=https://xxx.supabase.co \
  SUPABASE_KEY=eyJ... \
  SUPABASE_JWT_SECRET=xxx \
  REDIS_URL=rediss://... \
  CORS_ORIGINS=https://bananagains.vercel.app
fly deploy
```

Fly.io reads the `Dockerfile` in `backend/` and builds/deploys automatically.

### 3. Update Frontend Environment Variable

In Vercel, update `NEXT_PUBLIC_API_URL`:

```
NEXT_PUBLIC_API_URL=https://bananagains-api.fly.dev
```

The `WebSocketProvider` derives the WS URL from this same variable (`http` → `ws`, `https` → `wss`), so no additional env var is needed.

### 4. Remove Vercel Backend Deployment

Disable or delete the FastAPI project on Vercel. The frontend Vercel project stays.

### Scaling

**Horizontal scaling** (multiple backend instances):

```bash
fly scale count 3
```

Redis pub/sub automatically handles fan-out across instances: a bet placed on Instance A publishes to Redis, and Instance B's `ConnectionManager` receives the event and pushes to its local WebSocket clients. No sticky sessions required — WebSocket connections re-authenticate and re-subscribe on reconnect.

**Vertical scaling** (bigger machines):

```bash
fly scale vm shared-cpu-2x
```

---

## README Update

Add the following to `README.md`:

**Redis (required for real-time features):**

```bash
# Docker (recommended)
docker run -d --name bananagains-redis -p 6379:6379 redis:7-alpine

# Verify
redis-cli ping   # → PONG
```

Add `REDIS_URL=redis://localhost:6379/0` to `backend/.env`.

Without Redis running, the app still works — REST endpoints function normally and the frontend falls back to its existing behavior — but real-time push updates (live probability changes, instant notifications, leaderboard sync) will be disabled.

**Production deployment:**

The backend is deployed on Fly.io (persistent hosting for WebSocket support). The frontend remains on Vercel. Both connect to Upstash Redis for real-time event fan-out. See `features/extension/11-redis-websockets.md` for full deployment instructions.

---

## Event Schema Reference

All events sent over WebSocket follow this shape:

```typescript
interface WSEvent {
  type: string;           // e.g., "market.pool_update"
  market_id?: string;     // present for market-scoped events
  [key: string]: unknown; // event-specific fields
}
```

### Event Types

| Type | Fields | Trigger |
|---|---|---|
| `auth_ok` | `user_id` | Successful WebSocket auth |
| `auth_fail` | — | Invalid token |
| `subscribed` | `market_id` | Market subscription confirmed |
| `pong` | — | Response to heartbeat ping |
| `market.pool_update` | `market_id`, `yes_pool_total`, `no_pool_total` | Bet placed |
| `market.status_change` | `market_id`, `status`, `resolved_outcome?` | Status transition |
| `market.vote_update` | `market_id`, `yes_count`, `no_count` | Community or dispute vote cast |
| `market.approved` | `market_id`, `title` | Admin approved a market |
| `market.denied` | `market_id` | Admin denied a market |
| `notification.new` | `notification` (full object) | Any notification trigger |
| `leaderboard.update` | — | Market resolved, payouts distributed |

---

## Files Affected

| Area | File | Change |
|---|---|---|
| Backend (new) | `backend/Dockerfile` | Container image for Fly.io deployment |
| Backend (new) | `backend/redis_client.py` | Redis connection pool, pub/sub, cache, rate limit helpers |
| Backend (new) | `backend/ws_manager.py` | WebSocket ConnectionManager with Redis pub/sub listener |
| Backend (new) | `backend/routers/ws.py` | `/ws` WebSocket endpoint |
| Backend (new) | `backend/middleware/rate_limit.py` | Rate limiting middleware using Redis sliding window |
| Backend (modify) | `backend/main.py` | Lifespan events, register WS router |
| Backend (modify) | `backend/config.py` | Add `redis_url` setting |
| Backend (modify) | `backend/requirements.txt` | Add `redis>=5.0.0` |
| Backend (modify) | `backend/routers/bets.py` | Publish `market.pool_update` after bet, cache invalidation |
| Backend (modify) | `backend/routers/markets.py` | Publish status changes, cache hot/trending/top queries |
| Backend (modify) | `backend/routers/leaderboard.py` | Cache weekly leaderboard |
| Frontend (new) | `frontend/src/lib/WebSocketProvider.tsx` | WebSocket context with auto-reconnect |
| Frontend (new) | `frontend/src/lib/useMarketUpdates.ts` | Hook for per-market live updates |
| Frontend (new) | `frontend/src/lib/useRealtimeNotifications.ts` | Hook for live notification delivery |
| Frontend (modify) | `frontend/src/app/layout.tsx` | Wrap app in `WebSocketProvider` |
| Frontend (modify) | `frontend/src/app/markets/[id]/detail-client.tsx` | Integrate `useMarketUpdates` |
| Frontend (modify) | `frontend/src/app/markets/markets-client.tsx` | Add global listeners that invalidate dashboard query keys |
| Frontend (modify) | `frontend/src/app/resolutions/page.tsx` | **Remove `refetchInterval: 30_000`**, drive list updates from `market.status_change` / `market.vote_update` / `market.resolved` events |
| Frontend (modify) | `frontend/src/lib/query/queries/notifications.ts` | **Remove `refetchInterval: 30_000`**, drive unread count from `notification.new` events via `useRealtimeNotifications` |
| Docs (modify) | `README.md` | Add Redis setup, Fly.io deployment notes; note that WebSockets are the default automatic-update mechanism |

---

## Testing Checklist

### WebSocket Connection
- [ ] Frontend connects to `/ws` on page load
- [ ] Connection authenticates with Supabase JWT
- [ ] Heartbeat ping/pong keeps connection alive
- [ ] Auto-reconnects with exponential backoff after disconnect
- [ ] Multiple tabs each maintain their own connection
- [ ] Connection limit (3 per user) is enforced

### Market Updates
- [ ] Open two browsers on the same market detail page
- [ ] Place a bet in Browser A → Browser B sees updated pool totals and probability within 1 second
- [ ] Place a bet in Browser A → Browser B's probability chart does NOT re-render (only the numeric displays update; chart updates on next full fetch)
- [ ] Market status change (close, resolve) propagates to all viewers

### Resolution Voting
- [ ] Open the Resolutions page in two browsers
- [ ] Cast a community vote in Browser A → Browser B sees updated vote counts within 1 second
- [ ] A market entering `pending_resolution` (e.g., its `close_at` elapses and a normalize call closes it, then the creator starts community resolution) appears on the Resolutions page in another open browser within 1 second, without that browser polling

### Notifications
- [ ] Admin approves a market → creator receives a real-time notification without page refresh
- [ ] Notification indicator dot appears on the avatar immediately
- [ ] Unread-count badge increments via `notification.new` event, not via a 30-second poll (verify in the Network tab that no periodic `GET /api/notifications/unread-count` requests fire while the page is idle)

### No Background Polling Remains
- [ ] `rg "refetchInterval" frontend/src` returns **zero** matches after this feature ships
- [ ] Sitting on `/resolutions` with the Network tab open shows no periodic REST requests; updates arrive only over the WebSocket
- [ ] Sitting on any page with the notification bell visible shows no periodic `GET /api/notifications/unread-count`; the count updates only when a `notification.new` event arrives

### Leaderboard
- [ ] Market resolves → leaderboard page updates within 2 seconds for all viewers

### Caching
- [ ] First request to `/api/markets/hot` hits Postgres; second request within 10s returns cached result
- [ ] Placing a bet invalidates the hot markets cache
- [ ] Cache miss after TTL expiry returns fresh data

### Rate Limiting
- [ ] Placing > 10 bets in 60 seconds returns 429
- [ ] Creating > 5 markets in 24 hours returns 429
- [ ] Rate limit resets after the window expires

### Graceful Degradation
- [ ] Stop Redis → REST endpoints still work (no 500 errors, publish/cache silently skipped)
- [ ] Stop Redis → WebSocket connections stay open but receive no events
- [ ] Restart Redis → pub/sub resumes; new events flow to clients
- [ ] `REDIS_URL` not set → all Redis operations silently no-op; app fully functional without real-time

### Backend Migration
- [ ] FastAPI serves correctly on Fly.io (health check returns 200)
- [ ] Frontend on Vercel connects to Fly.io backend for both REST and WebSocket
- [ ] Supabase auth (JWT validation) works from Fly.io
- [ ] CORS allows requests from the Vercel frontend domain
- [ ] `fly deploy` succeeds from the `backend/` directory

### Horizontal Scaling
- [ ] `fly scale count 2` → two instances running
- [ ] Bet placed on Instance A → WebSocket client on Instance B receives the update via Redis
- [ ] No sticky sessions needed — reconnecting client re-authenticates and re-subscribes

### Performance
- [ ] 50 concurrent WebSocket connections do not degrade API response times
- [ ] Redis memory usage stays under 50MB under normal load
- [ ] No memory leaks from WebSocket connections that disconnect without cleanup
