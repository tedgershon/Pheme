// The admin role-preview toggle (AUTHZ_MATRIX.md §2 and §6b). Previewing
// renders the UI as a `user` and changes nothing else: identity overlays still
// follow the real account, the server still sees the real session, and the
// preview lives in memory only. The §6b cells themselves are checked in
// global-nav.spec.ts.
//
// The toggle flips state, so tests only click it when it is in the opposite
// state, and retry inside toPass() because clicks before hydration are lost.

import type { Page, Request } from "@playwright/test";
import type { Role } from "../fixtures";
import { ROLE_IDS } from "../support/local-stack";
import { expect, type StatedMarket, test } from "./market-states";
import { expectCell } from "./matrix";

const BAR_TEXT = "Viewing as a user. Your admin permissions are unchanged.";
const NOTES = {
  balance: "Your balance:",
  creatorCannotBet:
    "As the market creator, you cannot place bets on this market.",
  adminReview:
    "This market is awaiting a final decision from an admin and no longer accepting bets.",
};

const accountMenu = (page: Page) =>
  page.getByRole("button", { name: "Account menu" });
const toggle = (page: Page) =>
  page.getByRole("button", { name: /^View as User( \(on\))?$/ });
const previewBar = (page: Page) => page.getByText(BAR_TEXT, { exact: true });
const exitPreview = (page: Page) =>
  page.getByRole("button", { name: "Exit preview", exact: true });
const profileLink = (page: Page) =>
  page.getByRole("link", { name: "Profile", exact: true });
const adminPanel = (page: Page) =>
  page.getByRole("link", { name: "Admin Panel" });
const backroll = (page: Page) =>
  page.getByText("Admin Backroll", { exact: true });
const resolveBanner = (page: Page) =>
  page.getByRole("link", { name: "Make the final call in Resolve Markets" });
// A client-side navigation does not wait for `next dev` to compile the
// destination on first visit, the way page.goto() does; allow for it.
const NAV = { timeout: 20_000 };

const navLink = (page: Page, name: string) =>
  page.getByRole("banner").getByRole("link", { name, exact: true });
const heading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 1, name, exact: true });

async function openMenu(page: Page) {
  await expect(async () => {
    if (!(await profileLink(page).isVisible())) await accountMenu(page).click();
    await expect(profileLink(page)).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

/** Turns the preview on or off with the dropdown toggle. */
async function setPreview(page: Page, on: boolean) {
  await expect(async () => {
    if ((await previewBar(page).isVisible()) !== on) {
      if (!(await toggle(page).isVisible())) await accountMenu(page).click();
      await expect(toggle(page)).toHaveAttribute("aria-pressed", String(!on), {
        timeout: 1_000,
      });
      await toggle(page).click();
    }
    if (on) await expect(previewBar(page)).toBeVisible({ timeout: 1_000 });
    else await expect(previewBar(page)).toHaveCount(0, { timeout: 1_000 });
  }).toPass();
}

async function openMarket(
  page: Page,
  signInAs: (role: Role) => Promise<void>,
  role: Role,
  market: StatedMarket,
  marker: string,
) {
  await signInAs(role);
  await page.goto(`/markets/${market.id}`);
  await expect(page.getByRole("heading", { name: market.title })).toBeVisible();
  await expect(page.getByText(marker).first()).toBeVisible();
}

/** Marks the current document so a test can tell a reload from client navigation. */
async function markDocument(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __e2eDoc?: boolean }).__e2eDoc = true;
  });
}
const documentMarked = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __e2eDoc?: boolean }).__e2eDoc === true,
  );

