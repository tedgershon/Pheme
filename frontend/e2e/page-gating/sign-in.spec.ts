import { expect, test } from "../fixtures";
import { localStack } from "../support/local-stack";
import { describePage } from "./matrix";

describePage("/sign-in");

// Return after sign-in (AUTHZ_MATRIX section 2). The OAuth round trip itself
// needs Google; route-handler unit tests cover the callback's use of the cookie.
test.describe("return after sign-in", () => {
  test("a member page's path survives into the OAuth round trip", async ({
    page,
    context,
  }) => {
    await page.goto("/portfolio");
    const landed = new URL(page.url());
    expect(landed.pathname).toBe("/sign-in");
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
    await page.goto("/sign-in?next=%2Fleaderboard");
    expect(new URL(page.url()).pathname).toBe("/leaderboard");

    await page.goto("/sign-in?next=%2F%2Fevil.example%2F");
    const landed = new URL(page.url());
    expect(landed.origin).toBe(new URL(baseURL as string).origin);
    expect(landed.pathname).toBe("/");
  });
});

// The OAuth callback has no section 5 row: the proxy must let every visitor
// through to the route handler (section 5 policy notes). Without a code the
// handler itself redirects to the sign-in page with an error.
test.describe("/sign-in/callback", () => {
  const handlerRedirect = /^\/sign-in\?error=/;

  test("anon reaches the route handler", async ({ request }) => {
    const response = await request.get("/sign-in/callback", {
      maxRedirects: 0,
    });
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
    const response = await context.request.get("/sign-in/callback", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    const location = new URL(response.headers().location, response.url());
    expect(location.pathname + location.search).toMatch(handlerRedirect);
  });
});

// #96 moved sign-in from /auth with no redirect or alias: nothing depended on
// the old URLs. A 404 here keeps a compatibility route from creeping back.
test.describe("removed /auth routes", () => {
  for (const path of ["/auth", "/auth?next=%2Fportfolio", "/auth/callback"]) {
    test(`anon gets 404 for ${path}`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(404);
    });
  }

  test("a signed-in user gets 404 for /auth", async ({ context, signInAs }) => {
    await signInAs("user");
    const response = await context.request.get("/auth", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
  });
});
