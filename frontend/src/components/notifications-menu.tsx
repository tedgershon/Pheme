"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  useDeleteNotification,
  useMarkNotificationsRead,
} from "@/lib/query/mutations/notifications";
import {
  notificationsQuery,
  unreadCountQuery,
} from "@/lib/query/queries/notifications";
import type { NotificationResponse } from "@/lib/types";
import { useClickOutside } from "@/lib/use-click-outside";
import { cn } from "@/lib/utils";

function marketHref(n: NotificationResponse): string | null {
  if (typeof n.metadata?.market_id !== "string") return null;
  return n.type === "market_submitted"
    ? `/admin/review?marketId=${n.metadata.market_id}`
    : `/markets/${n.metadata.market_id}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setOpen(false));

  const { data: unread } = useQuery(unreadCountQuery());
  const unreadCount = unread?.count ?? 0;

  const { data: notifications = [], isLoading } = useQuery({
    ...notificationsQuery({ limit: 20 }),
    enabled: open,
  });

  const markAll = useMarkNotificationsRead();
  const remove = useDeleteNotification();

  // auto-mark on open: clears the unread badge as soon as the user sees the list
  // biome-ignore lint/correctness/useExhaustiveDependencies: only fire on open edge
  useEffect(() => {
    if (open && unreadCount > 0) markAll.mutate();
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "relative px-2.5",
        )}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-destructive-foreground ring-2 ring-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 flex w-80 flex-col rounded-xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
          </div>

          <div className="h-72 overflow-y-auto">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <Spinner className="size-5 text-muted-foreground" />
              </div>
            ) : notifications.length === 0 ? (
              <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                No notifications yet.
              </p>
            ) : (
              <ul>
                {notifications.map((n) => {
                  const href = marketHref(n);
                  const busy = remove.isPending && remove.variables === n.id;
                  const inner = (
                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          n.is_read ? "bg-transparent" : "bg-destructive",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-semibold">
                            {n.title}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {timeAgo(n.created_at)}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {n.body}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        title="Delete"
                        disabled={busy}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          remove.mutate(n.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  );

                  const itemClass =
                    "block border-b border-border px-4 py-3 last:border-b-0 transition-colors hover:bg-accent/40";

                  return (
                    <li key={n.id}>
                      {href ? (
                        <Link
                          href={href}
                          onClick={() => setOpen(false)}
                          className={itemClass}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div className={itemClass}>{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
