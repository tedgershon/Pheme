"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PhemeMark } from "@/components/pheme-logo";
import { TartanCoin } from "@/components/tartan-coin";
import { buttonVariants } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { useMe } from "@/lib/query/queries/auth";
import { useSession } from "@/lib/SessionProvider";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Markets" },
  { href: "/resolutions", label: "Resolutions" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function Navbar() {
  const pathname = usePathname();
  const { isDemo } = useSession();
  const { user } = useMe();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-nav-background">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            aria-label="Pheme at Carnegie Mellon University, home"
            className="flex items-center gap-2 text-lg font-bold"
          >
            <PhemeMark size={28} />
            <span>Pheme @</span>
            <Image
              src="/assets/cmu-wordmark.png"
              alt=""
              width={52}
              height={34}
              priority
              className="h-[34px] w-auto"
            />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-primary/25 hover:text-primary-foreground",
                  pathname === link.href
                    ? "text-foreground"
                    : "text-nav-muted-foreground",
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {!isDemo && (
            <>
              <Link
                href="/portfolio"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "gap-1.5",
                )}
              >
                <TartanCoin size={16} />
                <span>{user.banana_balance.toLocaleString()}</span>
              </Link>
              <NotificationsMenu />
              <Link
                href="/markets/create"
                className={cn(
                  buttonVariants({ variant: "default", size: "sm" }),
                  "px-4",
                )}
              >
                Create Market
              </Link>
            </>
          )}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
