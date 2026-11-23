"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Circle, Lock, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { BadgeIcon } from "@/components/badge-icon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useUpdateProfile } from "@/lib/query/mutations/auth";
import { useMe } from "@/lib/query/queries/auth";
import { rewardsQuery } from "@/lib/query/queries/rewards";
import type {
  EquippedBadgesMap,
  RewardsResponse,
  TrackProgress,
} from "@/lib/types";

const TRACK_ICONS: Record<string, string> = {
  banana_baron: "🍌",
  oracle: "🔮",
  architect: "🏗️",
  degen: "🎲",
  whale: "🐋",
};

function normalizeEquippedBadges(
  source: EquippedBadgesMap | null | undefined,
): EquippedBadgesMap {
  if (!source) return {};

  const normalized: EquippedBadgesMap = {};
  for (const [track, badgeId] of Object.entries(source)) {
    if (!badgeId) continue;
    normalized[track] = badgeId;
  }
  return normalized;
}

function inferTrackForBadge(
  rewardsData: RewardsResponse | null,
  badgeId: string | null,
): string | null {
  if (!rewardsData || !badgeId) return null;

  for (const track of rewardsData.tracks) {
    if (track.tiers.some((tier) => tier.id === badgeId)) {
      return track.track;
    }
  }

  return null;
}

