"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CategoryFilter } from "@/components/category-filter";
import { buildPriceHistory } from "@/components/hottest-market";
import { MarketCard } from "@/components/market-card";
import { ProbabilityChart } from "@/components/probability-chart";
import { TartanCoin } from "@/components/tartan-coin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  betsForMarketQuery,
  marketsQuery,
  trendingMarketsQuery,
} from "@/lib/query/queries/markets";
import type { Market } from "@/lib/types";
import { getMarketProbability, isMarketOpen } from "@/lib/types";

const MAX_TRENDING_MARKETS = 4;

function getMarketVolume(market: Market) {
  if (market.market_type === "multichoice" && market.options?.length) {
    return market.options.reduce((sum, opt) => sum + opt.pool_total, 0);
  }
  return market.yes_pool_total + market.no_pool_total;
}

function getDominantChoice(market: Market): { label: string; pct: number } {
  if (market.market_type === "multichoice" && market.options?.length) {
    const opts = market.options;
    const totalPool = opts.reduce((s, o) => s + o.pool_total, 0);
    const sorted = [...opts].sort((a, b) => b.pool_total - a.pool_total);
    const leader = sorted[0];
    const pct =
      totalPool > 0 ? Math.round((leader.pool_total / totalPool) * 100) : 0;
    return { label: leader.label, pct };
  }
  const probability = getMarketProbability(market);
  return probability >= 50
    ? { label: "Yes", pct: probability }
    : { label: "No", pct: 100 - probability };
}

