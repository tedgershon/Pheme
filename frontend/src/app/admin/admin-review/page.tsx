"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminDisputeSubmissions } from "@/components/admin-dispute-submissions";
import { BananaCoin } from "@/components/banana-coin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { parseApiError } from "@/lib/api";
import { useAdminResolveMarket } from "@/lib/query/mutations/admin";
import { adminReviewQueueQuery } from "@/lib/query/queries/admin";
import { useMe } from "@/lib/query/queries/auth";
import type {
  AdminReviewItem,
  AdminReviewPerson,
  ResolvedOutcome,
} from "@/lib/types";

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

function personName(person: AdminReviewPerson | null): string {
  return person?.andrew_id ?? person?.display_name ?? "Unknown";
}

const OUTCOME_COPY: Record<
  ResolvedOutcome,
  { label: string; confirm: string; className: string }
> = {
  YES: {
    label: "Resolve YES",
    confirm:
      "Settle this market as YES? Winning stakes share the full pool. This cannot be undone.",
    className:
      "text-success border-success hover:bg-success hover:text-success-foreground",
  },
  NO: {
    label: "Resolve NO",
    confirm:
      "Settle this market as NO? Winning stakes share the full pool. This cannot be undone.",
    className:
      "text-danger border-danger hover:bg-danger hover:text-danger-foreground",
  },
  AMBIGUOUS: {
    label: "Ambiguous — refund all",
    confirm:
      "Resolve as AMBIGUOUS? Every bettor gets their full stake back and nobody wins. This cannot be undone.",
    className:
      "border-amber-500 text-amber-600 hover:bg-amber-500 hover:text-white",
  },
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
        {children}
      </div>
    </div>
  );
}

