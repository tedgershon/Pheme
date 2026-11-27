"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChartLine } from "lucide-react";
import Link from "next/link";
import { CloseCountdown } from "@/components/close-countdown";
import { FireIcon } from "@/components/fire-icon";
import {
  getMarketPool,
  getOutcomes,
  OutcomeRows,
} from "@/components/market-outcomes";
import { ProbabilityChart } from "@/components/probability-chart";
import { TartanCoin } from "@/components/tartan-coin";
import { betsForMarketQuery } from "@/lib/query/queries/markets";
import type { Bet, Market, PricePoint } from "@/lib/types";

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

// A line through one or two predictions says nothing about a trend.
const MIN_CHART_POINTS = 3;
const FEATURED_OUTCOMES = 4;

/**
 * The home page's hot market (most coins staked): question and context on the
 * left, live outcomes and the Yes-chance chart on the right. Until a binary
 * market has enough predictions to chart, a placeholder holds the chart's
 * place. Stacks to question, outcomes, then the call to action on phones.
 */
export function FeaturedMarket({ market }: { market: Market }) {
  const isBinary = market.market_type === "binary";
  const { data: bets = [], isPending: betsPending } = useQuery({
    ...betsForMarketQuery(market.id),
    enabled: isBinary,
  });
  const history = isBinary ? buildPriceHistory(bets) : [];
  const outcomes = getOutcomes(market);
  const hiddenOutcomes = outcomes.length - FEATURED_OUTCOMES;
  const pool = getMarketPool(market);

  return (
    <section
      aria-labelledby="home-feature-heading"
      className="dark featured-surface @container rounded-2xl p-5 shadow-md sm:p-6"
    >
      <div className="grid gap-5 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] @2xl:gap-x-8">
        <div className="min-w-0 @2xl:col-start-1 @2xl:row-start-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <h2
              id="home-feature-heading"
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-white"
            >
              <FireIcon className="size-4" />
              Hot Market
            </h2>
            <span className="text-muted-foreground">{market.category}</span>
          </div>
          <h3 className="mt-3 text-balance break-words text-2xl font-bold leading-tight tracking-tight @2xl:text-[1.75rem]">
            {market.title}
          </h3>
          {market.description && (
            <p className="mt-2 line-clamp-2 break-words text-sm leading-relaxed text-muted-foreground">
              {market.description}
            </p>
          )}
        </div>

        <div className="min-w-0 @2xl:col-start-2 @2xl:row-span-2 @2xl:row-start-1">
          <OutcomeRows
            outcomes={outcomes.slice(0, FEATURED_OUTCOMES)}
            size="lg"
          />
          {hiddenOutcomes > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              +{hiddenOutcomes} more outcomes
            </p>
          )}
          {isBinary &&
            (history.length >= MIN_CHART_POINTS ? (
              <figure className="relative mt-4 hidden h-52 @lg:block">
                <figcaption className="absolute top-0 left-0 z-10 inline-flex items-center gap-1.5 rounded-md bg-card/85 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full bg-success"
                  />
                  Chance of Yes
                </figcaption>
                <ProbabilityChart data={history} />
              </figure>
            ) : (
              // Same footprint as the chart, so the card keeps its shape.
              <div className="mt-4 hidden h-52 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-center text-sm text-muted-foreground @lg:flex">
                {!betsPending && (
                  <>
                    <ChartLine aria-hidden="true" className="size-5" />
                    <p>Chart appears after {MIN_CHART_POINTS} predictions</p>
                  </>
                )}
              </div>
            ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 @2xl:col-start-1 @2xl:row-start-2 @2xl:self-end">
          <Link
            href={`/markets/${market.id}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-bold text-(--feature-ink) transition-[transform,box-shadow,background-color] duration-100 [box-shadow:0_4px_0_rgb(255_255_255/30%)] hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white active:translate-y-0.5 active:[box-shadow:0_2px_0_rgb(255_255_255/30%)] [&_svg]:size-4"
          >
            View market <ArrowRight aria-hidden="true" />
          </Link>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <TartanCoin size={15} />
              {pool > 0
                ? `${pool.toLocaleString("en-US")} pool`
                : "No predictions yet"}
            </span>
            <CloseCountdown
              closeAt={market.close_at}
              icon
              className="gap-1.5"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function FeaturedMarketSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="dark featured-surface h-80 rounded-2xl p-6 shadow-md motion-safe:animate-pulse"
    >
      <div className="h-5 w-32 rounded-full bg-muted" />
      <div className="mt-4 h-8 w-3/4 rounded-md bg-muted" />
      <div className="mt-6 h-11 w-full max-w-md rounded-md bg-muted" />
      <div className="mt-2 h-11 w-full max-w-md rounded-md bg-muted" />
    </div>
  );
}
