"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { TartanCoin } from "@/components/tartan-coin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { parseApiError } from "@/lib/api";
import { useClaimDaily } from "@/lib/query/mutations/auth";
import { useMe } from "@/lib/query/queries/auth";
import { marketsQuery } from "@/lib/query/queries/markets";
import {
  portfolioQuery,
  proposedMarketsQuery,
  transactionsQuery,
} from "@/lib/query/queries/portfolio";
import type { Market } from "@/lib/types";
import { getMarketProbability } from "@/lib/types";

const TX_LABELS: Record<string, string> = {
  initial_grant: "Initial Grant",
  bet_placement: "Bet Placed",
  payout: "Payout",
  voter_stake: "Voter Stake",
  voter_reward: "Voter Reward",
  daily_claim: "Daily Claim",
  resolution_vote_reward: "Voter Reward",
  refund: "Refund",
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PortfolioPage() {
  const { user } = useMe();
  const { data: markets = [] } = useQuery(marketsQuery());
  const { data: bets = [], isLoading: betsLoading } = useQuery(
    portfolioQuery(),
  );
  const { data: transactions = [], isLoading: txsLoading } = useQuery(
    transactionsQuery(),
  );
  const { data: proposedMarkets = [] } = useQuery(proposedMarketsQuery());

  const claim = useClaimDaily();
  const [claimError, setClaimError] = useState<string | null>(null);
  const [expandedProposedId, setExpandedProposedId] = useState<string | null>(
    null,
  );
  const [showAllProposed, setShowAllProposed] = useState(false);

  const loading = betsLoading || txsLoading;

  async function handleClaim() {
    setClaimError(null);
    try {
      await claim.mutateAsync();
    } catch (err) {
      const { code, message } = parseApiError(
        err,
        "Failed to claim. Try again later.",
      );
      if (code === "CLAIM_ALREADY_TODAY") {
        setClaimError("Already claimed today!");
      } else {
        setClaimError(message);
      }
    }
  }

  function getMarketById(id: string) {
    return markets.find((m) => m.id === id);
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <section>
          <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>
        </section>
        <div className="flex justify-center py-12">
          <Spinner className="size-6" />
        </div>
      </div>
    );
  }

  const userBets = bets.filter((b) => b.user_id === user.id);
  const userTxs = transactions
    .filter((t) => t.user_id === user.id)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

  const activeBets = userBets.reduce((sum, b) => sum + b.amount, 0);
  const visibleProposedMarkets = showAllProposed
    ? proposedMarkets
    : proposedMarkets.slice(0, 3);

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>
        <p className="text-sm text-muted-foreground">
          {user.display_name} ({user.andrew_id})
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr] items-start">
        <Card size="sm">
          <CardContent className="divide-y divide-border !p-0">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-muted-foreground">Balance</span>
              <span className="flex items-center gap-1.5 text-lg font-bold">
                <TartanCoin size={18} />
                {user.banana_balance.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-muted-foreground">Active Bets</span>
              <span className="flex items-center gap-1.5 text-lg font-bold">
                <TartanCoin size={18} />
                {activeBets.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-muted-foreground">Positions</span>
              <span className="text-lg font-bold">{userBets.length}</span>
            </div>
            {!user.above_cap && (
              <div className="px-4 py-3">
                {claimError && (
                  <p role="alert" className="text-xs text-destructive mb-2">
                    {claimError}
                  </p>
                )}
                {user.claimed_today && user.banana_balance <= 5000 ? (
                  <p className="text-xs text-muted-foreground">
                    Claimed! Come back tomorrow.
                  </p>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={handleClaim}
                    disabled={claim.isPending}
                  >
                    {claim.isPending ? (
                      <Spinner />
                    ) : user.claim_amount < 1000 ? (
                      `Claim ${user.claim_amount.toLocaleString()} Daily Tartan Coins`
                    ) : (
                      "Claim 1,000 Daily Tartan Coins"
                    )}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Positions</h2>
          <div className="grid gap-2 max-h-[400px] overflow-y-auto p-1 -m-1">
            {userBets.map((bet) => {
              const market = getMarketById(bet.market_id);
              if (!market) return null;
              const prob = getMarketProbability(market);

              return (
                <Link key={bet.id} href={`/markets/${bet.market_id}`}>
                  <Card size="sm">
                    <CardContent className="flex items-center justify-between">
                      <div className="flex-1 space-y-0.5">
                        <p className="text-sm font-medium leading-snug">
                          {market.title}
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={bet.side === "YES" ? "default" : "outline"}
                            className={
                              bet.side === "YES"
                                ? "bg-success-foreground text-success"
                                : "bg-danger-foreground text-danger"
                            }
                          >
                            {bet.side}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {prob}% chance
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-base font-semibold">
                        <TartanCoin size={16} />
                        {bet.amount.toLocaleString()}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {proposedMarkets.length > 0 && (
        <section className="space-y-1.5">
          <h2 className="text-lg font-semibold">Proposed Markets</h2>
          <div className="grid gap-1.5">
            {visibleProposedMarkets.map((market) => {
              const isExpanded = expandedProposedId === market.id;
              const isDenied = market.status === "denied";
              const reviewNotes = (
                market as Market & { review_notes?: string | null }
              ).review_notes;
              return (
                <Card key={market.id} size="sm">
                  <CardContent className="!p-0">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-muted/40"
                      onClick={() =>
                        setExpandedProposedId(isExpanded ? null : market.id)
                      }
                    >
                      <div className="flex-1 space-y-0">
                        <p className="text-sm font-medium leading-tight">
                          {market.title}
                        </p>
                        {isDenied ? (
                          <Badge variant="destructive">Denied</Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-amber-500 text-amber-500"
                          >
                            Pending Approval
                          </Badge>
                        )}
                        {isDenied ? (
                          reviewNotes && (
                            <p className="text-xs leading-tight text-muted-foreground line-clamp-2">
                              {reviewNotes}
                            </p>
                          )
                        ) : (
                          <p className="text-xs leading-tight text-muted-foreground">
                            An admin will approve or deny it.
                          </p>
                        )}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t px-3 py-1.5">
                        <div className="grid gap-1.5 md:grid-cols-2">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">
                              Description
                            </p>
                            <p className="text-sm">{market.description}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">
                              Resolution Criteria
                            </p>
                            <p className="text-sm">
                              {market.resolution_criteria}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">
                              Close Date
                            </p>
                            <p className="text-sm">
                              {formatDate(market.close_at)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">
                              Category
                            </p>
                            <p className="text-sm">{market.category}</p>
                          </div>
                          {reviewNotes && (
                            <div className="md:col-span-2">
                              <p className="text-xs font-medium text-muted-foreground">
                                Reviewer Comment
                              </p>
                              <p className="text-sm">{reviewNotes}</p>
                            </div>
                          )}
                          {market.link && (
                            <div className="md:col-span-2">
                              <p className="text-xs font-medium text-muted-foreground">
                                Link
                              </p>
                              <p className="text-sm break-all">{market.link}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {proposedMarkets.length > 3 && (
            <div className="pt-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-0 text-xs"
                onClick={() => setShowAllProposed((prev) => !prev)}
              >
                {showAllProposed ? "Show less" : "Show all"}
              </Button>
            </div>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Transaction History</h2>
        <Card size="sm" className="!gap-0 !py-0">
          <CardContent className="divide-y divide-border !p-0">
            {userTxs.map((tx) => {
              const market = tx.market_id ? getMarketById(tx.market_id) : null;
              const isPositive = tx.amount > 0;

              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between px-4 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {TX_LABELS[tx.transaction_type] ?? tx.transaction_type}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {market ? market.title : "Account"}
                      {" · "}
                      {new Date(tx.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                  <span
                    className={`flex items-center gap-0.5 text-sm font-semibold ${isPositive ? "text-success" : "text-danger"}`}
                  >
                    {isPositive ? "+" : ""}
                    <TartanCoin size={14} />
                    {Math.abs(tx.amount).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
