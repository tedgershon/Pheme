// Pheme display names for badge tracks and tiers. The database and API keep
// the original BananaGains names (and the `banana_baron` track id); the UI
// shows these instead. Anything not listed falls back to the API value.

const TRACK_OVERRIDES: Record<string, { name: string; description: string }> = {
  banana_baron: {
    name: "Baron",
    description: "Build your Tartan Coin fortune by growing your balance",
  },
};

const TIER_NAMES: Record<string, Record<number, string>> = {
  banana_baron: {
    1: "Sprout",
    2: "Saver",
    3: "Tycoon",
    4: "Mogul",
    5: "Baron",
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
