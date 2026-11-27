import { useId } from "react";
import { cn } from "@/lib/utils";

/** A filled, two-tone flame: orange-red outer fire with a yellow core. */
export function FireIcon({ className }: { className?: string }) {
  // Keep the id safe inside url(#...) references.
  const id = useId().replace(/[^\w-]/g, "");
  const outer = `${id}-outer`;
  const inner = `${id}-inner`;
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn("size-4 shrink-0", className)}
    >
      <defs>
        <linearGradient id={outer} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fb923c" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
        <linearGradient id={inner} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${outer})`}
        d="M12.6 1.5c.4 3.1 2.6 5 4.3 6.9C18.6 10.3 20 12.4 20 15.2 20 19.5 16.4 23 12 23s-8-3.5-8-7.8c0-2.6 1.2-4.7 2.8-6.2.2 1.7 1 2.9 2.2 3.6C8.7 8.4 10 4.4 12.6 1.5z"
      />
      <path
        fill={`url(#${inner})`}
        d="M12.3 11.5c.3 1.7 1.6 2.6 2.4 3.6.6.7.9 1.5.9 2.4A3.6 3.6 0 0 1 12 21a3.6 3.6 0 0 1-3.6-3.5c0-1.5.8-2.7 1.8-3.6.1.8.5 1.4 1.1 1.7-.2-1.4 0-2.8 1-4.1z"
      />
    </svg>
  );
}
