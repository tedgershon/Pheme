"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  CATEGORIES,
  MAX_MARKET_DESCRIPTION_LENGTH,
  MAX_MARKET_LINK_LENGTH,
  MAX_MARKET_RESOLUTION_LENGTH,
  MAX_MARKET_REVIEW_NOTES_LENGTH,
  MAX_MARKET_TITLE_LENGTH,
} from "@/lib/constants";
import { datetimeLocalToIso, formatForDatetimeLocal } from "@/lib/datetime";
import { queryKeys } from "@/lib/query/keys";
import { useReviewMarket } from "@/lib/query/mutations/admin";
import { marketsForReviewQuery } from "@/lib/query/queries/admin";
import { useMe } from "@/lib/query/queries/auth";
import type { Market } from "@/lib/types";

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getCreatorName(market: Market & Record<string, unknown>): string {
  const profiles = market.profiles as
    | { andrew_id?: string; display_name?: string }
    | undefined;
  return profiles?.andrew_id ?? "Unknown";
}

function getReviewerName(market: Market & Record<string, unknown>): string {
  const reviewer = market.reviewer as
    | { andrew_id?: string; display_name?: string }
    | undefined;
  return reviewer?.andrew_id ?? "—";
}

interface ReviewPanelProps {
  market: Market & Record<string, unknown>;
  onAction: () => void;
}

