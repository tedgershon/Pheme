"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { TartanCoin } from "@/components/tartan-coin";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  topMarketsQuery,
  trendingMarketsQuery,
} from "@/lib/query/queries/markets";
import type { Market } from "@/lib/types";
import { getMarketProbability } from "@/lib/types";

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
  if (probability >= 50) {
    return { label: "Yes", pct: probability };
  }
  return { label: "No", pct: 100 - probability };
}

function RankedMarketList({ markets }: { markets: Market[] }) {
  if (markets.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No trending markets yet.
      </p>
    );
  }

  return (
    <Card size="sm" className="!gap-0 !py-0">
      <CardContent className="divide-y divide-border !p-0">
        {markets.map((market, i) => {
          const rank = i + 1;
          const dominant = getDominantChoice(market);
          const volume = market.yes_pool_total + market.no_pool_total;

          return (
            <Link
              key={market.id}
              href={`/markets/${market.id}`}
              className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/50"
            >
              <span className="flex w-8 shrink-0 items-center justify-center text-xl font-bold text-muted-foreground">
                {rank}
              </span>

              <div className="flex-1 min-w-0">
                <h3 className="font-semibold leading-snug truncate">
                  {market.title}
                </h3>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{dominant.label}</span>
                  <span className="inline-flex items-center gap-0.5">
                    <TartanCoin size={12} />
                    {volume.toLocaleString()} vol
                  </span>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <span className="text-2xl font-bold">{dominant.pct}%</span>
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function TrendingTopMarkets() {
  const [activeTab, setActiveTab] = useState<"trending" | "top">("trending");
  const { data: trendingMarkets = [], isLoading: loadingTrending } = useQuery(
    trendingMarketsQuery(),
  );
  // top tab only fetches when the user clicks over to it
  const { data: topMarkets = [], isLoading: loadingTop } = useQuery({
    ...topMarketsQuery(),
    enabled: activeTab === "top",
  });

  const isLoading =
    (activeTab === "trending" && loadingTrending) ||
    (activeTab === "top" && loadingTop);
  const markets = activeTab === "trending" ? trendingMarkets : topMarkets;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant={activeTab === "trending" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("trending")}
        >
          Trending
        </Button>
        <Button
          variant={activeTab === "top" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("top")}
        >
          Top Markets
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner className="size-6" />
        </div>
      ) : (
        <RankedMarketList markets={markets} />
      )}
    </section>
  );
}
