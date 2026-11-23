"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import Image from "next/image";
import { BadgeCircle } from "@/components/badge";
import { TartanCoin } from "@/components/tartan-coin";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useMe } from "@/lib/query/queries/auth";
import { badgesQuery, leaderboardQuery } from "@/lib/query/queries/leaderboard";
import type { LeaderboardEntry, UserBadge } from "@/lib/types";
import { cn } from "@/lib/utils";

const TRACK_ORDER = [
  "banana_baron",
  "oracle",
  "architect",
  "degen",
  "whale",
] as const;

function getEquippedIds(entry: LeaderboardEntry): string[] {
  const selected = Object.values(entry.equipped_badges ?? {}).filter(
    (value): value is string => Boolean(value),
  );

  if (selected.length > 0) {
    return selected;
  }

  return entry.equipped_badge_id ? [entry.equipped_badge_id] : [];
}

function getSelectedByTrack(
  entry: LeaderboardEntry,
  userBadges: UserBadge[],
): Record<string, string> {
  const selected: Record<string, string> = {};

  for (const track of TRACK_ORDER) {
    const badgeId = entry.equipped_badges?.[track];
    if (badgeId) {
      selected[track] = badgeId;
    }
  }

  if (Object.keys(selected).length === 0 && entry.equipped_badge_id) {
    const legacy = userBadges.find(
      (badge) => badge.badge_id === entry.equipped_badge_id,
    );
    if (legacy) {
      selected[legacy.track] = legacy.badge_id;
    }
  }

  return selected;
}

function getEquippedBadges(
  entry: LeaderboardEntry,
  userBadges: UserBadge[],
): UserBadge[] {
  const selectedByTrack = getSelectedByTrack(entry, userBadges);

  return TRACK_ORDER.map((track) => {
    const selectedBadgeId = selectedByTrack[track];
    if (!selectedBadgeId) return null;

    return (
      userBadges.find(
        (candidate) =>
          candidate.track === track && candidate.badge_id === selectedBadgeId,
      ) ?? null
    );
  }).filter((badge): badge is UserBadge => Boolean(badge));
}

function RankBadge({ rank }: { rank: number }) {
  if (rank <= 3) {
    return (
      <div
        className={`flex size-5 items-center justify-center rounded-full text-white text-[10px] font-bold ${
          rank === 1
            ? "bg-yellow-500"
            : rank === 2
              ? "bg-gray-400"
              : "bg-amber-700"
        }`}
      >
        <Trophy size={10} />
      </div>
    );
  }
  return (
    <div className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
      {rank}
    </div>
  );
}

function UserAvatar({
  displayName,
  avatarUrl,
  rank,
}: {
  displayName: string;
  avatarUrl: string | null;
  rank: number;
}) {
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="relative shrink-0">
      <div className="flex size-10 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-muted text-sm font-medium text-muted-foreground">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            width={40}
            height={40}
            sizes="40px"
            quality={100}
            className="size-full object-cover"
          />
        ) : (
          initials
        )}
      </div>
      <div className="absolute -bottom-1 -right-1">
        <RankBadge rank={rank} />
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const { user } = useMe();
  const { data: rawEntries = [], isLoading } = useQuery(leaderboardQuery());
  const gainValue = (entry: LeaderboardEntry) =>
    Number.isFinite(entry.gain) ? entry.gain : 0;

  // sort by gain, and only fetch badges for users who have equipped any —
  // saves a ton of requests on a big leaderboard
  const entries = [...rawEntries].sort((a, b) => gainValue(b) - gainValue(a));
  const withEquipped = entries.filter(
    (entry) => getEquippedIds(entry).length > 0,
  );

  const badgeResults = useQueries({
    queries: withEquipped.map((entry) => ({
      ...badgesQuery(entry.id),
    })),
  });

  const badgeMap: Record<string, UserBadge[]> = {};
  for (let i = 0; i < withEquipped.length; i++) {
    const entry = withEquipped[i];
    const badges = badgeResults[i]?.data ?? [];
    const equippedSet = new Set(getEquippedIds(entry));
    const equipped = badges.filter((b) => equippedSet.has(b.badge_id));
    if (equipped.length > 0) badgeMap[entry.id] = equipped;
  }

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
        <p className="text-sm text-muted-foreground">
          Who's stacking the most Tartan Coins? See who's leading the pack.
        </p>
      </section>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : (
        <Card size="sm" className="!gap-0 !py-0">
          <CardContent className="divide-y divide-border !p-0">
            {entries.map((entry, i) => {
              const rank = i + 1;
              const isCurrentUser = entry.id === user.id;
              const userBadges = badgeMap[entry.id] ?? [];
              const equippedBadges = getEquippedBadges(entry, userBadges);

              return (
                <div
                  key={entry.id}
                  className={`flex items-center gap-4 px-5 py-3 ${isCurrentUser ? "bg-primary/5" : ""}`}
                >
                  <UserAvatar
                    displayName={entry.display_name}
                    avatarUrl={entry.avatar_url}
                    rank={rank}
                  />

                  <div className="flex flex-1 min-w-0 items-center gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold leading-snug truncate">
                          {entry.display_name}
                          {isCurrentUser && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              (you)
                            </span>
                          )}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {entry.andrew_id}
                      </p>
                    </div>

                    {equippedBadges.length > 0 && (
                      <div className="flex shrink-0 items-center justify-start gap-2">
                        {equippedBadges.map((badge) => (
                          <BadgeCircle
                            key={badge.track}
                            badge={badge}
                            size={36}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div
                    className={cn(
                      "flex items-center gap-1 text-base font-semibold",
                      gainValue(entry) > 0
                        ? "text-success"
                        : gainValue(entry) < 0
                          ? "text-danger"
                          : "text-muted-foreground",
                    )}
                  >
                    {gainValue(entry) > 0 ? "+" : ""}
                    <TartanCoin size={16} />
                    {gainValue(entry).toLocaleString()}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
