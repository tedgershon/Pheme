"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  getOptionColor,
  ProbabilityChart,
} from "@/components/probability-chart";
import { TartanCoin } from "@/components/tartan-coin";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  betsForMarketQuery,
  hotMarketsQuery,
} from "@/lib/query/queries/markets";
import type { Bet, Market, PricePoint } from "@/lib/types";
import { getMarketProbability } from "@/lib/types";

// exported because the markets page's FeaturedMarket also uses it
export function buildPriceHistory(bets: Bet[]): PricePoint[] {
  if (bets.length === 0) return [];
  const sorted = [...bets].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  let yes = 0;
  let no = 0;
  const points: PricePoint[] = [];
  for (const bet of sorted) {
    if (bet.side === "YES") yes += bet.amount;
    else no += bet.amount;
    const total = yes + no;
    points.push({
      timestamp: bet.created_at,
      probability: total > 0 ? Math.round((yes / total) * 100) : 50,
    });
  }
  return points;
}

export function MarketOptions({ market }: { market: Market }) {
  if (market.market_type === "multichoice" && market.options) {
    const opts = market.options;
    const totalPool = opts.reduce((s, o) => s + o.pool_total, 0);
    const sorted = [...opts].sort((a, b) => b.pool_total - a.pool_total);
    const top = sorted.slice(0, 3);

    return (
      <div className="space-y-2">
        {top.map((opt) => {
          const pct =
            totalPool > 0 ? Math.round((opt.pool_total / totalPool) * 100) : 0;
          const originalIdx = opts.findIndex((o) => o.id === opt.id);
          return (
            <div key={opt.id} className="flex items-center gap-3">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: getOptionColor(originalIdx) }}
              />
              <span className="flex-1 font-medium">{opt.label}</span>
              <span className="text-lg font-bold">{pct}%</span>
            </div>
          );
        })}
        {sorted.length > 3 && (
          <span className="text-sm text-muted-foreground">
            +{sorted.length - 3} more options
          </span>
        )}
      </div>
    );
  }

  const probability = getMarketProbability(market);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 shrink-0 rounded-full bg-success" />
        <span className="flex-1 font-medium text-success">Yes</span>
        <span className="text-lg font-bold">{probability}%</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 shrink-0 rounded-full bg-danger" />
        <span className="flex-1 font-medium text-danger">No</span>
        <span className="text-lg font-bold">{100 - probability}%</span>
      </div>
    </div>
  );
}

export function HottestMarketDisplay() {
  const { data: hotMarkets = [], isLoading } = useQuery(hotMarketsQuery());
  const [currentIndex, setCurrentIndex] = useState(0);
  const market = hotMarkets[currentIndex];

  const isBinary = market?.market_type === "binary";
  const { data: bets = [] } = useQuery({
    ...betsForMarketQuery(market?.id ?? ""),
    enabled: !!market && isBinary,
  });
  const chartData = isBinary ? buildPriceHistory(bets) : [];

  if (isLoading) {
    return (
      <div className="flex justify-center rounded-xl border bg-card p-12">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (hotMarkets.length === 0 || !market) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
        No active markets yet. Be the first to create one!
      </div>
    );
  }

  const total = hotMarkets.length;
  const volume = market.yes_pool_total + market.no_pool_total;

  return (
    <Link href={`/markets/${market.id}`} className="block">
      <div className="relative rounded-xl border bg-card p-6 transition-colors hover:bg-accent/50">
        {/* biome-ignore lint: click handler stops navigation to parent Link */}
        <div
          className="absolute top-4 right-4 z-10 flex items-center gap-2 text-sm text-muted-foreground"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <button
            type="button"
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
            className="rounded p-1 hover:bg-accent disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {currentIndex + 1} of {total}
          </span>
          <button
            type="button"
            onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
            disabled={currentIndex === total - 1}
            className="rounded p-1 hover:bg-accent disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <Badge variant="outline" className="mb-2">
                {market.category}
              </Badge>
              <h2 className="text-2xl font-bold leading-tight">
                {market.title}
              </h2>
            </div>

            <MarketOptions market={market} />

            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <TartanCoin size={16} />
              <span>{volume.toLocaleString()} vol</span>
            </div>

            {market.description && (
              <div>
                <h4 className="text-sm font-semibold">Description</h4>
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {market.description}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center">
            {isBinary && chartData.length > 0 ? (
              <ProbabilityChart data={chartData} />
            ) : (
              <div className="flex h-[280px] w-full items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
                {isBinary ? "No bet history yet" : "Multichoice market"}
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
