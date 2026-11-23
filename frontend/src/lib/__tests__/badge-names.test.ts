import { describe, expect, it } from "vitest";
import {
  badgeDisplayName,
  trackDescription,
  trackDisplayName,
} from "../badge-names";

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

  it("keeps the API name for other tracks and unknown tiers", () => {
    expect(
      badgeDisplayName({ track: "oracle", tier: 1, name: "Lucky Guess" }),
    ).toBe("Lucky Guess");
    expect(
      badgeDisplayName({ track: "banana_baron", tier: 6, name: "Custom" }),
    ).toBe("Custom");
  });
});

describe("track overrides", () => {
  it("renames the banana_baron track and its description", () => {
    expect(trackDisplayName("banana_baron", "Stored track")).toBe(
      "Tartan Pipes",
    );
    expect(trackDescription("banana_baron", "Stored description")).toBe(
      "Earn your place in the pipe band by growing your Tartan Coin balance",
    );
  });

  it("falls back to the API values for other tracks", () => {
    expect(trackDisplayName("whale", "Whale")).toBe("Whale");
    expect(trackDescription("whale", "Make waves")).toBe("Make waves");
  });
});
