"use client";

import {
  BarChart3,
  Eye,
  EyeOff,
  List,
  LogOut,
  Settings,
  Trophy,
  User,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { useMe } from "@/lib/query/queries/auth";
import { isAdminRole } from "@/lib/role-preview";
import { useSession } from "@/lib/SessionProvider";
import { useUiStore } from "@/lib/stores/uiStore";
import { useClickOutside } from "@/lib/use-click-outside";
import { cn } from "@/lib/utils";

const MENU_ITEMS = [
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/portfolio#positions", label: "Positions", icon: BarChart3 },
  { href: "/portfolio#transactions", label: "Transaction History", icon: List },
  { href: "/rewards", label: "Rewards", icon: Trophy },
];

export function UserMenu() {
  const { isDemo, signOut } = useSession();
  const { user, actualRole, isPreviewing } = useMe();
  const setRolePreview = useUiStore((s) => s.setRolePreview);
  const clearRolePreview = useUiStore((s) => s.clearRolePreview);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setOpen(false));

  // follows the role preview, so the badge and Admin Panel link hide with it
  const isAdmin = isAdminRole(user.role);

  if (isDemo) {
    return (
      <Link
        href="/auth"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "px-4",
        )}
      >
        Sign In
      </Link>
    );
  }

  const initials = user.display_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative flex items-center"
        aria-label="Account menu"
      >
        <div className="flex size-9 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-muted text-sm font-medium text-muted-foreground transition-colors hover:bg-accent">
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-card shadow-lg">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <div className="flex size-10 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium text-muted-foreground">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold">
                  {user.display_name}
                </p>
                {isAdmin && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {user.role === "super_admin" ? "Super Admin" : "Admin"}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {user.andrew_id}
              </p>
            </div>
          </div>

          <div className="py-1">
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent"
            >
              <User size={16} className="text-muted-foreground" />
              <span>Profile</span>
            </Link>
            <div className="border-t border-border" />
            {MENU_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent"
              >
                <item.icon size={16} className="text-muted-foreground" />
                <span>{item.label}</span>
              </Link>
            ))}
            {isAdmin && (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent"
              >
                <Settings size={16} className="text-muted-foreground" />
                <span>Admin Panel</span>
              </Link>
            )}
            {/* Rendered from the real role so an admin can always end the preview. */}
            {isAdminRole(actualRole) && (
              <button
                type="button"
                aria-pressed={isPreviewing}
                onClick={() => {
                  setOpen(false);
                  if (isPreviewing) clearRolePreview();
                  else setRolePreview("user");
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent"
              >
                {isPreviewing ? (
                  <EyeOff size={16} className="text-muted-foreground" />
                ) : (
                  <Eye size={16} className="text-muted-foreground" />
                )}
                <span>
                  {isPreviewing
                    ? "Role preview: on (viewing as user)"
                    : "Role preview: view as user"}
                </span>
              </button>
            )}
          </div>

          <div className="border-t border-border py-1">
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await signOut();
                router.push("/");
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-destructive transition-colors hover:bg-accent"
            >
              <LogOut size={16} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