function ReviewPanel({ market, onAction }: ReviewPanelProps) {
  const review = useReviewMarket();
  const [title, setTitle] = useState(market.title);
  const [description, setDescription] = useState(market.description);
  const [resolutionCriteria, setResolutionCriteria] = useState(
    market.resolution_criteria,
  );
  const [closeAt, setCloseAt] = useState(
    formatForDatetimeLocal(market.close_at),
  );
  const [category, setCategory] = useState(market.category);
  const [link, setLink] = useState(market.link ?? "");
  const [notes, setNotes] = useState("");
  const [notesError, setNotesError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const prefix = `review-${market.id}`;
  const inputClass =
    "w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

  async function handleAction(action: "approve" | "deny") {
    setNotesError(null);
    setActionError(null);

    if (action === "deny" && !notes.trim()) {
      setNotesError("Notes are required when denying a market.");
      return;
    }

    try {
      await review.mutateAsync({
        marketId: market.id,
        body: {
          action,
          notes: notes.trim() || undefined,
          title: title !== market.title ? title : null,
          description: description !== market.description ? description : null,
          resolution_criteria:
            resolutionCriteria !== market.resolution_criteria
              ? resolutionCriteria
              : null,
          close_at:
            closeAt !== formatForDatetimeLocal(market.close_at)
              ? datetimeLocalToIso(closeAt)
              : null,
          category: category !== market.category ? category : null,
          link: link !== (market.link ?? "") ? link || null : null,
        },
      });
      onAction();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed.");
    }
  }

  return (
    <div className="space-y-4 border-t pt-4 px-4 pb-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1">
            <label
              htmlFor={`${prefix}-title`}
              className="text-xs font-medium text-muted-foreground"
            >
              Title
            </label>
            <input
              id={`${prefix}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_MARKET_TITLE_LENGTH}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`${prefix}-desc`}
              className="text-xs font-medium text-muted-foreground"
            >
              Description
            </label>
            <textarea
              id={`${prefix}-desc`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={MAX_MARKET_DESCRIPTION_LENGTH}
              className={`${inputClass} resize-none`}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`${prefix}-res`}
              className="text-xs font-medium text-muted-foreground"
            >
              Resolution Criteria
            </label>
            <textarea
              id={`${prefix}-res`}
              value={resolutionCriteria}
              onChange={(e) => setResolutionCriteria(e.target.value)}
              rows={2}
              maxLength={MAX_MARKET_RESOLUTION_LENGTH}
              className={`${inputClass} resize-none`}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`${prefix}-close`}
              className="text-xs font-medium text-muted-foreground"
            >
              Close Date
            </label>
            <input
              id={`${prefix}-close`}
              type="datetime-local"
              value={closeAt}
              onChange={(e) => setCloseAt(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`${prefix}-cat`}
              className="text-xs font-medium text-muted-foreground"
            >
              Category
            </label>
            <select
              id={`${prefix}-cat`}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`${prefix}-link`}
              className="text-xs font-medium text-muted-foreground"
            >
              Link
            </label>
            <input
              id={`${prefix}-link`}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://..."
              maxLength={MAX_MARKET_LINK_LENGTH}
              className={inputClass}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Official Source (read-only)
            </span>
            <p className="text-sm rounded-lg border border-border bg-muted/30 px-4 py-2.5">
              {market.official_source ?? "—"}
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Yes Criteria (read-only)
            </span>
            <p className="text-sm rounded-lg border border-border bg-muted/30 px-4 py-2.5">
              {market.yes_criteria ?? "—"}
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              No Criteria (read-only)
            </span>
            <p className="text-sm rounded-lg border border-border bg-muted/30 px-4 py-2.5">
              {market.no_criteria ?? "—"}
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Ambiguity Criteria (read-only)
            </span>
            <p className="text-sm rounded-lg border border-border bg-muted/30 px-4 py-2.5">
              {market.ambiguity_criteria ?? "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <label
            htmlFor={`${prefix}-notes`}
            className="text-xs font-medium text-muted-foreground"
          >
            Notes for Creator
          </label>
          <textarea
            id={`${prefix}-notes`}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesError(null);
            }}
            placeholder="Leave a note for the market creator with feedback or suggested changes..."
            rows={3}
            maxLength={MAX_MARKET_REVIEW_NOTES_LENGTH}
            className={`${inputClass} resize-none ${notesError ? "border-danger" : ""}`}
          />
          {notesError && <p className="text-xs text-danger">{notesError}</p>}
        </div>

        {actionError && <p className="text-sm text-danger">{actionError}</p>}

        <div className="flex gap-2">
          <Button
            variant="destructive"
            onClick={() => handleAction("deny")}
            disabled={review.isPending}
          >
            {review.isPending ? <Spinner /> : "Deny Market"}
          </Button>
          <Button
            className="bg-success text-success-foreground hover:bg-success/80"
            onClick={() => handleAction("approve")}
            disabled={review.isPending}
          >
            {review.isPending ? <Spinner /> : "Approve Market"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ market }: { market: Market & Record<string, unknown> }) {
  const fieldClass =
    "text-sm rounded-lg border border-border bg-muted/30 px-4 py-2.5";

  return (
    <div className="space-y-4 border-t pt-4 px-4 pb-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Title
            </span>
            <p className={fieldClass}>{market.title}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Description
            </span>
            <p className={fieldClass}>{market.description}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Resolution Criteria
            </span>
            <p className={fieldClass}>{market.resolution_criteria}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Close Date
            </span>
            <p className={fieldClass}>{formatDate(market.close_at)}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Category
            </span>
            <p className={fieldClass}>{market.category}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Link
            </span>
            <p className={fieldClass}>{market.link ?? "—"}</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Official Source
            </span>
            <p className={fieldClass}>{market.official_source ?? "—"}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Yes Criteria
            </span>
            <p className={fieldClass}>{market.yes_criteria ?? "—"}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              No Criteria
            </span>
            <p className={fieldClass}>{market.no_criteria ?? "—"}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Ambiguity Criteria
            </span>
            <p className={fieldClass}>{market.ambiguity_criteria ?? "—"}</p>
          </div>
        </div>
      </div>
      {(market.review_notes as string | null) && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Reviewer Comment
          </span>
          <p className={fieldClass}>{market.review_notes as string}</p>
        </div>
      )}
    </div>
  );
}

interface AccordionSectionProps {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function AccordionSection({
  title,
  count,
  defaultOpen = false,
  children,
}: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card size="sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold">
          {title}{" "}
          <Badge variant="outline" className="ml-1">
            {count}
          </Badge>
        </span>
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
      </button>
      {open && <CardContent className="!pt-0">{children}</CardContent>}
    </Card>
  );
}

function AdminReviewPageContent() {
  const router = useRouter();
  const { user } = useMe();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const { data, isLoading } = useQuery({
    ...marketsForReviewQuery(),
    enabled: user.role !== "user",
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [appliedDeepLink, setAppliedDeepLink] = useState(false);

  useEffect(() => {
    if (user.role === "user") {
      router.replace("/");
    }
  }, [user.role, router]);

  // deep-link from notification: scroll to and expand the market row
  useEffect(() => {
    if (isLoading || !data || appliedDeepLink) return;

    const marketId = searchParams.get("marketId");
    if (!marketId) {
      setAppliedDeepLink(true);
      return;
    }

    const existsInPending = (data.pending ?? []).some((m) => m.id === marketId);
    setAppliedDeepLink(true);
    if (!existsInPending) return;

    setExpandedId(marketId);
    requestAnimationFrame(() => {
      const row = document.getElementById(`review-market-${marketId}`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [appliedDeepLink, data, isLoading, searchParams]);

  if (user.role === "user") return null;

  if (isLoading) {
    return (
      <div className="space-y-5">
        <section>
          <h1 className="text-3xl font-bold tracking-tight">Review Markets</h1>
        </section>
        <div className="flex justify-center py-12">
          <Spinner className="size-6" />
        </div>
      </div>
    );
  }

  const pending = data?.pending ?? [];
  const approved = data?.approved ?? [];
  const denied = data?.denied ?? [];

  function handleAction() {
    setExpandedId(null);
    // mutation already invalidates the review list
  }

  function renderTable(
    markets: Market[],
    showReviewer: boolean,
    mode: "review" | "detail",
  ) {
    if (markets.length === 0) {
      return (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No markets in this section.
        </p>
      );
    }

    return (
      <div className="divide-y divide-border">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-2 py-2 text-xs font-medium text-muted-foreground">
          <span>Title</span>
          <span>Proposed By</span>
          <span>Proposed Date</span>
          <span>Reviewed By</span>
          <span>Review Date</span>
        </div>
        {markets.map((market) => {
          const m = market as Market & Record<string, unknown>;
          const isExpanded = expandedId === market.id;
          return (
            <div key={market.id} id={`review-market-${market.id}`}>
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : market.id)}
                className="grid w-full grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-2 py-2.5 text-left text-sm cursor-pointer hover:bg-muted/50"
              >
                <span className="font-medium truncate">{market.title}</span>
                <span className="text-muted-foreground">
                  {getCreatorName(m)}
                </span>
                <span className="text-muted-foreground">
                  {formatDate(market.created_at)}
                </span>
                <span className="text-muted-foreground">
                  {showReviewer ? getReviewerName(m) : "—"}
                </span>
                <span className="text-muted-foreground">
                  {showReviewer ? formatDate(market.review_date) : "—"}
                </span>
              </button>
              {isExpanded &&
                (mode === "review" ? (
                  <ReviewPanel market={m} onAction={handleAction} />
                ) : (
                  <DetailPanel market={m} />
                ))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Review Markets</h1>
          <p className="text-sm text-muted-foreground">
            Review, edit, and approve or deny proposed markets.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            qc.invalidateQueries({ queryKey: queryKeys.markets.review })
          }
        >
          Refresh
        </Button>
      </section>

      <div className="space-y-3">
        <AccordionSection
          title="Pending Review"
          count={pending.length}
          defaultOpen
        >
          {renderTable(pending, false, "review")}
        </AccordionSection>

        <AccordionSection title="Approved" count={approved.length}>
          {renderTable(approved, true, "detail")}
        </AccordionSection>

        <AccordionSection title="Denied" count={denied.length}>
          {renderTable(denied, true, "detail")}
        </AccordionSection>
      </div>
    </div>
  );
}

export default function AdminReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-5">
          <section>
            <h1 className="text-3xl font-bold tracking-tight">
              Review Markets
            </h1>
          </section>
          <div className="flex justify-center py-12">
            <Spinner className="size-6" />
          </div>
        </div>
      }
    >
      <AdminReviewPageContent />
    </Suspense>
  );
}
