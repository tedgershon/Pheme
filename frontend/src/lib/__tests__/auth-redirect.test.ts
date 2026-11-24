import { describe, expect, it } from "vitest";
import { SESSION_EXPIRED, safeNextPath, signInPath } from "../auth-redirect";

describe("safeNextPath", () => {
  it.each([
    "/portfolio",
    "/markets/m-1?tab=bets",
    "/markets#comments",
    "/profile/",
  ])("keeps the same-origin path %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    null,
    undefined,
    "",
    "portfolio",
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "@evil.example",
    "javascript:alert(1)",
    "/auth",
    "/auth?next=%2Fportfolio",
    "/auth/callback?code=x",
  ])("falls back to / for %j", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });
});

describe("signInPath", () => {
  it("carries the return path and reason", () => {
    expect(signInPath("/portfolio")).toBe("/auth?next=%2Fportfolio");
    expect(signInPath("/markets/m-1", SESSION_EXPIRED)).toBe(
      "/auth?next=%2Fmarkets%2Fm-1&reason=session_expired",
    );
  });

  it("omits next for the home page and unsafe paths", () => {
    expect(signInPath("/")).toBe("/auth");
    expect(signInPath("//evil.example", SESSION_EXPIRED)).toBe(
      "/auth?reason=session_expired",
    );
  });
});
