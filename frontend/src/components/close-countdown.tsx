"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import { closesWithinADay, formatTimeUntilClose } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/**
 * "Closes in 5h 12m" / "Closes in 3 days" / "Closes Dec 29", refreshed every
 * minute so the hour-and-minute countdown stays current. The server and the
 * browser can be a minute apart when the page hydrates, so the label opts out
 * of the text-mismatch warning.
 */
export function CloseCountdown({
  closeAt,
  icon = false,
  emphasizeSoon = false,
  className,
}: {
  closeAt: string;
  icon?: boolean;
  /** Highlight the label once it counts down in hours and minutes. */
  emphasizeSoon?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const soon = emphasizeSoon && closesWithinADay(closeAt, now);

  return (
    <span
      suppressHydrationWarning
      className={cn(
        "inline-flex items-center gap-1",
        soon && "font-semibold text-brand-tint-foreground",
        className,
      )}
    >
      {icon && <Clock3 aria-hidden="true" className="size-[1em] shrink-0" />}
      <time dateTime={closeAt} suppressHydrationWarning>
        {formatTimeUntilClose(closeAt, now)}
      </time>
    </span>
  );
}
