import { expect, test } from "../fixtures";
import { describePage } from "./matrix";

describePage("/auth");

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