test.describe("role preview", () => {
  test("admin on an open market: preview hides Backroll and Admin Panel; exit restores both", async ({
    page,
    signInAs,
    marketIn,
  }) => {
    const market = await marketIn("open", { creator: "super_admin" });
    await openMarket(page, signInAs, "admin", market, NOTES.balance);
    await expectCell("visible", backroll(page));
    await expectCell("hidden", previewBar(page), exitPreview(page));

    await setPreview(page, true);
    await expect(page.getByText(NOTES.balance).first()).toBeVisible();
    await expectCell("hidden", backroll(page));
    await openMenu(page);
    await expectCell("hidden", adminPanel(page));
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(page)).toHaveText("View as User (on)");
    // The role badge follows the preview too.
    await expectCell(
      "hidden",
      page.getByText("Admin", { exact: true }),
      page.getByText("Super Admin", { exact: true }),
    );
    await accountMenu(page).click();

    // "Exit preview" in the bar ends it, with no reload.
    await markDocument(page);
    await expectCell("visible", exitPreview(page));
    await exitPreview(page).click();
    await expectCell("hidden", previewBar(page), exitPreview(page));
    await expectCell("visible", backroll(page));
    await openMenu(page);
    await expectCell("visible", adminPanel(page));
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    expect(await documentMarked(page)).toBe(true);
  });

  test("admin on an admin_review market: the Admin Resolve banner hides while previewing", async ({
    page,
    signInAs,
    marketIn,
  }) => {
    const market = await marketIn("admin_review", { creator: "user" });
    await openMarket(page, signInAs, "admin", market, NOTES.adminReview);
    await expectCell("visible", resolveBanner(page));

    await setPreview(page, true);
    await expect(page.getByText(NOTES.adminReview).first()).toBeVisible();
    await expectCell("hidden", resolveBanner(page), backroll(page));

    // The toggle ends it as well as the bar's button.
    await setPreview(page, false);
    await expectCell("hidden", exitPreview(page));
    await expectCell("visible", resolveBanner(page));
  });

  test("admin+creator previewing on their own open market keeps the creator restriction", async ({
    page,
    signInAs,
    marketIn,
  }) => {
    const market = await marketIn("open", { creator: "admin" });
    await openMarket(page, signInAs, "admin", market, NOTES.creatorCannotBet);
    await expectCell("visible", backroll(page));

    await setPreview(page, true);
    // The role changed (Backroll is gone) but the identity did not.
    await expectCell("hidden", backroll(page));
    await expect(page.getByText(NOTES.creatorCannotBet)).toBeVisible();
    await expectCell(
      "hidden",
      page.getByRole("button", { name: /^Yes \d+%$/ }),
      page.getByRole("button", { name: /^No \d+%$/ }),
    );
  });

  test("super_admin previewing is sent from /admin/users to /, and gets in again after exit", async ({
    page,
    signInAs,
  }) => {
    await signInAs("super_admin");
    await page.goto("/admin/users");
    await expect(heading(page, "Manage User Roles")).toBeVisible();
    await markDocument(page);

    // Leave client-side, preview on "/", then go back to /admin/users
    // client-side: the page's own guard sends the previewing browser to "/".
    await expect(async () => {
      if (!page.url().endsWith("/")) await navLink(page, "Markets").click();
      await expect(heading(page, "Markets")).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await setPreview(page, true);
    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === "/", NAV);
    await expect(heading(page, "Markets")).toBeVisible();
    await expectCell("hidden", heading(page, "Manage User Roles"));
    await expect(previewBar(page)).toBeVisible();
    expect(await documentMarked(page)).toBe(true);

    // After exit the admin pages render again, all without a reload.
    await exitPreview(page).click();
    await openMenu(page);
    await adminPanel(page).click();
    await expect(heading(page, "Admin Dashboard")).toBeVisible(NAV);
    await page
      .getByRole("main")
      .locator('a[href="/admin/users"]', { hasText: "Manage User Roles" })
      .click();
    await expect(heading(page, "Manage User Roles")).toBeVisible(NAV);
    await expect(page).toHaveURL(/\/admin\/users$/);
    expect(await documentMarked(page)).toBe(true);
  });

  test("preview survives client navigation, and ends on reload and on sign-out", async ({
    page,
    signInAs,
  }) => {
    await signInAs("admin");
    await page.goto("/");
    await expect(accountMenu(page)).toBeVisible();
    await setPreview(page, true);
    await markDocument(page);

    await navLink(page, "Leaderboard").click();
    await expect(heading(page, "Leaderboard")).toBeVisible(NAV);
    await expect(previewBar(page)).toBeVisible();
    await navLink(page, "Resolutions").click();
    await expect(heading(page, "Resolutions")).toBeVisible(NAV);
    await expect(previewBar(page)).toBeVisible();
    expect(await documentMarked(page)).toBe(true);

    await page.reload();
    await expect(heading(page, "Resolutions")).toBeVisible();
    await expect(accountMenu(page)).toBeVisible();
    await expectCell("hidden", previewBar(page));
    await openMenu(page);
    await expectCell("visible", adminPanel(page));
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await accountMenu(page).click();

    await setPreview(page, true);
    await openMenu(page);
    await page.getByRole("button", { name: "Sign Out" }).click();
    await expect(navLink(page, "Sign In")).toBeVisible();
    await expectCell("hidden", previewBar(page), toggle(page));
  });

  test("presentation only: API requests carry no preview and use the admin's own session", async ({
    page,
    signInAs,
    marketIn,
    apiAs,
  }) => {
    const market = await marketIn("open", { creator: "super_admin" });
    const apiOrigin = new URL(process.env.E2E_API_URL as string).origin;
    const pending: Promise<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body: string | null;
    }>[] = [];
    let recording = false;
    const record = (request: Request) => {
      if (!recording || new URL(request.url()).origin !== apiOrigin) return;
      pending.push(
        request.allHeaders().then((headers) => ({
          url: request.url(),
          method: request.method(),
          headers,
          body: request.postData(),
        })),
      );
    };
    page.on("request", record);

    await openMarket(page, signInAs, "admin", market, NOTES.balance);
    recording = true;
    await setPreview(page, true);
    await expectCell("hidden", backroll(page));
    // Move around while previewing so the app makes requests.
    await navLink(page, "Leaderboard").click();
    await expect(heading(page, "Leaderboard")).toBeVisible(NAV);
    await navLink(page, "Resolutions").click();
    await expect(heading(page, "Resolutions")).toBeVisible(NAV);
    await page.goBack();
    await page.goBack();
    await expect(page.getByRole("heading", { name: market.title })).toBeVisible(
      NAV,
    );
    await expect(previewBar(page)).toBeVisible();
    recording = false;
    page.off("request", record);

    const requests = await Promise.all(pending);
    const authenticated = requests.filter((r) => r.headers.authorization);
    expect(authenticated.length).toBeGreaterThan(0);
    for (const r of requests) {
      const label = `${r.method} ${r.url}`;
      expect(r.url, label).not.toMatch(/preview/i);
      expect(r.body ?? "", label).not.toMatch(/preview/i);
      for (const [name, value] of Object.entries(r.headers)) {
        expect(`${name}: ${value}`, label).not.toMatch(/preview/i);
      }
    }
    for (const r of authenticated) {
      const token = r.headers.authorization.replace(/^Bearer /, "");
      const claims = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString("utf-8"),
      );
      expect(claims.sub, `${r.method} ${r.url}`).toBe(ROLE_IDS.admin);
    }

    // Preview is not a security boundary: the admin's session still reaches
    // admin endpoints, because the server never learns about the preview.
    const stats = await apiAs("admin", "GET", "/api/admin/stats");
    expect(stats.status).toBe(200);
  });
});
