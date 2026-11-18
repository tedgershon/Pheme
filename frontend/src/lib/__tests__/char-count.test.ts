import { describe, expect, it } from "vitest";
import { showCharacterCount } from "../char-count";

describe("showCharacterCount", () => {
  it("is hidden below 80% of the limit", () => {
    expect(showCharacterCount(0, 120)).toBe(false);
    expect(showCharacterCount(95, 120)).toBe(false);
  });

  it("appears at 80% of the limit and stays through the limit", () => {
    expect(showCharacterCount(96, 120)).toBe(true);
    expect(showCharacterCount(119, 120)).toBe(true);
    expect(showCharacterCount(120, 120)).toBe(true);
  });

  it("works for the smallest limit in use", () => {
    expect(showCharacterCount(63, 80)).toBe(false);
    expect(showCharacterCount(64, 80)).toBe(true);
  });
});
