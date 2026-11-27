"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { HottestMarketDisplay } from "@/components/hottest-market";
import { MarketCard } from "@/components/market-card";
import { buttonVariants } from "@/components/ui/button";
import { marketsQuery } from "@/lib/query/queries/markets";
import type { Market } from "@/lib/types";

const MAX_OPEN_MARKETS = 6;
const MAX_PENDING_RESOLUTION_MARKETS = 3;

export default function HomeClient() {
  const { data: markets = [] } = useQuery(marketsQuery());
  const openMarkets = markets
    .filter((market) => market.status === "open")
    .slice(0, MAX_OPEN_MARKETS);
  const pendingResolutionMarkets = markets
    .filter((market) => market.status === "pending_resolution")
    .slice(0, MAX_PENDING_RESOLUTION_MARKETS);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Welcome to Pheme</h1>

      {openMarkets.length > 0 ? (
        <section aria-label="Featured market" className="space-y-3">
          <h2 className="text-lg font-semibold">Featured Market</h2>
          <HottestMarketDisplay />
        </section>
      ) : (
        <section className="space-y-3 rounded-xl border bg-card p-8 text-center">
          <h2 className="text-xl font-semibold">No open markets right now</h2>
          <p className="text-sm text-muted-foreground">
            Be the first to propose one!
          </p>
          <Link href="/markets/create" className={buttonVariants()}>
            Create a Market
          </Link>
        </section>
      )}

      <MarketSection
        title="Open Markets"
        markets={openMarkets}
        testId="home-open-market-card"
      />

      {pendingResolutionMarkets.length > 0 && (
        <MarketSection
          title="Pending Resolution"
          markets={pendingResolutionMarkets}
          testId="home-pending-market-card"
        />
      )}

      <div className="flex justify-center border-t border-border pt-5">
        <Link
          href="/markets"
          className={buttonVariants({ variant: "outline" })}
        >
          Browse all markets →
        </Link>
      </div>
    </div>
  );
}

function MarketSection({
  title,
  markets,
  testId,
}: {
  title: string;
  markets: Market[];
  testId: string;
}) {
  return (
    <section aria-label={title} className="space-y-2.5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {markets.map((market) => (
          <div key={market.id} data-testid={testId}>
            <MarketCard market={market} />
          </div>
        ))}
      </div>
    </section>
  );
}
