// Error messages from the admin pages: market review, market resolution and
// user roles. Each test makes the real backend reject the action and checks the
// message the page shows: the exact text, and no raw error text.

import type { Page } from "@playwright/test";
import { expect, test } from "../controls/market-states";
import { ROLE_IDS } from "../support/local-stack";
import { serviceClient } from "../support/supabase";
import {
  actAndAwaitResponse,
  changeRequest,
  expectSafeMessage,
} from "./helpers";

const REVIEW = {
  method: "POST",
  path: /^\/api\/admin\/markets\/[^/]+\/review$/,
};
const ADMIN_RESOLVE = {
  method: "POST",
  path: /^\/api\/admin\/markets\/[^/]+\/resolve$/,
};
const SET_ROLE = {
  method: "PUT",
  path: /^\/api\/admin\/users\/[^/]+\/role$/,
};

/** Opens /admin/review with the pending market's row expanded. */
async function openReview(page: Page, marketId: string, title: string) {
  await page.goto(`/admin/review?marketId=${marketId}`);
  const row = page.locator(`#review-market-${marketId}`);
  await expect(row).toContainText(title);
  return row;
}

function approve(page: Page, row: ReturnType<Page["locator"]>) {
  return actAndAwaitResponse(page, REVIEW, async () => {
    await row.getByRole("button", { name: "Approve Market" }).click();
  });
}

/** Searches for the fixture user, whose row has a Promote to Admin button. */
async function searchForUser(page: Page) {
  await page.goto("/admin/users");
  const row = page.getByRole("row", { name: /test-user/ });
  await expect(async () => {
    await page.getByPlaceholder("Search by Andrew ID...").fill("test-user");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(row).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return row;
}

function promote(page: Page, row: ReturnType<Page["locator"]>) {
  return actAndAwaitResponse(page, SET_ROLE, async () => {
    await row.getByRole("button", { name: "Promote to Admin" }).click();
  });
}

test("ADMIN_REQUIRED → 'Admin access required.'", async ({
  page,
  signInAs,
  seedMarket,
  accessTokenFor,
}) => {
  const market = await seedMarket({
    status: "pending_review",
    creatorRole: "user",
  });
  await signInAs("admin");
  // The page is the admin's; the server sees a regular user.
  await changeRequest(page, REVIEW, { token: await accessTokenFor("user") });
  const row = await openReview(page, market.id, market.title);

  const response = await approve(page, row);

  expect(response.status()).toBe(403);
  await expectSafeMessage(page, "Admin access required.");
});

test("SUPER_ADMIN_REQUIRED → 'Super admin access required.'", async ({
  page,
  signInAs,
  accessTokenFor,
}) => {
  await signInAs("super_admin");
  // Only the role change is sent as a plain admin; the search is the real one.
  await changeRequest(page, SET_ROLE, { token: await accessTokenFor("admin") });
  try {
    const row = await searchForUser(page);

    const response = await promote(page, row);

    expect(response.status()).toBe(403);
    await expectSafeMessage(page, "Super admin access required.");
  } finally {
    await serviceClient()
      .from("profiles")
      .update({ role: "user" })
      .eq("id", ROLE_IDS.user);
  }
});

test("ADMIN_CANNOT_CHANGE_OWN_ROLE → 'Cannot change your own role.'", async ({
  page,
  signInAs,
}) => {
  await signInAs("super_admin");
  // The page offers a role change for the fixture user; the request names the
  // super admin's own account instead.
  await changeRequest(page, SET_ROLE, {
    path: `/api/admin/users/${ROLE_IDS.super_admin}/role`,
  });
  try {
    const row = await searchForUser(page);

    const response = await promote(page, row);

    expect(response.status()).toBe(400);
    await expectSafeMessage(page, "Cannot change your own role.");
  } finally {
    await serviceClient()
      .from("profiles")
      .update({ role: "super_admin" })
      .eq("id", ROLE_IDS.super_admin);
    await serviceClient()
      .from("profiles")
      .update({ role: "user" })
      .eq("id", ROLE_IDS.user);
  }
});

test("MARKET_NOT_PENDING_REVIEW → 'Market is not pending review.'", async ({
  page,
  signInAs,
  seedMarket,
}) => {
  const market = await seedMarket({
    status: "pending_review",
    creatorRole: "user",
  });
  await signInAs("admin");
  const row = await openReview(page, market.id, market.title);

  // Another admin approves the market while this page is open.
  const { error } = await serviceClient()
    .from("markets")
    .update({ status: "open" })
    .eq("id", market.id);
  expect(error).toBeNull();

  const response = await approve(page, row);

  // The queue refetch runs before the failure is reported and takes the market
  // out of the queue, so the message must outlive the row: the page shows it
  // above the queue instead.
  expect(response.status()).toBe(400);
  await expect(row).toBeHidden();
  await expect(
    page.getByText(`Could not review “${market.title}”`),
  ).toBeVisible();
  await expectSafeMessage(page, "Market is not pending review.");
});

test("MARKET_ALREADY_RESOLVED on /admin/resolve → 'Market is already resolved.'", async ({
  page,
  signInAs,
  marketIn,
}) => {
  const market = await marketIn("admin_review", { creator: "user" });
  await signInAs("admin");
  await page.goto("/admin/resolve");
  const card = page.locator(`#resolve-${market.id}`);
  await expect(card).toContainText(market.title);

  // Another admin settles the market while this page is open.
  const { error } = await serviceClient()
    .from("markets")
    .update({ status: "resolved", resolved_outcome: "YES" })
    .eq("id", market.id);
  expect(error).toBeNull();

  await card.getByRole("button", { name: "Resolve YES" }).click();
  const response = await actAndAwaitResponse(page, ADMIN_RESOLVE, async () => {
    await card.getByRole("button", { name: "Confirm" }).click();
  });

  // As on /admin/review, the refetch removes the card before the failure is
  // reported, so the page shows the message above the queue.
  expect(response.status()).toBe(400);
  await expect(card).toBeHidden();
  await expect(
    page.getByText(`Could not resolve “${market.title}”`),
  ).toBeVisible();
  await expectSafeMessage(page, "Market is already resolved.");
});
