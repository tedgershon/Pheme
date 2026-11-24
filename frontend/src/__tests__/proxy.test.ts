import { createServerClient } from "@supabase/ssr";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "../proxy";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));

const getUser = vi.fn();
const single = vi.fn();
const eq = vi.fn(() => ({ single }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
const client = { auth: { getUser }, from };
const origin = "https://pheme.example";
const memberPages = ["/markets/create", "/portfolio", "/profile", "/rewards"];
const adminPages = [
  "/admin",
  "/admin/review",
  "/admin/stats",
  "/admin/resolve",
  "/admin/disputes",
  "/admin/users",
  "/admin/users/nested",
];
const publicPages = [
  "/",
  "/markets",
  "/markets/example-id",
  "/leaderboard",
  "/resolutions",
  "/sign-in",
  "/sign-in/callback?code=oauth-code",
  "/administrator",
  "/portfolio-public",
];

function request(path: string) {
  return new NextRequest(new URL(path, origin));
}

function signIn(role = "user") {
  // Misleading metadata must never grant access over the database role.
  getUser.mockResolvedValue({
    data: {
      user: { id: "verified-user", user_metadata: { role: "super_admin" } },
    },
    error: null,
  });
  single.mockResolvedValue({ data: { role }, error: null });
}

/** The sign-in redirect for a member page, carrying the path but no query. */
const signInFor = (path: string) => `/sign-in?next=${encodeURIComponent(path)}`;

function expectRedirect(response: Response, destination: string) {
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(`${origin}${destination}`);
  expect(response.headers.get("x-middleware-next")).toBeNull();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.mocked(createServerClient).mockReturnValue(
    client as unknown as ReturnType<typeof createServerClient>,
  );
  getUser.mockResolvedValue({ data: { user: null }, error: null });
});

afterEach(() => vi.unstubAllEnvs());

describe("server page gates (AUTHZ_MATRIX section 5)", () => {
  it.each([...memberPages, "/portfolio/", "/profile/nested"])(
    "redirects anonymous %s to /sign-in before rendering, returning to the path",
    async (path) => {
      expectRedirect(
        await proxy(request(`${path}?private=value`)),
        signInFor(path),
      );
      expect(from).not.toHaveBeenCalled();
    },
  );

  it.each(adminPages)("redirects anonymous %s to /", async (path) => {
    expectRedirect(await proxy(request(path)), "/");
    expect(from).not.toHaveBeenCalled();
  });

  it.each(publicPages)("keeps anonymous %s public", async (path) => {
    const response = await proxy(request(path));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(from).not.toHaveBeenCalled();
  });

  it.each(["user", "admin", "super_admin"])(
    "allows %s on all member pages without querying roles",
    async (role) => {
      signIn(role);
      for (const path of memberPages) {
        const response = await proxy(request(path));
        expect(response.headers.get("x-middleware-next")).toBe("1");
      }
      expect(from).not.toHaveBeenCalled();
    },
  );

  it.each(["user", "admin", "super_admin"])(
    "redirects signed-in %s away from /sign-in, preserving OAuth callback access",
    async (role) => {
      signIn(role);
      expectRedirect(await proxy(request("/sign-in?error=old-error")), "/");
      expectRedirect(await proxy(request("/sign-in/")), "/");
      const response = await proxy(
        request("/sign-in/callback?code=oauth-code"),
      );
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("sends a signed-in visitor on /sign-in to a safe next path", async () => {
    signIn();
    expectRedirect(
      await proxy(request("/sign-in?next=%2Fportfolio")),
      "/portfolio",
    );
    expectRedirect(
      await proxy(request("/sign-in?next=%2Fmarkets%2Fm-1%3Ftab%3Dbets")),
      "/markets/m-1?tab=bets",
    );
    for (const unsafe of [
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example",
      "/\t/evil.example",
      "@evil.example",
      "/sign-in",
      "/sign-in/callback?code=x",
    ]) {
      expectRedirect(
        await proxy(request(`/sign-in?next=${encodeURIComponent(unsafe)}`)),
        "/",
      );
    }
  });

  it("renders /sign-in for a signed-in visitor whose session the API rejected", async () => {
    // Auth still accepts the cookie; returning to the page would fail again.
    signIn();
    const response = await proxy(
      request("/sign-in?next=%2Fportfolio&reason=session_expired"),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["user", "admin", "super_admin"])(
    "enforces the database role for %s on every admin page",
    async (role) => {
      signIn(role);
      for (const path of adminPages) {
        const response = await proxy(request(path));
        const allowed =
          role === "super_admin" ||
          (role === "admin" && !path.startsWith("/admin/users"));
        if (allowed) {
          expect(response.headers.get("x-middleware-next")).toBe("1");
        } else {
          expectRedirect(response, "/");
        }
      }
      expect(from).toHaveBeenCalledWith("profiles");
      expect(select).toHaveBeenCalledWith("role");
      expect(eq).toHaveBeenCalledWith("id", "verified-user");
    },
  );

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"])(
    "still gates demo mode when %s is absent",
    async (env) => {
      vi.stubEnv(env, "");
      for (const path of memberPages) {
        expectRedirect(await proxy(request(path)), signInFor(path));
      }
      for (const path of adminPages) {
        expectRedirect(await proxy(request(path)), "/");
      }
      expect((await proxy(request("/sign-in"))).status).toBe(200);
      expect((await proxy(request("/markets"))).status).toBe(200);
      expect(createServerClient).not.toHaveBeenCalled();
    },
  );

  it.each(["returned error", "network failure"])(
    "fails closed on an Auth %s",
    async (failure) => {
      signIn("super_admin");
      if (failure === "returned error") {
        getUser.mockResolvedValue({
          data: { user: { id: "untrusted-user" } },
          error: new Error("Invalid session"),
        });
      } else {
        getUser.mockRejectedValue(new Error("Network unavailable"));
      }
      expectRedirect(
        await proxy(request("/markets/create")),
        signInFor("/markets/create"),
      );
      expectRedirect(await proxy(request("/admin")), "/");
      expect(from).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "unknown", "error", "network failure"])(
    "denies admin access for a %s role lookup",
    async (failure) => {
      signIn();
      if (failure === "network failure") {
        single.mockRejectedValue(new Error("Network unavailable"));
      } else {
        single.mockResolvedValue({
          data:
            failure === "missing"
              ? null
              : { role: failure === "unknown" ? "owner" : "super_admin" },
          error: failure === "error" ? new Error("Permission denied") : null,
        });
      }
      expectRedirect(await proxy(request("/admin")), "/");
    },
  );
});

describe("cookie refresh and route matching", () => {
  it.each([
    ["/markets", false, null],
    ["/markets/create", false, "/sign-in?next=%2Fmarkets%2Fcreate"],
    ["/admin", false, "/"],
    ["/sign-in", true, "/"],
    ["/admin/users", true, "/"],
  ] as const)(
    "preserves response cookies on %s (signed in: %s)",
    async (path, signedIn, destination) => {
      if (signedIn) signIn();
      const req = request(path);
      req.cookies.set("old-cookie", "old-value");
      getUser.mockImplementation(async () => {
        const options = vi.mocked(createServerClient).mock.calls[0][2];
        const cookies = options?.cookies;
        if (!cookies || !("getAll" in cookies) || !("setAll" in cookies)) {
          throw new Error("Expected cookie adapter");
        }
        expect(await cookies.getAll?.()).toEqual([
          { name: "old-cookie", value: "old-value" },
        ]);
        cookies.setAll?.([
          {
            name: "session-token",
            value: "refreshed-token",
            options: {
              path: "/",
              httpOnly: true,
              secure: true,
              sameSite: "lax",
            },
          },
          {
            name: "expired-token",
            value: "",
            options: { path: "/", maxAge: 0 },
          },
        ]);
        return {
          data: { user: signedIn ? { id: "verified-user" } : null },
          error: null,
        };
      });
      const response = await proxy(req);
      if (destination) expectRedirect(response, destination);
      expect(req.cookies.get("session-token")?.value).toBe("refreshed-token");
      expect(response.cookies.get("session-token")).toMatchObject({
        value: "refreshed-token",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      });
      expect(response.cookies.get("expired-token")).toMatchObject({
        value: "",
        maxAge: 0,
      });
    },
  );

  it.each([...memberPages, ...adminPages, "/sign-in", "/sign-in/callback"])(
    "runs the proxy for %s, including client navigation",
    (path) => {
      for (const url of [path, `${path}?_rsc=client-navigation`]) {
        expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
      }
    },
  );

  it.each([
    "/_next/static/chunk.js",
    "/_next/image",
    "/favicon.ico",
    "/assets/logo.svg",
  ])("skips static asset %s", (url) =>
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false),
  );
});