function TrackCard({
  track,
  equippedBadgeId,
  isSaving,
  onEquip,
}: {
  track: TrackProgress;
  equippedBadgeId: string | null;
  isSaving: boolean;
  onEquip: (track: string, badgeId: string | null) => void;
}) {
  const icon = TRACK_ICONS[track.track] ?? "🏆";
  const valueTier = track.tiers.reduce((bestTier, tier) => {
    if (track.current_value >= tier.threshold) {
      return Math.max(bestTier, tier.tier);
    }
    return bestTier;
  }, 0);
  const effectiveTier = Math.max(track.current_tier, valueTier);

  const currentTierDef = track.tiers.find(
    (tier) => tier.tier === effectiveTier,
  );
  const nextTierDef = track.tiers.find((tier) => tier.tier > effectiveTier);

  const nextThreshold = nextTierDef?.threshold ?? null;
  const absoluteProgress = Math.max(0, track.current_value);
  const progressPercent =
    nextThreshold !== null
      ? Math.min(100, Math.round((absoluteProgress / nextThreshold) * 100))
      : 100;
  const progressColor =
    nextTierDef?.color ?? currentTierDef?.color ?? "#eab308";

  const progressValueLabel =
    nextThreshold !== null
      ? `${Math.min(absoluteProgress, nextThreshold).toLocaleString()} / ${nextThreshold.toLocaleString()}`
      : "Complete";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <span>{icon}</span>
          {track.track_display_name}
        </CardTitle>
        <CardDescription>{track.track_description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {nextTierDef ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {progressValueLabel} to {nextTierDef.name}
              </span>
              <span className="font-medium">{progressPercent}%</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-muted">
              <div
                className="h-2.5 rounded-full transition-all"
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: progressColor,
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm font-medium text-green-600">
            <Trophy size={16} />
            All tiers completed!
          </div>
        )}

        <div className="space-y-2">
          {track.tiers.map((tier) => {
            const isEarned = tier.tier <= effectiveTier;
            const isNext = tier.tier === effectiveTier + 1;
            const remaining = tier.threshold - track.current_value;
            const isEquipped = equippedBadgeId === tier.id;
            const canCardEquip = isEarned && !isSaving;

            const activateCardEquip = () => {
              if (!canCardEquip) return;
              onEquip(track.track, isEquipped ? null : tier.id);
            };

            return (
              <button
                type="button"
                key={tier.id}
                disabled={!canCardEquip}
                onClick={activateCardEquip}
                className={`grid w-full min-h-24 grid-cols-[auto_auto_1fr_auto] items-center gap-3 rounded-lg border px-3 py-2 text-left ${
                  isEquipped
                    ? "border-green-500 bg-green-500/10"
                    : canCardEquip
                      ? "border-border cursor-pointer hover:border-green-300 hover:bg-green-50/40"
                      : "border-border"
                }`}
              >
                <div className="shrink-0">
                  {isEarned ? (
                    <Check
                      size={18}
                      className={
                        isEquipped ? "text-green-600" : "text-green-500"
                      }
                    />
                  ) : isNext ? (
                    <Circle size={18} className="text-muted-foreground" />
                  ) : (
                    <Lock size={18} className="text-muted-foreground/50" />
                  )}
                </div>
                <div className="shrink-0">
                  <BadgeIcon
                    track={track.track}
                    tier={tier.tier}
                    color={tier.color}
                    earned={isEarned}
                    size={28}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium ${!isEarned && !isNext ? "text-muted-foreground" : ""}`}
                  >
                    {tier.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({tier.threshold.toLocaleString()})
                    </span>
                  </p>
                  {tier.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {tier.description}
                    </p>
                  )}
                  {isEquipped && (
                    <p className="mt-0.5 text-xs font-medium text-green-700">
                      Showing on leaderboard
                    </p>
                  )}
                </div>
                <div className="flex w-24 justify-end">
                  {isEarned ? (
                    <span
                      className={
                        isEquipped
                          ? "inline-flex w-20 items-center justify-center gap-1.5 rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white"
                          : "inline-flex w-20 items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium"
                      }
                    >
                      {isEquipped && <Check size={14} />}
                      {isSaving
                        ? "Saving..."
                        : isEquipped
                          ? "Equipped"
                          : "Equip"}
                    </span>
                  ) : (
                    <span className="text-right text-xs text-muted-foreground">
                      {isNext
                        ? `${Math.max(1, Math.ceil(remaining)).toLocaleString()} to go`
                        : "Locked"}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function RewardsPage() {
  const { user } = useMe();
  const { data, isLoading } = useQuery(rewardsQuery());
  const updateProfile = useUpdateProfile();

  const [savingTrack, setSavingTrack] = useState<string | null>(null);
  const [equippedByTrack, setEquippedByTrack] = useState<EquippedBadgesMap>(
    normalizeEquippedBadges(user.equipped_badges),
  );

  // keep our local optimistic map in sync when the cached user changes
  useEffect(() => {
    setEquippedByTrack(normalizeEquippedBadges(user.equipped_badges));
  }, [user.equipped_badges]);

  // legacy backfill — if the old equipped_badge_id is set but no map exists,
  // infer the track it belongs to once rewards data loads
  useEffect(() => {
    const rewardsData = data ?? null;
    const legacyEquippedBadgeId = user.equipped_badge_id;
    if (!rewardsData || !legacyEquippedBadgeId) return;

    setEquippedByTrack((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const inferredTrack = inferTrackForBadge(
        rewardsData,
        legacyEquippedBadgeId,
      );
      if (!inferredTrack) return prev;
      return { ...prev, [inferredTrack]: legacyEquippedBadgeId };
    });
  }, [data, user.equipped_badge_id]);

  async function handleEquip(track: string, badgeId: string | null) {
    const prev = { ...equippedByTrack };
    const next = { ...equippedByTrack };
    if (badgeId) {
      next[track] = badgeId;
    } else {
      delete next[track];
    }

    setSavingTrack(track);
    setEquippedByTrack(next);

    const legacyBadge = Object.values(next)[0] ?? null;

    try {
      await updateProfile.mutateAsync({
        equipped_badges: next,
        equipped_badge_id: legacyBadge,
      });
    } catch {
      setEquippedByTrack(prev);
    } finally {
      setSavingTrack(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Rewards</h1>
        <p className="text-sm text-muted-foreground">
          Level up your badges and show off your Pheme prowess
        </p>
      </section>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : data ? (
        <div className="grid gap-6 md:grid-cols-2">
          {data.tracks.map((track) => (
            <TrackCard
              key={track.track}
              track={track}
              equippedBadgeId={equippedByTrack[track.track] ?? null}
              isSaving={savingTrack === track.track}
              onEquip={handleEquip}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Failed to load rewards data.
        </p>
      )}
    </div>
  );
}
