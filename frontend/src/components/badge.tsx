"use client";

import { BadgeIcon } from "@/components/badge-icon";
import { badgeDisplayName } from "@/lib/badge-names";
import type { UserBadge } from "@/lib/types";

export function BadgeCircle({
  badge,
  size = 24,
}: {
  badge: UserBadge;
  size?: number;
}) {
  const def = badge.badge_definitions;
  const name = badgeDisplayName(def);
  return (
    <div role="img" title={name} aria-label={name}>
      <BadgeIcon
        track={def.track}
        tier={badge.tier}
        color={def.color}
        earned
        size={size}
      />
    </div>
  );
}
