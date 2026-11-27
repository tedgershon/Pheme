"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleAlert } from "lucide-react";
import Link from "next/link";
import {
  FeaturedMarket,
  FeaturedMarketSkeleton,
} from "@/components/hottest-market";
import { MarketCard } from "@/components/market-card";
import { PendingResolutionList } from "@/components/pending-resolution-list";
import { buttonVariants } from "@/components/ui/button";
import { hotMarketsQuery, marketsQuery } from "@/lib/query/queries/markets";
import { isMarketOpen, type Market } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_OPEN_MARKETS = 6;
const MAX_PENDING_RESOLUTION_MARKETS = 3;

export default function HomeClient() {
  const { data: markets, isPending, refetch } = useQuery(marketsQuery());
  const hot = useQuery(hotMarketsQuery());

  const allOpen = (markets ?? []).filter((market) => market.status === "open");
  // The open market with the most coins staked leads; if that ranking is
  // unavailable, fall back to the newest open market.
  const featured =
    hot.data?.find(isMarketOpen) ?? (hot.isPending ? undefined : allOpen[0]);
  // The featured market is already on screen, so the grid skips it.
  const openMarkets = allOpen
    .filter((market) => market.id !== featured?.id)
    .slice(0, MAX_OPEN_MARKETS);
  const pendingResolutionMarkets = (markets ?? [])
    .filter((market) => market.status === "pending_resolution")
    .slice(0, MAX_PENDING_RESOLUTION_MARKETS);

  const showFeatured = isPending || allOpen.length > 0;
  const hasPending = pendingResolutionMarkets.length > 0;

  return (
    <div className="space-y-6 pb-10 pt-2 sm:pt-4">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        What&apos;s happening at CMU?
      </h1>

      {/* DOM order is the phone order (featured, open, pending). From xl up
          the pending rail moves beside the featured market; narrower, the
          hero would stack its chart and leave the rail mostly empty. */}
      <div
        className={cn(
          "grid items-stretch gap-6",
          hasPending && "xl:grid-cols-[minmax(0,1fr)_21rem]",
        )}
      >
        {showFeatured && (
          <div className="min-w-0 xl:col-start-1 xl:row-start-1">
            {featured ? (
              <FeaturedMarket market={featured} />
            ) : (
              <FeaturedMarketSkeleton />
            )}
          </div>
        )}

        <section
          aria-labelledby="home-open-heading"
          className={cn(
            "min-w-0",
            hasPending && showFeatured && "xl:col-span-2",
          )}
        >
          <h2
            id="home-open-heading"
            className="mb-3 text-xl font-bold tracking-tight"
          >
            Open Markets
          </h2>
          <OpenMarkets
            isPending={isPending}
            failed={!isPending && !markets}
            onRetry={() => void refetch()}
            markets={openMarkets}
            anyOpen={allOpen.length > 0}
            wide={!hasPending || showFeatured}
          />
        </section>

        {hasPending && (
          <PendingResolutionList
            markets={pendingResolutionMarkets}
            className="xl:col-start-2 xl:row-start-1"
          />
        )}
      </div>

      <div className="flex justify-center pt-2">
        <Link
          href="/markets"
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "px-5",
          )}
        >
          Browse all markets <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function OpenMarkets({
  isPending,
  failed,
  onRetry,
  markets,
  anyOpen,
  wide,
}: {
  isPending: boolean;
  failed: boolean;
  onRetry: () => void;
  markets: Market[];
  anyOpen: boolean;
  wide: boolean;
}) {
  // Not wide: the pending rail shares the row from xl up.
  const grid = cn(
    "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
    !wide && "xl:grid-cols-2",
  );

  if (isPending) {
    return (
      <div className={grid} aria-busy="true">
        <span className="sr-only">Loading markets…</span>
        {Array.from({ length: MAX_OPEN_MARKETS }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
            key={i}
            aria-hidden="true"
            className="h-44 rounded-xl border bg-card motion-safe:animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-6">
        <p role="alert" className="flex items-center gap-2 text-sm">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          Markets are unavailable right now.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className={buttonVariants({ variant: "outline" })}
        >
          Try again
        </button>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed bg-card p-6 sm:p-8">
        <h3 className="font-bold">
          {anyOpen
            ? "That's the only open market right now"
            : "No open markets right now"}
        </h3>
        <p className="text-sm text-muted-foreground">
          Have a question about campus? Be the first to propose one.
        </p>
        <Link href="/markets/create" className={buttonVariants()}>
          Create a Market
        </Link>
      </div>
    );
  }

  return (
    <div className={grid}>
      {markets.map((market) => (
        <div
          key={market.id}
          data-testid="home-open-market-card"
          className="min-w-0"
        >
          <MarketCard market={market} variant="compact" />
        </div>
      ))}
    </div>
  );
}
