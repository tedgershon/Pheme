"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminDisputeSubmissions } from "@/components/admin-dispute-submissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { type AdminDisputeCaseParams, parseApiError } from "@/lib/api";
import { adminDisputeCasesQuery } from "@/lib/query/queries/admin";
import { useMe } from "@/lib/query/queries/auth";
import type { AdminDisputeCase } from "@/lib/types";

const PAGE_SIZE = 10;

type StatusFilter = NonNullable<AdminDisputeCaseParams["status"]> | "all";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All cases" },
  { value: "disputed", label: "Voting open" },
  { value: "admin_review", label: "Awaiting admin" },
];

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

function CaseCard({ item }: { item: AdminDisputeCase }) {
  const { market } = item;
  const awaitingAdmin = market.status === "admin_review";
  return (
    <Card size="sm" id={`dispute-case-${market.id}`}>
      <CardHeader className="space-y-2 pb-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={awaitingAdmin ? "destructive" : "secondary"}>
            {awaitingAdmin ? "Awaiting admin decision" : "Voting open"}
          </Badge>
          <Badge variant="outline">
            {item.submission_count} concern
            {item.submission_count === 1 ? "" : "s"}
          </Badge>
          <Badge variant="outline">{market.category}</Badge>
        </div>
        <Link
          href={`/markets/${market.id}`}
          className="text-lg font-semibold hover:underline"
        >
          {market.title}
        </Link>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm md:grid-cols-4">
          <dt className="text-muted-foreground">Creator</dt>
          <dd className="font-medium">
            {item.creator?.andrew_id ?? item.creator?.display_name ?? "Unknown"}
          </dd>
          <dt className="text-muted-foreground">Creator proposal</dt>
          <dd className="font-medium">
            {market.proposed_outcome
              ? `${market.proposed_outcome} (${formatDate(market.proposed_at)})`
              : "None"}
          </dd>
          <dt className="text-muted-foreground">Case opened</dt>
          <dd className="font-medium">{formatDate(item.opened_at)}</dd>
          <dt className="text-muted-foreground">Voting deadline</dt>
          <dd className="font-medium">{formatDate(item.voting_deadline)}</dd>
          <dt className="text-muted-foreground">Votes</dt>
          <dd className="font-medium">
            YES {item.dispute_votes.yes} · NO {item.dispute_votes.no}
          </dd>
          <dt className="text-muted-foreground">Bettors</dt>
          <dd className="font-medium">{item.bettor_count}</dd>
        </dl>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Resolution criteria
            </span>
            <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              {market.resolution_criteria}
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Official source
            </span>
            <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              {market.official_source ?? "—"}
            </p>
          </div>
        </div>

        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Submitted concerns
          </span>
          <AdminDisputeSubmissions submissions={item.submissions} />
        </div>

        <div className="border-t pt-3 text-sm">
          {awaitingAdmin ? (
            <Link
              href={`/admin/resolve#resolve-${market.id}`}
              className="font-medium text-primary hover:underline"
            >
              Make the final call in Resolve Markets
            </Link>
          ) : (
            <span className="italic text-muted-foreground">
              Neutral voting is still open. This market moves to Resolve Markets
              only if the vote ends without a result.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminDisputeCasesPage() {
  const router = useRouter();
  const { user } = useMe();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const params: AdminDisputeCaseParams = {
    status: filter === "all" ? undefined : filter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    ...adminDisputeCasesQuery(params),
    enabled: isAdmin,
  });

  // The proxy gates this route server-side; this only covers role preview.
  useEffect(() => {
    if (user.role === "user") router.replace("/");
  }, [user.role, router]);

  if (!isAdmin) return null;

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <section className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Monitor Disputes
          </h1>
          <p className="text-sm text-muted-foreground">
            Concerns users filed against a creator&apos;s proposed outcome, and
            the vote on each, grouped by market. This page is view-only:
            outcomes are decided in Resolve Markets.
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

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={filter === option.value ? "default" : "outline"}
            onClick={() => {
              setFilter(option.value);
              setPage(0);
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : isError ? (
        <Card size="sm">
          <CardContent className="space-y-3 py-6 text-center">
            <p className="text-sm text-danger">
              {parseApiError(error, "Could not load dispute cases.").message}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card size="sm">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No disputed markets match this filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <CaseCard key={item.dispute_id} item={item} />
          ))}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Page {page + 1} of {pageCount} · {total} case
              {total === 1 ? "" : "s"}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0 || isFetching}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pageCount || isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
