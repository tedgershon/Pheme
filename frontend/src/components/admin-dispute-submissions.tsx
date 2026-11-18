import { Badge } from "@/components/ui/badge";
import type { AdminDisputeSubmission, BettorContext } from "@/lib/types";

const CONTEXT_LABEL: Record<BettorContext, string | null> = {
  none: null,
  active: "Bettor",
  refunded: "Refunded bettor",
};

function formatWhen(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Every concern filed under a market's dispute case, oldest first. Explanations
 * are user input and rendered strictly as text.
 */
export function AdminDisputeSubmissions({
  submissions,
}: {
  submissions: AdminDisputeSubmission[];
}) {
  if (submissions.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        No submissions recorded.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {submissions.map((submission) => {
        const context = CONTEXT_LABEL[submission.bettor_context];
        return (
          <li
            key={submission.id}
            className="space-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {submission.submitter.andrew_id ??
                  submission.submitter.display_name ??
                  "Unknown"}
              </span>
              {context && <Badge variant="outline">{context}</Badge>}
              <span>{formatWhen(submission.created_at)}</span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm">
              {submission.explanation}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
