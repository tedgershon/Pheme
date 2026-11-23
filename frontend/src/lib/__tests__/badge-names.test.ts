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
    ["degen", "Casual Better", "Regular", "Enthusiast", "Addicted", "Degen"],
    ["whale", "Small Fish", "Dolphin", "Shark", "Orca", "Whale"],
  ])("displays the original %s badges", (track, ...names) => {
    for (const [index, name] of names.entries()) {
      expect(badgeDisplayName({ track, tier: index + 1, name })).toBe(name);
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
