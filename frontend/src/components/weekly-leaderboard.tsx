"use client";

import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { TartanCoin } from "@/components/tartan-coin";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { weeklyLeaderboardQuery } from "@/lib/query/queries/leaderboard";

const PERIOD_LABELS: Record<string, string> = {
  "7d": "Past 7 days",
  "30d": "Past 30 days",
  all_time: "All time",
};

export function WeeklyLeaderboard() {
  const { data, isLoading } = useQuery(weeklyLeaderboardQuery(5));
  const entries = data?.entries ?? [];
  const period = data?.period ?? "7d";
  const leaderGains = entries.length > 0 ? entries[0].gains : 1;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          {period === "7d"
            ? "Weekly"
            : period === "30d"
              ? "Monthly"
              : "All-Time"}{" "}
          Leaderboard
        </h2>
        <span className="text-sm text-muted-foreground">
          {PERIOD_LABELS[period]}
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner className="size-6" />
        </div>
      ) : entries.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No gains recorded yet.
        </p>
      ) : (
        <Card size="sm" className="!gap-0 !py-0">
          <CardContent className="divide-y divide-border !p-0">
            {entries.map((entry, i) => {
              const rank = i + 1;
              const barWidth = (entry.gains / leaderGains) * 100;

              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-4 px-5 py-3"
                >
                  <span className="flex w-8 shrink-0 items-center justify-center text-lg font-bold text-muted-foreground">
                    {rank <= 3 ? (
                      <Trophy
                        className={
                          rank === 1
                            ? "text-yellow-500"
                            : rank === 2
                              ? "text-gray-400"
                              : "text-amber-700"
                        }
                        size={20}
                      />
                    ) : (
                      rank
                    )}
                  </span>

                  <div className="flex-1 space-y-1">
                    <div className="flex items-baseline justify-between">
                      <div>
                        <span className="text-sm font-semibold">
                          {entry.display_name}
                        </span>
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {entry.andrew_id}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-sm font-semibold text-success">
                        +
                        <TartanCoin size={14} />
                        {entry.gains.toLocaleString()}
                      </div>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-success transition-all"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
