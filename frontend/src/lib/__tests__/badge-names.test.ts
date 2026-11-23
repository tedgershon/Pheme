import { describe, expect, it } from "vitest";
import { badgeDisplayName } from "../badge-names";

describe("badgeDisplayName", () => {
  it.each([
    [1, "Chanter Novice"],
    [2, "Apprentice Piper"],
    [3, "Tartan Piper"],
    [4, "Pipe Sergeant"],
    [5, "Pipe Major"],
  ] as const)("displays tier %i as %s", (tier, expected) => {
    expect(
      badgeDisplayName({ track: "banana_baron", tier, name: "Stored name" }),
    ).toBe(expected);
  });

  it.each([
    [
      "degen",
      "Crew Rookie",
      "Hill Pusher",
      "Lead Mechanic",
      "Crew Captain",
      "Sweepstakes Veteran",
    ],
    [
      "whale",
      "Stone Putter",
      "Hammer Thrower",
      "Weight Thrower",
      "Caber Tosser",
      "Highland Champion",
    ],
  ])("names all five tiers of the %s track", (track, ...names) => {
    for (const [index, expected] of names.entries()) {
      expect(
        badgeDisplayName({ track, tier: index + 1, name: "Stored name" }),
      ).toBe(expected);
    }
  });

  it("keeps the API name for other tracks and unknown tiers", () => {
    expect(
      badgeDisplayName({ track: "oracle", tier: 1, name: "Lucky Guess" }),
    ).toBe("Lucky Guess");
    expect(
      badgeDisplayName({ track: "banana_baron", tier: 6, name: "Custom" }),
    ).toBe("Custom");
  });
});
