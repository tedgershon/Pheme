import { cn } from "@/lib/utils";

export function PhemeMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <rect width="32" height="32" rx="9" fill="var(--brand-accent, #8290ff)" />
      <path
        d="M9 23V9h7.2a4.8 4.8 0 0 1 0 9.6H13"
        fill="none"
        stroke="var(--brand-accent-ink, #0c0f1e)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="22.5" cy="23" r="2" fill="var(--brand-accent-ink, #0c0f1e)" />
    </svg>
  );
}
