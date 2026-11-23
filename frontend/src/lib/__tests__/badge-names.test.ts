import { describe, expect, it } from "vitest";
import {
  badgeDisplayName,
  trackDescription,
  trackDisplayName,
} from "../badge-names";

describe("badgeDisplayName", () => {
  it("renames every banana_baron tier regardless of the stored name", () => {
    const stored = [
      "Banana Sprout",
      "Banana Tree",
      "Banana Grove",
      "Banana Mogul",
      "Banana Baron",
    ];
    expect(
      stored.map((name, i) =>
        badgeDisplayName({ track: "banana_baron", tier: i + 1, name }),
      ),
    ).toEqual(["Sprout", "Saver", "Tycoon", "Mogul", "Baron"]);
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
    expect(trackDisplayName("banana_baron", "Banana Baron")).toBe("Baron");
    expect(trackDescription("banana_baron", "Grow your banana empire")).toBe(
      "Build your Tartan Coin fortune by growing your balance",
    );
  });

  it("falls back to the API values for other tracks", () => {
    expect(trackDisplayName("whale", "Whale")).toBe("Whale");
    expect(trackDescription("whale", "Make waves")).toBe("Make waves");
  });
});