// one backend call ranks trending markets for us, no more client fan-out
// over every open market to compute 7d volume
function TrendingFeaturedMarkets() {
  const { data: trendingMarkets = [], isLoading } = useQuery(
    trendingMarketsQuery(MAX_TRENDING_MARKETS),
  );
  const [activeIndex, setActiveIndex] = useState(0);

  // clamp active index when the trending set shrinks
  const safeActiveIndex =
    trendingMarkets.length === 0
      ? 0
      : Math.min(activeIndex, trendingMarkets.length - 1);
  const activeMarket = trendingMarkets[safeActiveIndex] ?? null;
  const probability = activeMarket ? getMarketProbability(activeMarket) : 0;
  const totalVolume = activeMarket ? getMarketVolume(activeMarket) : 0;

  // chart for the currently-active trending market — same key as the
  // detail page and its SSR prefetch so cache is shared on navigation
  const { data: activeBets = [] } = useQuery({
    ...betsForMarketQuery(activeMarket?.id ?? ""),
    enabled: !!activeMarket && activeMarket.market_type === "binary",
  });
  const chartData =
    activeMarket?.market_type === "binary" ? buildPriceHistory(activeBets) : [];

  const hasTrendingMarkets = trendingMarkets.length > 0;

  return (
    <Card className="h-full market-card-open border-0 rounded-xl">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          Trending Markets
        </CardTitle>
        <CardAction className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous trending market"
            onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
            disabled={!hasTrendingMarkets || safeActiveIndex === 0}
            className="flex size-7 items-center justify-center rounded-full border border-border bg-background text-xs font-medium text-foreground leading-none transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {"<"}
          </button>
          <span className="min-w-12 text-center text-xs font-medium text-foreground tabular-nums">
            {hasTrendingMarkets
              ? `${safeActiveIndex + 1} of ${trendingMarkets.length}`
              : "0 of 0"}
          </span>
          <button
            type="button"
            aria-label="Next trending market"
            onClick={() =>
              setActiveIndex((i) => Math.min(trendingMarkets.length - 1, i + 1))
            }
            disabled={
              !hasTrendingMarkets ||
              safeActiveIndex === trendingMarkets.length - 1
            }
            className="flex size-7 items-center justify-center rounded-full border border-border bg-background text-xs font-medium text-foreground leading-none transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {">"}
          </button>
        </CardAction>
      </CardHeader>

      <CardContent className="!pt-0 pb-0">
        {isLoading ? (
          <div className="flex py-4 items-center justify-center">
            <Spinner className="size-6" />
          </div>
        ) : !activeMarket ? (
          <div className="flex py-4 items-center justify-center rounded-lg bg-muted/30 px-4 text-center text-sm text-muted-foreground">
            No trending markets yet.
          </div>
        ) : (
          <Link href={`/markets/${activeMarket.id}`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="glimmer-dot size-2.5 rounded-full bg-success" />
                  <Badge variant="outline">{activeMarket.category}</Badge>
                </div>
                <h3 className="text-lg font-semibold leading-snug">
                  {activeMarket.title}
                </h3>
                {activeMarket.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {activeMarket.description}
                  </p>
                )}
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <TartanCoin size={14} />
                  <span>{totalVolume.toLocaleString()} total coin volume</span>
                </div>
                <div className="mt-auto grid grid-cols-2 gap-2">
                  <Button
                    size="lg"
                    className="w-full bg-success text-success-foreground hover:bg-success hover:brightness-105 [box-shadow:0_4px_0_color-mix(in_oklch,var(--color-success)_70%,black)] active:[box-shadow:0_2px_0_color-mix(in_oklch,var(--color-success)_70%,black)]"
                  >
                    Yes {probability}%
                  </Button>
                  <Button
                    size="lg"
                    className="w-full bg-danger text-danger-foreground hover:bg-danger hover:brightness-105 [box-shadow:0_4px_0_color-mix(in_oklch,var(--color-danger)_70%,black)] active:[box-shadow:0_2px_0_color-mix(in_oklch,var(--color-danger)_70%,black)]"
                  >
                    No {100 - probability}%
                  </Button>
                </div>
              </div>

              <div className="min-w-0">
                {activeMarket.market_type === "binary" &&
                chartData.length > 0 ? (
                  <ProbabilityChart data={chartData} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-lg py-3 bg-muted/30 text-sm text-muted-foreground">
                    {activeMarket.market_type === "binary"
                      ? "No bet history yet"
                      : "Multichoice market"}
                  </div>
                )}
              </div>
            </div>
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

function NewestMarkets({ markets }: { markets: Market[] }) {
  const newest = useMemo(() => {
    return [...markets]
      .filter(isMarketOpen)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, 3);
  }, [markets]);

  return (
    <Card className="h-full market-card-open border-0 rounded-xl">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          Newest Markets
        </CardTitle>
      </CardHeader>
      <CardContent className="!p-0">
        {newest.length === 0 ? (
          <p className="px-4 py-2 text-sm text-muted-foreground">
            No new markets yet.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {newest.map((market) => {
              const dominant = getDominantChoice(market);
              return (
                <Link
                  key={market.id}
                  href={`/markets/${market.id}`}
                  className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/50"
                >
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold leading-snug truncate">
                      {market.title}
                    </h4>
                    <span className="text-xs text-muted-foreground">
                      {market.category}
                    </span>
                  </div>
                  <span className="shrink-0 text-lg font-bold">
                    {dominant.pct}%
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MarketsClient() {
  const { data: markets = [], isLoading } = useQuery(marketsQuery());
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = useMemo(
    () => [...new Set(markets.map((m) => m.category))],
    [markets],
  );

  const filtered = selectedCategory
    ? markets.filter((m) => m.category === selectedCategory)
    : markets;

  function isPendingResolutionStatus(status: Market["status"]) {
    return status === "pending_resolution" || status === "disputed";
  }

  const openMarkets = filtered.filter(isMarketOpen);
  const pendingResolutionMarkets = filtered.filter((m) =>
    isPendingResolutionStatus(m.status),
  );
  const closedMarkets = filtered.filter(
    (m) => !isMarketOpen(m) && !isPendingResolutionStatus(m.status),
  );

  return (
    <>
      <div
        className="-mt-4"
        style={{
          marginLeft: "calc(-50vw + 50%)",
          marginRight: "calc(-50vw + 50%)",
        }}
      >
        <CategoryFilter
          categories={categories}
          selected={selectedCategory}
          onSelect={setSelectedCategory}
        />
      </div>

      <div className="mt-4 space-y-5">
        <section className="space-y-2.5">
          <h1 className="text-3xl font-bold tracking-tight">Markets</h1>
          {!isLoading && (
            <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
              <TrendingFeaturedMarkets />
              <NewestMarkets markets={filtered} />
            </div>
          )}
        </section>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : (
          <>
            <section className="space-y-2.5">
              <h2 className="text-lg font-semibold">
                Open Markets ({openMarkets.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {openMarkets.map((market) => (
                  <MarketCard key={market.id} market={market} />
                ))}
              </div>
            </section>

            <section className="space-y-2.5">
              <h2 className="text-lg font-semibold">
                Markets Pending Resolution ({pendingResolutionMarkets.length})
              </h2>
              {pendingResolutionMarkets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No markets are currently pending resolution.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {pendingResolutionMarkets.map((market) => (
                    <MarketCard key={market.id} market={market} />
                  ))}
                </div>
              )}
            </section>

            {closedMarkets.length > 0 && (
              <section className="space-y-2.5">
                <h2 className="text-lg font-semibold">
                  Closed Markets ({closedMarkets.length})
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {closedMarkets.map((market) => (
                    <MarketCard key={market.id} market={market} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
