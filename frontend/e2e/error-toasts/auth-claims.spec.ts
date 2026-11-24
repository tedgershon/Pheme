// Error messages from the daily-claim button on /portfolio, which is also the
// simplest signed-in action to send with a bad or incomplete identity. Each
// test makes the real backend reject the claim and checks the message the page
// shows: the exact text, and no raw error text.

import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures";
import { FIXTURE_PASSWORD, localStack } from "../support/local-stack";
import { serviceClient } from "../support/supabase";
import {
  actAndAwaitResponse,
  changeRequest,
  errorAlert,
  expectSafeMessage,
} from "./helpers";

const CLAIM = { method: "POST", path: "/api/auth/claim-daily" };

/** Opens /portfolio and waits for the claim button, which only an unclaimed account under the cap sees. */
async function openPortfolio(page: Page) {
  await page.goto("/portfolio");
  await expect(
    page.getByRole("button", { name: /Daily Tartan Coins/ }),
  ).toBeVisible();
}

function claim(page: Page) {
  return actAndAwaitResponse(page, CLAIM, async () => {
    await page.getByRole("button", { name: /Daily Tartan Coins/ }).click();
  });
}

test("CLAIM_ALREADY_TODAY → 'Already claimed today!'", async ({
  page,
  signInAs,
  apiAs,
  accessTokenFor,
  resetDailyClaim,
}) => {
  await resetDailyClaim("user");
  await resetDailyClaim("admin");
  await signInAs("user");
  // The page shows the user's unclaimed state; the server sees the admin, who
  // has already claimed.
  const first = await apiAs("admin", "POST", CLAIM.path);
  expect(first.status).toBe(200);
  await changeRequest(page, CLAIM, { token: await accessTokenFor("admin") });
  await openPortfolio(page);

  const response = await claim(page);

  expect(response.status()).toBe(409);
  // The page words this one itself (the API says "Already claimed today.").
  await expectSafeMessage(page, "Already claimed today!");
});

test("CLAIM_AT_BALANCE_CAP → 'Balance is at or above the 5,000 coin daily claim cap.'", async ({
  page,
  signInAs,
  setBalance,
  accessTokenFor,
  resetDailyClaim,
}) => {
  await resetDailyClaim("user");
  await resetDailyClaim("super_admin");
  await signInAs("user");
  // The page shows an account under the cap; the server sees one at it.
  await setBalance("super_admin", 5_000);
  await changeRequest(page, CLAIM, {
    token: await accessTokenFor("super_admin"),
  });
  await openPortfolio(page);

  const response = await claim(page);

  expect(response.status()).toBe(409);
  await expectSafeMessage(
    page,
    "Balance is at or above the 5,000 coin daily claim cap.",
  );
});

// UNAUTHORIZED is not shown as a message (#86): the client refreshes the
// session and retries once, then sends the user to sign in and back.

test("UNAUTHORIZED once → the session refreshes and the claim succeeds", async ({
  page,
  signInAs,
  resetDailyClaim,
}) => {
  await resetDailyClaim("user");
  await signInAs("user");
  // Only the first claim carries a token the API rejects, like a stale token
  // after the laptop slept; the retry carries the refreshed one.
  await changeRequest(page, CLAIM, { token: "not-a-valid-token", times: 1 });
  await openPortfolio(page);

  const retried = page.waitForResponse(
    (r) =>
      r.request().method() === CLAIM.method &&
      new URL(r.url()).pathname === CLAIM.path &&
      r.status() !== 401,
  );
  const first = await claim(page);
  expect(first.status()).toBe(401);
  expect((await retried).status()).toBe(200);

  await expect(
    page.getByRole("button", { name: /Daily Tartan Coins/ }),
  ).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/portfolio");
  await expect(errorAlert(page)).toHaveCount(0);
});

test("UNAUTHORIZED after a refresh → sign in, then back to the page", async ({
  page,
  signInAs,
  resetDailyClaim,
}) => {
  await resetDailyClaim("user");
  await signInAs("user");
  // The session cookie stays valid for the proxy and for a refresh; the API
  // rejects every token it is sent.
  await changeRequest(page, CLAIM, { token: "not-a-valid-token" });
  await openPortfolio(page);

  const response = await claim(page);

  expect(response.status()).toBe(401);
  await page.waitForURL("**/sign-in?*");
  const landed = new URL(page.url());
  expect(landed.pathname).toBe("/sign-in");
  expect(landed.searchParams.get("next")).toBe("/portfolio");
  expect(landed.searchParams.get("reason")).toBe("session_expired");
  await expectSafeMessage(
    page,
    "Your session has ended. Sign in again to continue.",
    page.getByRole("status"),
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();

  // The local session is gone: the proxy now treats the browser as signed out.
  await page.goto("/portfolio");
  expect(new URL(page.url()).pathname).toBe("/sign-in");
  expect(new URL(page.url()).searchParams.get("reason")).toBeNull();

  // Signing in again returns the user to the page.
  await signInAs("user");
  await page.goto("/sign-in?next=%2Fportfolio");
  expect(new URL(page.url()).pathname).toBe("/portfolio");
});

test("AUTH_PROFILE_INCOMPLETE → 'User profile not found. Please complete onboarding.'", async ({
  page,
  signInAs,
  resetDailyClaim,
}) => {
  await resetDailyClaim("user");
  await signInAs("user");

  // A signed-in identity with no profile row: a real Auth user whose profile,
  // created by the signup trigger, is deleted.
  const { supabaseUrl, anonKey } = localStack();
  const service = serviceClient();
  const email = `e2e-no-profile-${Date.now()}@andrew.cmu.edu`;
  const created = await service.auth.admin.createUser({
    email,
    password: FIXTURE_PASSWORD,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`Could not create the user: ${created.error?.message}`);
  }
  const userId = created.data.user.id;
  try {
    await service.from("transactions").delete().eq("user_id", userId);
    const removed = await service.from("profiles").delete().eq("id", userId);
    expect(removed.error).toBeNull();

    const signedIn = await createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.signInWithPassword({ email, password: FIXTURE_PASSWORD });
    const token = signedIn.data.session?.access_token;
    expect(token, "sign-in of the profile-less user").toBeTruthy();

    await changeRequest(page, CLAIM, { token });
    await openPortfolio(page);
    const response = await claim(page);

    expect(response.status()).toBe(400);
    await expectSafeMessage(
      page,
      "User profile not found. Please complete onboarding.",
    );
  } finally {
    await service.auth.admin.deleteUser(userId);
  }
});
