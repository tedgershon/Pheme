// Information that must not reach the rendered page: session tokens, another
// account's identifier, and raw server error text. The no-flash redirect check
// for protected routes is in page-gating/ (#15); the last test here covers
// what happens when the server fails.

import type { Page } from "@playwright/test";
import {
  actAndAwaitResponse,
  changeRequest,
  errorAlert,
  expectSafeMessage,
  mockApi,
  RAW_ERROR_MARKERS,
} from "../error-toasts/helpers";
import { expect, test } from "../fixtures";
import { localStack, ROLE_IDS } from "../support/local-stack";

/** Rough shape of a JWT: a base64url header, which always starts "eyJ". */
const JWT_SHAPE = /eyJ[a-zA-Z0-9_-]{20,}/;

/** The page as the browser holds it: markup, inline scripts and the data in them. */
async function renderedPage(page: Page) {
  return page.content();
}

/**
 * `next dev` serializes request cookies, which include the session, into the
 * page's inline debug data. A production build does not (CI runs one), so the
 * token checks only mean something there.
 */
function skipOnDevServer(html: string) {
  test.skip(
    /hmr-client|webpack-hmr/.test(html),
    "Next dev server puts request cookies in the page's debug data; checked on production builds.",
  );
}

const SIGNED_IN_PAGES = ["/", "/portfolio", "/profile", "/markets/create"];

test.describe("no session token in the rendered page", () => {
  for (const path of SIGNED_IN_PAGES) {
    test(`${path}`, async ({ page, signInAs, accessTokenFor }) => {
      await signInAs("user");
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const html = await renderedPage(page);
      skipOnDevServer(html);

      // The Supabase anon key is a JWT too, and is public by design.
      const withoutAnonKey = html.replaceAll(localStack().anonKey, "");
      expect(withoutAnonKey).not.toMatch(JWT_SHAPE);
      expect(html).not.toContain(await accessTokenFor("user"));
    });
  }

  test("a market page", async ({
    page,
    signInAs,
    seedMarket,
    accessTokenFor,
  }) => {
    const market = await seedMarket({ status: "open", creatorRole: "admin" });
    await signInAs("user");
    await page.goto(`/markets/${market.id}`);
    await expect(
      page.getByRole("heading", { name: market.title }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    const html = await renderedPage(page);
    skipOnDevServer(html);

    expect(html.replaceAll(localStack().anonKey, "")).not.toMatch(JWT_SHAPE);
    expect(html).not.toContain(await accessTokenFor("user"));
  });
});

test.describe("another account's Andrew ID", () => {
  // The fixture accounts' Andrew IDs are test-admin and test-super-admin. The
  // leaderboard is left out on purpose: it shows public profile identifiers.
  const OTHERS = [/test-admin/i, /test-super-admin/i];

  test("does not appear on the user's pages", async ({
    page,
    signInAs,
    seedMarket,
  }) => {
    // Proposals and markets created by the other accounts, in every state the
    // pages list.
    const open = await seedMarket({ status: "open", creatorRole: "admin" });
    await seedMarket({ status: "pending_review", creatorRole: "admin" });
    await seedMarket({ status: "pending_review", creatorRole: "super_admin" });
    await seedMarket({ status: "closed", creatorRole: "super_admin" });
    await signInAs("user");

    for (const path of [
      "/",
      "/portfolio",
      "/profile",
      "/resolutions",
      "/rewards",
      `/markets/${open.id}`,
    ]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const html = await renderedPage(page);
      for (const other of OTHERS) {
        expect(html, `${path} contains ${other}`).not.toMatch(other);
      }
    }
  });

  test("the user's own Andrew ID is on their portfolio, so the check can fail", async ({
    page,
    signInAs,
  }) => {
    await signInAs("user");
    await page.goto("/portfolio");
    await expect(page.getByText("(test-user)")).toBeVisible();
    expect(await renderedPage(page)).toMatch(/test-user/);
  });

  test("does not appear in error messages", async ({
    page,
    signInAs,
    seedMarket,
    accessTokenFor,
  }) => {
    // The admin's market, bet on as the admin: the refusal names no account.
    const market = await seedMarket({ status: "open", creatorRole: "admin" });
    await signInAs("user");
    await changeRequest(
      page,
      { method: "POST", path: /^\/api\/markets\/[^/]+\/bets$/ },
      { token: await accessTokenFor("admin") },
    );
    await page.goto(`/markets/${market.id}`);
    await expect(page.getByText("Your balance:")).toBeVisible();

    await actAndAwaitResponse(
      page,
      { method: "POST", path: /^\/api\/markets\/[^/]+\/bets$/ },
      async () => {
        await page.getByPlaceholder("Amount").fill("10");
        await page.getByRole("button", { name: /^Yes/ }).click();
      },
    );

    await expectSafeMessage(page, "You cannot bet on a market you created.");
    const shown = (await errorAlert(page).textContent()) ?? "";
    for (const other of OTHERS) expect(shown).not.toMatch(other);
    expect(shown).not.toContain(ROLE_IDS.admin);
  });
});

test.describe("server failures", () => {
  const BET = { method: "POST", path: /^\/api\/markets\/[^/]+\/bets$/ };

  /** Opens an open market as a bettor and returns the action that bets YES. */
  async function openForBet(
    page: Page,
    signInAs: (role: "user") => Promise<void>,
    market: { id: string; title: string },
  ) {
    await signInAs("user");
    await page.goto(`/markets/${market.id}`);
    await expect(
      page.getByRole("heading", { name: market.title }),
    ).toBeVisible();
    await expect(page.getByText("Your balance:")).toBeVisible();
    // Marks this document, so a full-page reload would be seen as a missing mark.
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });
  }

  const betYes = (page: Page) =>
    actAndAwaitResponse(page, BET, async () => {
      await page.getByPlaceholder("Amount").fill("10");
      await page.getByRole("button", { name: /^Yes/ }).click();
    });

  test("a 5xx shows the safe message in place, with no page reload", async ({
    page,
    signInAs,
    seedMarket,
  }) => {
    const market = await seedMarket({ status: "open", creatorRole: "admin" });
    // The envelope the backend's catch-all handler returns for an unhandled error.
    await mockApi(page, BET, 500, {
      detail: { code: "INTERNAL_ERROR", message: "Internal server error." },
    });
    await openForBet(page, signInAs, market);
    const response = await betYes(page);

    expect(response.status()).toBe(500);
    await expectSafeMessage(page, "Internal server error.");
    // The error replaced content in the same document: same JS context (the
    // mark survives) and same URL, with no redirect to a sign-in or error page.
    expect(
      await page.evaluate(
        () => (window as unknown as { __noReload?: boolean }).__noReload,
      ),
    ).toBe(true);
    expect(page.url()).toContain(`/markets/${market.id}`);
  });

  test("a 5xx with a raw error body shows a generic message, not the body", async ({
    page,
    signInAs,
    seedMarket,
  }) => {
    const market = await seedMarket({ status: "open", creatorRole: "admin" });
    // A proxy or crashed server can return anything; none of it may be shown.
    const raw =
      'Traceback (most recent call last):\n  File "routers/bets.py", line 61\npsycopg.errors.CheckViolation: new row violates check constraint "bets_amount_check"';
    await mockApi(page, BET, 500, raw, "text/plain");
    await openForBet(page, signInAs, market);

    const response = await betYes(page);

    expect(response.status()).toBe(500);
    await expectSafeMessage(page, "Request failed (500).");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(RAW_ERROR_MARKERS);
    expect(body).not.toContain("bets_amount_check");
  });
});
