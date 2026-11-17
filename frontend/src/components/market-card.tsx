import Link from "next/link";
import { BananaCoin } from "@/components/banana-coin";
import { getOptionColor } from "@/components/probability-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { calendarDaysUntilClose } from "@/lib/datetime";
import type { Market } from "@/lib/types";
import { getMarketProbability, isMarketOpen } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatCloseDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = date.getTime() - Date.now();
  if (diff < 0) return "Closed";
  const days = calendarDaysUntilClose(dateStr);
  if (days === 0) return "Closes today";
  if (days === 1) return "Closes tomorrow";
  if (days <= 7) return `Closes in ${days} days`;
  return `Closes ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function StatusDot({ market }: { market: Market }) {
  const { status } = market;
  if (isMarketOpen(market)) {
    return <span className="glimmer-dot size-2.5 rounded-full bg-success" />;
  }
  if (status === "disputed") {
    return <Badge variant="destructive">Under Dispute</Badge>;
  }
  if (status === "pending_resolution") {
    return (
      <Badge
        variant="secondary"
        className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
      >
        Community Resolution
      </Badge>
    );
  }
  if (status === "admin_review") {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600">
        Admin Review
      </Badge>
    );
  }
  if (status === "pending_review") {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-500">
        Under Review
      </Badge>
    );
  }
  if (status === "denied") {
    return <Badge variant="destructive">Denied</Badge>;
  }
  return <span className="size-2.5 rounded-full bg-muted-foreground/40" />;
}

function getMultichoiceLeader(market: Market) {
  const opts = market.options;
  if (!opts || opts.length === 0) return null;
  const totalPool = opts.reduce((s, o) => s + o.pool_total, 0);
  const sorted = [...opts].sort((a, b) => b.pool_total - a.pool_total);
  const leader = sorted[0];
  const pct =
    totalPool > 0 ? Math.round((leader.pool_total / totalPool) * 100) : 0;
  return { label: leader.label, pct, totalPool };
}

export function MarketCard({ market }: { market: Market }) {
  const isMultichoice = market.market_type === "multichoice";
  const probability = getMarketProbability(market);
  const isOpen = isMarketOpen(market);

  if (isMultichoice) {
    const leader = getMultichoiceLeader(market);
    const opts = market.options ?? [];
    const totalPool = opts.reduce((s, o) => s + o.pool_total, 0);
    const sorted = [...opts].sort((a, b) => b.pool_total - a.pool_total);
    const topOptions = sorted.slice(0, 3);

    return (
      <Link href={`/markets/${market.id}`}>
        <Card
          className={cn(
            "h-full",
            isOpen ? "market-card-open border-0 rounded-xl" : "",
          )}
        >
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-3">
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <StatusDot market={market} />
                <Badge variant="outline">{market.category}</Badge>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  MC
                </Badge>
              </div>
              <h3 className="text-base font-semibold leading-snug">
                {market.title}
              </h3>
            </div>
            {leader && (
              <div className="flex flex-col items-center rounded-lg bg-accent px-3 py-2">
                <span className="text-2xl font-bold">{leader.pct}%</span>
                <span className="text-xs text-muted-foreground truncate max-w-[80px]">
                  {leader.label}
                </span>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="space-y-1.5">
                {topOptions.map((opt) => {
                  const optPct =
                    totalPool > 0
                      ? Math.round((opt.pool_total / totalPool) * 100)
                      : 0;
                  const originalIdx = opts.findIndex((o) => o.id === opt.id);
                  return (
                    <div
                      key={opt.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: getOptionColor(originalIdx),
                        }}
                      />
                      <span className="flex-1 truncate font-medium">
                        {opt.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {optPct}%
                      </span>
                      <span className="inline-flex w-16 items-center justify-end gap-0.5 font-medium text-sm">
                        <BananaCoin size={14} />
                        {opt.pool_total.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
                {sorted.length > 3 && (
                  <span className="text-xs text-muted-foreground">
                    +{sorted.length - 3} more options
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-0.5">
                  <BananaCoin size={14} />
                  {totalPool.toLocaleString()} pool
                </span>
                <span>{formatCloseDate(market.close_at)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  const total = market.yes_pool_total + market.no_pool_total;

  return (
    <Link href={`/markets/${market.id}`}>
      <Card
        className={cn(
          "h-full",
          isOpen ? "market-card-open border-0 rounded-xl" : "",
        )}
      >
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-3">
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <StatusDot market={market} />
              <Badge variant="outline">{market.category}</Badge>
            </div>
            <h3 className="text-base font-semibold leading-snug">
              {market.title}
            </h3>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-accent px-3 py-2">
            <span className="text-2xl font-bold">{probability}%</span>
            <span className="text-xs text-muted-foreground">chance</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="w-8 font-medium text-success">Yes</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-success transition-all"
                    style={{ width: `${probability}%` }}
                  />
                </div>
                <span className="inline-flex w-20 items-center justify-end gap-0.5 font-medium text-success">
                  <BananaCoin size={14} />
                  {market.yes_pool_total.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="w-8 font-medium text-danger">No</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-danger transition-all"
                    style={{ width: `${100 - probability}%` }}
                  />
                </div>
                <span className="inline-flex w-20 items-center justify-end gap-0.5 font-medium text-danger">
                  <BananaCoin size={14} />
                  {market.no_pool_total.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-0.5">
                <BananaCoin size={14} />
                {total.toLocaleString()} pool
              </span>
              <span>{formatCloseDate(market.close_at)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
