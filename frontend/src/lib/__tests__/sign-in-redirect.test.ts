import { describe, expect, it } from "vitest";
import { SESSION_EXPIRED, safeNextPath, signInPath } from "../sign-in-redirect";

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
    "/sign-in",
    "/sign-in/",
    "/sign-in?next=%2Fportfolio",
    "/sign-in/callback?code=x",
  ])("falls back to / for %j", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });
});

describe("signInPath", () => {
  it("carries the return path and reason", () => {
    expect(signInPath("/portfolio")).toBe("/sign-in?next=%2Fportfolio");
    expect(signInPath("/markets/m-1", SESSION_EXPIRED)).toBe(
      "/sign-in?next=%2Fmarkets%2Fm-1&reason=session_expired",
    );
  });

  it("omits next for the home page and unsafe paths", () => {
    expect(signInPath("/")).toBe("/sign-in");
    expect(signInPath("//evil.example", SESSION_EXPIRED)).toBe(
      "/sign-in?reason=session_expired",
    );
  });
});
