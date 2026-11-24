import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/sign-in/callback/route";
import { NEXT_COOKIE } from "../lib/sign-in-redirect";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));

const store = new Map<string, string>();
const cookieStore = {
  get: (name: string) =>
    store.has(name) ? { name, value: store.get(name) } : undefined,
  getAll: () => [...store].map(([name, value]) => ({ name, value })),
  set: (name: string, value: string) => store.set(name, value),
  delete: vi.fn((name: string) => store.delete(name)),
};
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

const exchangeCodeForSession = vi.fn();
const getUser = vi.fn();
const single = vi.fn();
const client = {
  auth: { exchangeCodeForSession, getUser },
  from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
};
const origin = "https://pheme.example";

function callback(query = "?code=oauth-code") {
  return GET(new NextRequest(new URL(`/sign-in/callback${query}`, origin)));
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.mocked(createServerClient).mockReturnValue(
    client as unknown as ReturnType<typeof createServerClient>,
  );
  exchangeCodeForSession.mockResolvedValue({ error: null });
  getUser.mockResolvedValue({ data: { user: { id: "verified-user" } } });
  single.mockResolvedValue({ data: { role: "user" } });
});

describe("OAuth callback return path", () => {
  it("returns to the page the sign-in started from and clears the cookie", async () => {
    store.set(NEXT_COOKIE, encodeURIComponent("/markets/m-1?tab=bets"));
    const response = await callback();
    expect(response.headers.get("location")).toBe(
      `${origin}/markets/m-1?tab=bets`,
    );
    expect(cookieStore.delete).toHaveBeenCalledWith(NEXT_COOKIE);
    expect(store.has(NEXT_COOKIE)).toBe(false);
  });

  it("keeps an admin's explicit return path", async () => {
    single.mockResolvedValue({ data: { role: "admin" } });
    store.set(NEXT_COOKIE, encodeURIComponent("/portfolio"));
    const response = await callback();
    expect(response.headers.get("location")).toBe(`${origin}/portfolio`);
  });

  it.each([
    ["no cookie", undefined, "user", "/"],
    ["no cookie", undefined, "admin", "/admin"],
    ["an absolute URL", "https://evil.example/", "user", "/"],
    ["a protocol-relative URL", "//evil.example/", "user", "/"],
    ["a userinfo host", "@evil.example", "user", "/"],
    ["a backslash host", "/\\evil.example", "admin", "/admin"],
    ["malformed encoding", "%E0%A4%A", "user", "/"],
  ])("ignores %s (%s, role %s)", async (_case, value, role, destination) => {
    if (value !== undefined) store.set(NEXT_COOKIE, value);
    single.mockResolvedValue({ data: { role } });
    const response = await callback();
    expect(response.headers.get("location")).toBe(`${origin}${destination}`);
  });

  it("ignores a next query parameter", async () => {
    const response = await callback("?code=oauth-code&next=%2F%2Fevil.example");
    expect(response.headers.get("location")).toBe(`${origin}/`);
  });

  it("keeps the return path on the sign-in page when the exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: new Error("bad code") });
    store.set(NEXT_COOKIE, encodeURIComponent("/portfolio"));
    const response = await callback();
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("error")).toBe("Could not authenticate");
    expect(location.searchParams.get("next")).toBe("/portfolio");
  });

  it("sends a request without a code to the sign-in page", async () => {
    const response = await callback("");
    expect(response.headers.get("location")).toBe(
      `${origin}/sign-in?error=Could+not+authenticate`,
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
