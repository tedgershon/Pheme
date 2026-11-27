import { ArrowRight, Clock3, Scale } from "lucide-react";
import Link from "next/link";
import type { Market } from "@/lib/types";
import { cn } from "@/lib/utils";

const HOUR = 60 * 60 * 1000;

function timeLeft(deadline: string | null | undefined): string | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "Finalizing";
  if (ms < HOUR) return "Under 1h left";
  if (ms < 24 * HOUR) return `${Math.floor(ms / HOUR)}h left`;
  return `${Math.round(ms / (24 * HOUR))}d left`;
}

/**
 * Where the market is in resolution: a creator's proposal (open to disputes
 * until dispute_deadline) or a community vote (until resolution_window_end).
 * See docs/MARKET_LIFECYCLE.md.
 */
function ResolutionStage({ market }: { market: Market }) {
  const proposed = market.proposed_outcome;
  const remaining = timeLeft(
    proposed ? market.dispute_deadline : market.resolution_window_end,
  );
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {proposed ? (
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-semibold",
            proposed === "YES"
              ? "bg-success/12 text-success"
              : "bg-danger/10 text-danger",
          )}
        >
          Proposed {proposed === "YES" ? "Yes" : "No"}
        </span>
      ) : (
        <span className="rounded bg-muted px-1.5 py-0.5 font-semibold text-foreground">
          Community vote
        </span>
      )}
      {remaining && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Clock3 aria-hidden="true" className="size-3" />
          {proposed && remaining !== "Finalizing"
            ? `Disputes close · ${remaining}`
            : remaining}
        </span>
      )}
    </div>
  );
}

export function PendingResolutionList({
  markets,
  className,
}: {
  markets: Market[];
  className?: string;
}) {
  return (
    <section
      aria-labelledby="home-pending-heading"
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border bg-card p-5 text-card-foreground shadow-xs",
        className,
      )}
    >
      <h2
        id="home-pending-heading"
        className="flex items-center gap-2 text-base font-bold"
      >
        <Scale aria-hidden="true" className="size-4 text-brand-accent" />
        Pending Resolution
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Proposed outcomes and community votes in progress.
      </p>
      <ol className="mt-3 divide-y">
        {markets.map((market, index) => (
          <li key={market.id} data-testid="home-pending-market-card">
            <Link
              href={`/markets/${market.id}`}
              className="group flex gap-3 rounded-md py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span
                aria-hidden="true"
                className="w-4 shrink-0 pt-px text-sm font-semibold tabular-nums text-muted-foreground"
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-sm font-semibold leading-snug group-hover:underline">
                  {market.title}
                </p>
                <ResolutionStage market={market} />
              </div>
            </Link>
          </li>
        ))}
      </ol>
      <Link
        href="/resolutions"
        className="mt-auto inline-flex items-center gap-1 self-start rounded-sm pt-3 text-sm font-semibold text-brand-tint-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        All resolutions <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    </section>
  );
}
