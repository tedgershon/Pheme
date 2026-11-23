// Map stable track and tier IDs to display names, including previously earned badges.

const TRACK_OVERRIDES: Record<string, { name: string; description: string }> = {
  banana_baron: {
    name: "Tartan Pipes",
    description:
      "Earn your place in the pipe band by growing your Tartan Coin balance",
  },
};

const TIER_NAMES: Record<string, Record<number, string>> = {
  banana_baron: {
    1: "Chanter Novice",
    2: "Apprentice Piper",
    3: "Tartan Piper",
    4: "Pipe Sergeant",
    5: "Pipe Major",
  },
};

export function trackDisplayName(track: string, fallback: string): string {
  return TRACK_OVERRIDES[track]?.name ?? fallback;
}

export function trackDescription(track: string, fallback: string): string {
  return TRACK_OVERRIDES[track]?.description ?? fallback;
}

export function badgeDisplayName(badge: {
  track: string;
  tier: number;
  name: string;
}): string {
  return TIER_NAMES[badge.track]?.[badge.tier] ?? badge.name;
}
