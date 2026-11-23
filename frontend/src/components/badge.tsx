"use client";

import { BadgeIcon } from "@/components/badge-icon";
import type { UserBadge } from "@/lib/types";

export function BadgeCircle({
  badge,
  size = 24,
}: {
  badge: UserBadge;
  size?: number;
}) {
  const def = badge.badge_definitions;
  return (
    <div role="img" title={def.name} aria-label={def.name}>
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
