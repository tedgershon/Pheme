import { expect, test } from "../fixtures";
import { localStack } from "../support/local-stack";
import { describePage } from "./matrix";

describePage("/auth");

// Return after sign-in (AUTHZ_MATRIX section 2). The OAuth round trip itself
// needs Google; route-handler unit tests cover the callback's use of the cookie.
test.describe("return after sign-in", () => {
  test("a member page's path survives into the OAuth round trip", async ({
    page,
    context,
  }) => {
    await page.goto("/portfolio");
    const landed = new URL(page.url());
    expect(landed.pathname).toBe("/auth");
    expect(landed.searchParams.get("next")).toBe("/portfolio");

    // Stop at the provider: only the cookie written before leaving matters.
    const authorize = `${localStack().supabaseUrl}/auth/v1/authorize`;
    const toProvider = (url: string) => url.startsWith(authorize);
    await page.route(
      (url) => toProvider(url.href),
      (route) => route.abort(),
    );
    await expect(async () => {
      const sent = page.waitForRequest((r) => toProvider(r.url()), {
        timeout: 2_000,
      });
      await page.getByRole("button", { name: "Continue with Google" }).click();
      await sent;
    }).toPass();

    const cookie = (await context.cookies()).find(
      (c) => c.name === "pheme-auth-next",
    );
    expect(decodeURIComponent(cookie?.value ?? "")).toBe("/portfolio");
  });

  test("a signed-in visitor goes to a safe next path only", async ({
    page,
    signInAs,
    baseURL,
  }) => {
    await signInAs("user");
    await page.goto("/auth?next=%2Fleaderboard");
    expect(new URL(page.url()).pathname).toBe("/leaderboard");

    await page.goto("/auth?next=%2F%2Fevil.example%2F");
    const landed = new URL(page.url());
    expect(landed.origin).toBe(new URL(baseURL as string).origin);
    expect(landed.pathname).toBe("/");
  });
});

// The OAuth callback has no section 5 row: the proxy must let every visitor
// through to the route handler (section 5 policy notes). Without a code the
// handler itself redirects to the sign-in page with an error.
test.describe("/auth/callback", () => {
  const handlerRedirect = /^\/auth\?error=/;

  test("anon reaches the route handler", async ({ request }) => {
    const response = await request.get("/auth/callback", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const location = new URL(response.headers().location, response.url());
    expect(location.pathname + location.search).toMatch(handlerRedirect);
  });

  test("a signed-in user reaches the route handler", async ({
    context,
    signInAs,
  }) => {
    await signInAs("user");
    // context.request sends the browser context's session cookies.
    const response = await context.request.get("/auth/callback", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    const location = new URL(response.headers().location, response.url());
    expect(location.pathname + location.search).toMatch(handlerRedirect);
  });
});
