"use client";

const TRACK_EMOJIS: Record<string, string> = {
  banana_baron: "🍌",
  oracle: "🔮",
  architect: "🏗️",
  degen: "🎲",
  whale: "🐋",
};

interface BadgeIconProps {
  track: string;
  tier: number;
  color: string;
  earned: boolean;
  size?: number;
}

export function BadgeIcon({
  track,
  tier,
  color,
  earned,
  size = 28,
}: BadgeIconProps) {
  const emoji = TRACK_EMOJIS[track] ?? "🏆";
  const fill = earned ? color : "var(--color-muted)";
  const emojiSize = size * 0.4;

  if (tier <= 1) {
    return (
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="18" fill={fill} />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{ fontSize: emojiSize }}
        >
          {emoji}
        </span>
      </div>
    );
  }

  if (tier === 2) {
    return (
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
          <circle
            cx="20"
            cy="20"
            r="18"
            fill="none"
            stroke={fill}
            strokeWidth="2.5"
            opacity={earned ? 0.4 : 0.3}
          />
          <circle cx="20" cy="20" r="14.5" fill={fill} />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{ fontSize: emojiSize }}
        >
          {emoji}
        </span>
      </div>
    );
  }

  if (tier === 3) {
    return (
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
          <polygon
            points="20,2 25,14 38,14 27,22 31,35 20,27 9,35 13,22 2,14 15,14"
            fill={fill}
            opacity={earned ? 0.25 : 0.15}
          />
          <circle cx="20" cy="20" r="12" fill={fill} />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{ fontSize: emojiSize }}
        >
          {emoji}
        </span>
      </div>
    );
  }

  if (tier === 4) {
    return (
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
          {earned && (
            <circle cx="20" cy="20" r="19" fill={fill} opacity="0.15" />
          )}
          <path
            d="M20 3 L33 12 L33 28 L20 37 L7 28 L7 12 Z"
            fill={fill}
            stroke={earned ? color : "none"}
            strokeWidth="1"
          />
          <circle
            cx="20"
            cy="20"
            r="9"
            fill={earned ? "white" : fill}
            opacity={earned ? 0.25 : 0.3}
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{ fontSize: emojiSize }}
        >
          {emoji}
        </span>
      </div>
    );
  }

  // Tier 5 — ornate shield with crown
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
        {earned && (
          <>
            <circle cx="20" cy="20" r="19" fill={fill} opacity="0.12" />
            <polygon
              points="20,1 23,6 27,3 26,8 30,7 28,11 32,12 28,15 20,5 12,15 8,12 10,7 14,8 13,3 17,6"
              fill={color}
              opacity="0.5"
            />
          </>
        )}
        <path
          d="M20 5 L34 13 L34 29 L20 38 L6 29 L6 13 Z"
          fill={fill}
          stroke={earned ? color : "none"}
          strokeWidth="1.5"
        />
        {earned && (
          <>
            <line
              x1="20"
              y1="5"
              x2="20"
              y2="38"
              stroke="white"
              strokeWidth="0.5"
              opacity="0.3"
            />
            <line
              x1="6"
              y1="21"
              x2="34"
              y2="21"
              stroke="white"
              strokeWidth="0.5"
              opacity="0.3"
            />
          </>
        )}
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center"
        style={{ fontSize: emojiSize }}
      >
        {emoji}
      </span>
    </div>
  );
}
