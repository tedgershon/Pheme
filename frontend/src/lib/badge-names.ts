// Map stable track and tier IDs to display names, including previously earned badges.

const TIER_NAMES: Record<string, Record<number, string>> = {
  banana_baron: {
    1: "Chanter Novice",
    2: "Apprentice Piper",
    3: "Tartan Piper",
    4: "Pipe Sergeant",
    5: "Pipe Major",
  },
};

export function badgeDisplayName(badge: {
  track: string;
  tier: number;
  name: string;
}): string {
  return TIER_NAMES[badge.track]?.[badge.tier] ?? badge.name;
}