function QueueItem({
  item,
  currentUserId,
  onResolved,
}: {
  item: AdminReviewItem;
  currentUserId: string;
  onResolved: (message: string) => void;
}) {
  const { market } = item;
  const resolve = useAdminResolveMarket();
  const [pending, setPending] = useState<ResolvedOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMultichoice = market.market_type === "multichoice";
  const isOwnMarket = market.creator_id === currentUserId;
  const outcomes: ResolvedOutcome[] = isMultichoice
    ? ["AMBIGUOUS"]
    : ["YES", "NO", "AMBIGUOUS"];
  const totalPool = isMultichoice
    ? (market.options ?? []).reduce((sum, o) => sum + o.pool_total, 0)
    : market.yes_pool_total + market.no_pool_total;

  async function confirm() {
    if (!pending) return;
    const outcome = pending;
    setPending(null);
    setError(null);
    try {
      const result = await resolve.mutateAsync({
        marketId: market.id,
        outcome,
      });
      onResolved(
        outcome === "AMBIGUOUS"
          ? `"${market.title}" resolved as ambiguous: refunded ${(result.refunded_total ?? 0).toLocaleString()} to ${result.refunded_users ?? 0} bettor(s).`
          : `"${market.title}" resolved ${outcome}; payouts settled.`,
      );
    } catch (err) {
      setError(parseApiError(err, "Failed to resolve market.").message);
    }
  }

  return (
    <Card size="sm" id={`admin-review-${market.id}`}>
      <CardHeader className="space-y-2 pb-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              item.escalation === "dispute" ? "destructive" : "secondary"
            }
          >
            {item.escalation === "dispute"
              ? "Dispute unresolved"
              : "Community vote inconclusive"}
          </Badge>
          {isMultichoice && <Badge variant="outline">Multiple choice</Badge>}
          <Badge variant="outline">{market.category}</Badge>
        </div>
        <Link
          href={`/markets/${market.id}`}
          className="text-lg font-semibold hover:underline"
        >
          {market.title}
        </Link>
        <p className="text-sm text-muted-foreground">{market.description}</p>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Resolution criteria">
            {market.resolution_criteria}
          </Field>
          <Field label="Official source">
            {market.official_source ?? "—"}
            {market.link && (
              <>
                {" · "}
                <a
                  href={market.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Source link
                </a>
              </>
            )}
          </Field>
          {!isMultichoice && (
            <>
              <Field label="YES criteria">{market.yes_criteria ?? "—"}</Field>
              <Field label="NO criteria">{market.no_criteria ?? "—"}</Field>
            </>
          )}
          <Field label="Ambiguity criteria">
            {market.ambiguity_criteria ?? "—"}
          </Field>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm md:grid-cols-4">
          <dt className="text-muted-foreground">Creator</dt>
          <dd className="font-medium">{personName(item.creator)}</dd>
          <dt className="text-muted-foreground">Creator proposal</dt>
          <dd className="font-medium">
            {market.proposed_outcome
              ? `${market.proposed_outcome} (${formatDate(market.proposed_at)})`
              : "None — community track"}
          </dd>
          <dt className="text-muted-foreground">Closed</dt>
          <dd className="font-medium">{formatDate(market.close_at)}</dd>
          {market.proposed_outcome ? (
            <>
              <dt className="text-muted-foreground">Dispute deadline</dt>
              <dd className="font-medium">
                {formatDate(market.dispute_deadline)}
              </dd>
            </>
          ) : (
            <>
              <dt className="text-muted-foreground">Community window ended</dt>
              <dd className="font-medium">
                {formatDate(market.resolution_window_end)}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Total pool</dt>
          <dd className="inline-flex items-center gap-0.5 font-medium">
            <BananaCoin size={14} />
            {totalPool.toLocaleString()}
          </dd>
          {!isMultichoice && (
            <>
              <dt className="text-muted-foreground">YES / NO pools</dt>
              <dd className="font-medium">
                {market.yes_pool_total.toLocaleString()} /{" "}
                {market.no_pool_total.toLocaleString()}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Bettors</dt>
          <dd className="font-medium">{item.bettor_count}</dd>
          <dt className="text-muted-foreground">
            {item.escalation === "dispute"
              ? "Dispute votes"
              : "Community votes"}
          </dt>
          <dd className="font-medium">
            {item.escalation === "dispute"
              ? `YES ${item.dispute_votes.yes} · NO ${item.dispute_votes.no}`
              : `YES ${item.community_votes.yes} · NO ${item.community_votes.no}`}
          </dd>
        </dl>

        {isMultichoice && (market.options ?? []).length > 0 && (
          <Field label="Option pools">
            {(market.options ?? [])
              .map((o) => `${o.label}: ${o.pool_total.toLocaleString()}`)
              .join(" · ")}
          </Field>
        )}

        {item.dispute && (
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {`${item.dispute.submission_count} submitted concern${item.dispute.submission_count === 1 ? "" : "s"} · case opened ${formatDate(item.dispute.created_at)} · voting ended ${formatDate(item.dispute.voting_deadline)}`}
            </span>
            <AdminDisputeSubmissions submissions={item.dispute.submissions} />
          </div>
        )}

        <div className="space-y-2 border-t pt-3">
          {error && <p className="text-sm text-danger">{error}</p>}
          {isOwnMarket ? (
            <p className="text-sm italic text-muted-foreground">
              You created this market, so another admin must resolve it.
            </p>
          ) : pending ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm">{OUTCOME_COPY[pending].confirm}</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button onClick={confirm}>Confirm</Button>
              </div>
            </div>
          ) : (
            <>
              {isMultichoice && (
                <p className="text-xs text-muted-foreground">
                  Option-based settlement is not available yet; this market can
                  only be refunded here.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {outcomes.map((outcome) => (
                  <Button
                    key={outcome}
                    variant="outline"
                    className={OUTCOME_COPY[outcome].className}
                    disabled={resolve.isPending}
                    onClick={() => setPending(outcome)}
                  >
                    {resolve.isPending &&
                    resolve.variables?.outcome === outcome ? (
                      <Spinner />
                    ) : (
                      OUTCOME_COPY[outcome].label
                    )}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminResolutionQueuePage() {
  const router = useRouter();
  const { user } = useMe();
  const [notice, setNotice] = useState<string | null>(null);
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    ...adminReviewQueueQuery(),
    enabled: isAdmin,
  });

  // The proxy gates this route server-side; this only covers role preview.
  useEffect(() => {
    if (user.role === "user") router.replace("/");
  }, [user.role, router]);

  if (!isAdmin) return null;

  const items = data ?? [];

  return (
    <div className="space-y-5">
      <section className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Review</h1>
          <p className="text-sm text-muted-foreground">
            Markets whose dispute or community vote ended without a decision.
            Review the evidence and settle each one.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          Refresh
        </Button>
      </section>

      {notice && (
        <p className="rounded-lg border border-success/40 bg-success/10 px-4 py-2 text-sm text-success">
          {notice}
        </p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : isError ? (
        <Card size="sm">
          <CardContent className="space-y-3 py-6 text-center">
            <p className="text-sm text-danger">
              {
                parseApiError(error, "Could not load the admin review queue.")
                  .message
              }
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card size="sm">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No markets are waiting for admin review.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <QueueItem
              key={item.market.id}
              item={item}
              currentUserId={user.id}
              onResolved={setNotice}
            />
          ))}
        </div>
      )}
    </div>
  );
}
