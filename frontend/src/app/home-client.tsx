"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleAlert, Clock3 } from "lucide-react";
import Link from "next/link";
import { HottestMarketDisplay } from "@/components/hottest-market";
import { MarketCard } from "@/components/market-card";
import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { marketsQuery } from "@/lib/query/queries/markets";
import { isMarketOpen } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_OPEN_MARKETS = 6;
const MAX_PENDING_RESOLUTION_MARKETS = 3;

export default function HomeClient() {
  const { data: markets, isPending, refetch } = useQuery(marketsQuery());
  const openMarkets = (markets ?? [])
    .filter((market) => market.status === "open")
    .slice(0, MAX_OPEN_MARKETS);
  const pendingResolutionMarkets = (markets ?? [])
    .filter((market) => market.status === "pending_resolution")
    .slice(0, MAX_PENDING_RESOLUTION_MARKETS);
  const fallbackMarket = markets?.find(isMarketOpen);
  const hasPending = pendingResolutionMarkets.length > 0;

  return (
    <div className="space-y-7 pb-8 pt-2 sm:space-y-9 sm:pt-4">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-4xl">
          What&apos;s happening at CMU?
        </h1>
      </header>

      {fallbackMarket && (
        <HottestMarketDisplay fallbackMarket={fallbackMarket} />
      )}

      <div
        className={cn(
          "grid items-start gap-7",
          hasPending && "lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.45fr)]",
        )}
      >
        <section aria-labelledby="home-open-heading" className="min-w-0">
          <h2
            id="home-open-heading"
            className="mb-3 text-xl font-extrabold tracking-tight"
          >
            Open Markets
          </h2>
          {isPending ? (
            <output className="flex items-center justify-center gap-2 rounded-xl border bg-card p-8 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading markets…
            </output>
          ) : !markets ? (
            <div className="space-y-3 rounded-xl border bg-card p-6">
              <p role="alert" className="flex items-center gap-2 text-sm">
                <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                Markets are unavailable right now.
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className={buttonVariants({ variant: "outline" })}
              >
                Try again
              </button>
            </div>
          ) : openMarkets.length === 0 ? (
            <div className="space-y-3 rounded-xl border bg-card p-6 sm:p-8">
              <h3 className="font-bold">No open markets right now</h3>
              <p className="text-sm text-muted-foreground">
                Be the first to propose one.
              </p>
              <Link href="/markets/create" className={buttonVariants()}>
                Create a Market
              </Link>
            </div>
          ) : (
            <div
              className={cn(
                "grid gap-3 sm:grid-cols-2",
                !hasPending && "lg:grid-cols-3",
              )}
            >
              {openMarkets.map((market) => (
                <div
                  key={market.id}
                  data-testid="home-open-market-card"
                  className="min-w-0"
                >
                  <MarketCard market={market} variant="compact" />
                </div>
              ))}
            </div>
          )}
        </section>

        {hasPending && (
          <section
            aria-labelledby="home-pending-heading"
            className="min-w-0 rounded-2xl border bg-card px-4 pt-4 shadow-sm"
          >
            <h2
              id="home-pending-heading"
              className="flex items-center gap-2 text-lg font-extrabold tracking-tight"
            >
              <Clock3
                aria-hidden="true"
                className="size-4 shrink-0 text-brand-tint-foreground"
              />
              Pending Resolution
            </h2>
            <ul className="mt-2 divide-y divide-border">
              {pendingResolutionMarkets.map((market) => (
                <li key={market.id} data-testid="home-pending-market-card">
                  <MarketCard market={market} variant="list" />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="flex justify-center border-t pt-5">
        <Link
          href="/markets"
          className={cn(
            buttonVariants({ variant: "ghost", size: "lg" }),
            "min-h-11 gap-2",
          )}
        >
          Browse all markets <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
