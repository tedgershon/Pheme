import { getOptionColor } from "@/components/probability-chart";
import type { Market } from "@/lib/types";
import { getMarketProbability } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface Outcome {
  key: string;
  label: string;
  /** null until the market has any coins in it. */
  pct: number | null;
  tone: "yes" | "no" | { color: string };
}

/** Total coins staked: the Yes/No pools, or every option's pool. */
export function getMarketPool(market: Market): number {
  if (market.market_type === "multichoice") {
    return (market.options ?? []).reduce((sum, o) => sum + o.pool_total, 0);
  }
  return market.yes_pool_total + market.no_pool_total;
}

/**
 * The outcomes a card shows, most likely first for multichoice markets.
 * Percentages are null for a market nobody has predicted on yet, so the UI
 * never shows an invented 50/50.
 */
export function getOutcomes(market: Market): Outcome[] {
  const pool = getMarketPool(market);
  if (market.market_type === "multichoice") {
    const options = market.options ?? [];
    return options
      .map((option, index) => ({ option, index }))
      .sort((a, b) => b.option.pool_total - a.option.pool_total)
      .map(({ option, index }) => ({
        key: option.id,
        label: option.label,
        pct: pool > 0 ? Math.round((option.pool_total / pool) * 100) : null,
        tone: { color: getOptionColor(index) },
      }));
  }
  const yes = pool > 0 ? getMarketProbability(market) : null;
  return [
    { key: "yes", label: "Yes", pct: yes, tone: "yes" },
    {
      key: "no",
      label: "No",
      pct: yes === null ? null : 100 - yes,
      tone: "no",
    },
  ];
}

const TONE_CLASSES = {
  yes: { fill: "bg-success/12", text: "text-success", dot: "bg-success" },
  no: { fill: "bg-danger/10", text: "text-danger", dot: "bg-danger" },
};

/**
 * Outcome rows with a fill behind each one showing its chance, the same
 * glanceable pattern for Yes/No and multichoice markets.
 */
export function OutcomeRows({
  outcomes,
  size = "md",
  className,
}: {
  outcomes: Outcome[];
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <ul className={cn("space-y-1.5", size === "lg" && "space-y-2", className)}>
      {outcomes.map((outcome) => {
        const tone =
          typeof outcome.tone === "string" ? TONE_CLASSES[outcome.tone] : null;
        const color =
          typeof outcome.tone === "string" ? undefined : outcome.tone.color;
        return (
          <li
            key={outcome.key}
            className={cn(
              "relative isolate flex items-center justify-between gap-3 overflow-hidden rounded-md bg-muted/70 px-3",
              size === "md" ? "py-1.5 text-sm" : "py-2.5 text-base",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-y-0 left-0 -z-10 transition-[width] duration-500",
                tone?.fill,
              )}
              style={{
                width: `${outcome.pct ?? 0}%`,
                backgroundColor: color
                  ? `color-mix(in srgb, ${color} 22%, transparent)`
                  : undefined,
              }}
            />
            <span className="flex min-w-0 items-center gap-2 font-medium">
              <span
                aria-hidden="true"
                className={cn("size-2 shrink-0 rounded-full", tone?.dot)}
                style={{ backgroundColor: color }}
              />
              <span className={cn("truncate", tone?.text)}>
                {outcome.label}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 font-bold tabular-nums",
                size === "lg" && "text-xl",
                outcome.pct === null && "font-medium text-muted-foreground",
              )}
            >
              {outcome.pct === null ? "–" : `${outcome.pct}%`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
