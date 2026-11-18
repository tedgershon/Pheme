import { Button } from "@/components/ui/button";
import type { PublicDisputeSubmission } from "@/lib/types";

/** Mirrors the server limit; the API and database enforce it independently. */
export const DISPUTE_EXPLANATION_MAX = 1000;

export function DisputeConcernForm({
  value,
  onChange,
  onSubmit,
  submitting,
  placeholder,
  submitLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  placeholder: string;
  submitLabel: string;
}) {
  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={DISPUTE_EXPLANATION_MAX}
        placeholder={placeholder}
        className="w-full min-h-[90px] rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      <div className="text-right text-xs text-muted-foreground">
        {value.length}/{DISPUTE_EXPLANATION_MAX}
      </div>
      <Button
        variant="outline"
        className="w-full"
        onClick={onSubmit}
        disabled={submitting}
      >
        {submitting ? "Submitting..." : submitLabel}
      </Button>
    </div>
  );
}

/** Public concerns on a case. Text only; submitters are anonymous to everyone but admins. */
export function PublicDisputeSubmissions({
  items,
  total,
}: {
  items: PublicDisputeSubmission[];
  total: number;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        {total} concern{total === 1 ? "" : "s"} submitted
      </p>
      <ul className="max-h-60 space-y-2 overflow-y-auto">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
          >
            <p className="whitespace-pre-wrap break-words">
              {item.explanation}
            </p>
            {item.is_mine && (
              <p className="mt-1 text-xs text-muted-foreground">
                Submitted by you
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
