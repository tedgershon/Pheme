"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Clock, Timer } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BananaCoin } from "@/components/banana-coin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { parseApiError } from "@/lib/api";
import {
  useCastCommunityVote,
  useCastDisputeVote,
} from "@/lib/query/mutations/markets";
import { useMe } from "@/lib/query/queries/auth";
import {
  communityVotesQuery,
  disputeVotesQuery,
  resolutionMarketsQuery,
} from "@/lib/query/queries/markets";
import type { Market } from "@/lib/types";
import { cn } from "@/lib/utils";

// local countdown timer — pure UI state
function useCountdown(targetDate: string | null | undefined) {
  const [remaining, setRemaining] = useState("");
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    if (!targetDate) {
      setRemaining("—");
      return;
    }

    function tick() {
      const diff = new Date(targetDate as string).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("Expired");
        setUrgent(false);
        return;
      }
      const hours = Math.floor(diff / 3_600_000);
      const minutes = Math.floor((diff % 3_600_000) / 60_000);
      const seconds = Math.floor((diff % 60_000) / 1_000);
      setUrgent(hours < 1);
      if (hours > 0) {
        setRemaining(`${hours}h ${minutes}m ${seconds}s`);
      } else {
        setRemaining(`${minutes}m ${seconds}s`);
      }
    }

    tick();
    const interval = setInterval(tick, 1_000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return { remaining, urgent };
}

function ResolutionCard({
  market,
  userId,
}: {
  market: Market;
  userId: string;
}) {
  const isDisputeMode = market.status === "disputed";
  const targetDate = isDisputeMode
    ? market.voting_ends_at
    : market.resolution_window_end;
  const { remaining, urgent } = useCountdown(targetDate);

  // each card fetches its own votes via RQ — dedup + cache share if the
  // user opens the market detail page right after
  const { data: disputeVotes = [] } = useQuery({
    ...disputeVotesQuery(market.id),
    enabled: isDisputeMode,
  });
  const { data: communityVotes = [] } = useQuery({
    ...communityVotesQuery(market.id),
    enabled: !isDisputeMode,
  });

  const votes = isDisputeMode ? disputeVotes : communityVotes;
  const tally = votes.reduce(
    (acc, v) => {
      if (v.selected_outcome === "YES") acc.yes += 1;
      else acc.no += 1;
      return acc;
    },
    { yes: 0, no: 0 },
  );
  const userVote =
    votes.find((v) => v.voter_id === userId)?.selected_outcome ?? null;

  const disputeMut = useCastDisputeVote();
  const communityMut = useCastCommunityVote();
  const voting = disputeMut.isPending || communityMut.isPending;
  const [error, setError] = useState<string | null>(null);

  const isCreator = userId === market.creator_id;
  const totalPool = market.yes_pool_total + market.no_pool_total;
  const rewardPool = Math.round(totalPool * 0.04);
  const isExpired = remaining === "Expired";

  async function handleVote(side: "YES" | "NO") {
    setError(null);
    try {
      if (isDisputeMode) {
        await disputeMut.mutateAsync({ marketId: market.id, vote: side });
      } else {
        await communityMut.mutateAsync({ marketId: market.id, vote: side });
      }
    } catch (err) {
      setError(parseApiError(err, "Failed to cast vote.").message);
    }
  }

  return (
    <Card size="sm">
      <CardHeader className="pb-2">
        <Link
          href={`/markets/${market.id}`}
          className="text-base font-semibold hover:underline"
        >
          {market.title}
        </Link>
        <Badge variant="outline" className="w-fit">
          {market.category}
        </Badge>
        <Badge
          variant={isDisputeMode ? "destructive" : "secondary"}
          className={cn(
            "w-fit",
            !isDisputeMode &&
              "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
          )}
        >
          {isDisputeMode ? "Under Dispute" : "Community Resolution"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Creator&apos;s Call:</span>
          {market.proposed_outcome ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold",
                market.proposed_outcome === "YES"
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
              )}
            >
              {market.proposed_outcome}
            </span>
          ) : (
            <span className="italic text-muted-foreground">Undecided</span>
          )}
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-success font-medium">YES: {tally.yes}</span>
          <span className="text-danger font-medium">NO: {tally.no}</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Timer className="size-4 text-muted-foreground" />
          <span className={cn("font-medium", urgent && "text-danger")}>
            {isExpired ? "Expired" : `Resolves in ${remaining}`}
          </span>
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          Reward pool:
          <BananaCoin size={12} />
          <span className="font-medium">{rewardPool.toLocaleString()}</span>
        </div>

        {isCreator ? (
          <p className="text-xs italic text-muted-foreground">
            You are the creator of this market
          </p>
        ) : userVote ? (
          <p className="text-xs font-medium text-muted-foreground">
            You voted {userVote}
          </p>
        ) : isExpired ? (
          <p className="text-xs italic text-muted-foreground">
            Resolution window has expired
          </p>
        ) : (
          <div className="space-y-2">
            {error && (
              <p role="alert" className="text-xs font-medium text-danger">
                {error}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="h-12 text-sm bg-success text-success-foreground [box-shadow:0_4px_0_color-mix(in_oklch,var(--color-success)_70%,black)] active:[box-shadow:0_2px_0_color-mix(in_oklch,var(--color-success)_70%,black)] hover:bg-success/90"
                onClick={() => handleVote("YES")}
                disabled={voting}
              >
                Vote YES
              </Button>
              <Button
                className="h-12 text-sm bg-danger text-danger-foreground [box-shadow:0_4px_0_color-mix(in_oklch,var(--color-danger)_70%,black)] active:[box-shadow:0_2px_0_color-mix(in_oklch,var(--color-danger)_70%,black)] hover:bg-danger/90"
                onClick={() => handleVote("NO")}
                disabled={voting}
              >
                Vote NO
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResolutionsPage() {
  const { user } = useMe();
  // refetchInterval replaces the old manual setInterval
  const { data: markets = [], isLoading } = useQuery({
    ...resolutionMarketsQuery(),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Resolutions</h1>
        <p className="text-sm text-muted-foreground">
          Help resolve markets by voting on the correct outcome. Voters receive
          a share of each market they help resolve.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium text-foreground">Your vote matters!</p>
          <p className="text-muted-foreground">
            Help resolve markets by voting. Correct voters receive a percentage
            of each market they help resolve. Incorrect votes will result in
            forfeiture of the coin prize for voting.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : markets.length === 0 ? (
        <div className="py-12 text-center">
          <Clock className="mx-auto size-12 text-muted-foreground/30" />
          <p className="mt-4 text-muted-foreground">
            No markets are currently in their resolution period.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {markets.map((m) => (
            <ResolutionCard key={m.id} market={m} userId={user.id} />
          ))}
        </div>
      )}
    </div>
  );
}
