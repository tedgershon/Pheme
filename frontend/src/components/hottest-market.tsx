"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import { ProbabilityChart } from "@/components/probability-chart";
import { TartanCoin } from "@/components/tartan-coin";
import {
  betsForMarketQuery,
  hotMarketsQuery,
} from "@/lib/query/queries/markets";
import type { Bet, Market, PricePoint } from "@/lib/types";
import { getMarketProbability, isMarketOpen } from "@/lib/types";

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

const campusDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "America/New_York",
});

function MarketOutlook({
  market,
  pool,
  history,
}: {
  market: Market;
  pool: number;
  history: PricePoint[];
}) {
  const probability = getMarketProbability(market);
  const isBinary = market.market_type === "binary";
  const options = [...(market.options ?? [])].sort(
    (a, b) => b.pool_total - a.pool_total,
  );

  return (
    <div className="flex min-w-0 flex-col justify-center gap-4 rounded-xl bg-card p-4 text-card-foreground sm:p-5">
      <p className="text-sm font-bold">Current outlook</p>
      {isBinary ? (
        <>
          <div className="grid grid-cols-2 gap-2 tabular-nums">
            <div className="rounded-lg bg-success/10 p-3 text-success">
              <p className="text-xs font-bold">Yes</p>
              <p className="text-2xl font-extrabold">{probability}%</p>
            </div>
            <div className="rounded-lg bg-danger/10 p-3 text-danger">
              <p className="text-xs font-bold">No</p>
              <p className="text-2xl font-extrabold">{100 - probability}%</p>
            </div>
          </div>
          {history.length > 1 && (
            <div className="min-w-0">
              <p className="mb-1 text-xs text-muted-foreground">
                Yes chance over time
              </p>
              <ProbabilityChart data={history} />
            </div>
          )}
        </>
      ) : options.length > 0 && pool > 0 ? (
        <ul className="space-y-2">
          {options.slice(0, 3).map((option) => (
            <li
              key={option.id}
              className="flex justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm"
            >
              <span className="min-w-0 break-words">{option.label}</span>
              <span className="shrink-0 font-bold tabular-nums">
                {Math.round((option.pool_total / pool) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No predictions yet.</p>
      )}
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <TartanCoin size={14} />
        {pool.toLocaleString("en-US")} in the pool
      </p>
    </div>
  );
}

export function HottestMarketDisplay({
  fallbackMarket,
}: {
  fallbackMarket: Market;
}) {
  const { data: hotMarkets, isPending } = useQuery(hotMarketsQuery());
  const market = hotMarkets?.find(isMarketOpen) ?? fallbackMarket;
  const isBinary = market.market_type === "binary";
  const { data: bets = [] } = useQuery({
    ...betsForMarketQuery(market.id),
    enabled: isBinary && !isPending,
  });
  const pool = isBinary
    ? market.yes_pool_total + market.no_pool_total
    : (market.options ?? []).reduce(
        (sum, option) => sum + option.pool_total,
        0,
      );

  return (
    <section
      aria-labelledby="home-feature-heading"
      className="grid gap-5 rounded-2xl bg-linear-to-br from-[#631427] to-[#300d1b] p-4 text-white shadow-sm sm:p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-8 lg:p-8"
    >
      <div className="flex min-w-0 flex-col items-start justify-center gap-4">
        <h2
          id="home-feature-heading"
          className="text-xs font-extrabold uppercase tracking-widest text-rose-200"
        >
          Featured Market
        </h2>
        <h3 className="max-w-xl break-words text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl xl:text-4xl">
          {market.title}
        </h3>
        {market.description && (
          <p className="line-clamp-3 max-w-lg break-words text-sm leading-relaxed text-rose-100/90">
            {market.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-rose-100">
          <span className="break-words">{market.category}</span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
            <time dateTime={market.close_at}>
              Closes {campusDate.format(new Date(market.close_at))}
            </time>
          </span>
        </div>
        <Link
          href={`/markets/${market.id}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-4 text-sm font-extrabold text-[#631427] transition-colors hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          View market <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <MarketOutlook
        market={market}
        pool={pool}
        history={isBinary ? buildPriceHistory(bets) : []}
      />
    </section>
  );
}
