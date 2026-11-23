"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { TartanCoin } from "@/components/tartan-coin";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { parseApiError } from "@/lib/api";
import { MARKET_STATUS_BADGES } from "@/lib/constants";
import { adminStatsQuery } from "@/lib/query/queries/admin";
import { useMe } from "@/lib/query/queries/auth";

export default function AdminStatsPage() {
  const router = useRouter();
  const { user } = useMe();
  const {
    data: stats,
    isLoading,
    error,
  } = useQuery({
    ...adminStatsQuery(),
    enabled: user.role !== "user",
  });

  useEffect(() => {
    if (user.role === "user") {
      router.replace("/");
    }
  }, [user.role, router]);

  if (user.role === "user") return null;

  if (isLoading) {
    return (
      <div className="space-y-5">
        <section>
          <h1 className="text-3xl font-bold tracking-tight">
            Platform Statistics
          </h1>
        </section>
        <div className="flex justify-center py-12">
          <Spinner className="size-6" />
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="space-y-5">
        <section>
          <h1 className="text-3xl font-bold tracking-tight">
            Platform Statistics
          </h1>
        </section>
        <p className="text-sm text-destructive">
          {parseApiError(error, "Unable to load platform statistics.").message}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">
          Platform Statistics
        </h1>
        <p className="text-sm text-muted-foreground">
          Cumulative stats across the entire platform.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card size="sm" className="py-2">
          <CardHeader className="pb-0">
            <span className="text-xs text-muted-foreground">Total Users</span>
          </CardHeader>
          <CardContent className="space-y-2">
            <span className="text-3xl font-bold">{stats.total_users}</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stats.users_by_role).map(([role, count]) => (
                <span key={role} className="text-xs text-muted-foreground">
                  {count} {role.replace("_", " ")}
                  {count !== 1 ? "s" : ""}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card size="sm" className="py-2">
          <CardHeader className="pb-0">
            <span className="text-xs text-muted-foreground">Total Markets</span>
          </CardHeader>
          <CardContent className="space-y-2">
            <span className="text-3xl font-bold">{stats.total_markets}</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stats.markets_by_status).map(
                ([status, count]) => (
                  <Badge
                    key={status}
                    variant="secondary"
                    className={MARKET_STATUS_BADGES[status]?.className ?? ""}
                  >
                    {count} {MARKET_STATUS_BADGES[status]?.label ?? status}
                  </Badge>
                ),
              )}
            </div>
          </CardContent>
        </Card>

        <Card size="sm" className="py-2">
          <CardHeader className="pb-0">
            <span className="text-xs text-muted-foreground">
              Total Tartan Coins Traded
            </span>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-3xl font-bold">
              <TartanCoin size={28} />
              {stats.total_tartan_coins_traded.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card size="sm" className="py-2">
          <CardHeader className="pb-0">
            <span className="text-xs text-muted-foreground">
              Total Active Bets
            </span>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold">
              {stats.total_active_bets}
            </span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
