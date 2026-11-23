// Error messages from the admin pages: market review and user roles. Each test
// makes the real backend reject the action and checks the message the page
// shows: the exact text, and no raw error text.

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ROLE_IDS } from "../support/local-stack";
import { serviceClient } from "../support/supabase";
import {
  actAndAwaitResponse,
  changeRequest,
  expectSafeMessage,
  RAW_ERROR_MARKERS,
} from "./helpers";

const REVIEW = {
  method: "POST",
  path: /^\/api\/admin\/markets\/[^/]+\/review$/,
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

  // The page refetches the queue before it reports the failure, and the market
  // is no longer in the queue, so its row (and the row's error message) is gone
  // by the time the message would show. Check what the user can rely on: the
  // backend's safe message, and that nothing raw reaches the page.
  expect(response.status()).toBe(400);
  const { detail } = await response.json();
  expect(detail).toEqual({
    code: "MARKET_NOT_PENDING_REVIEW",
    message: "Market is not pending review.",
  });
  await expect(row).toBeHidden();
  expect((await page.locator("body").innerText()) ?? "").not.toMatch(
    RAW_ERROR_MARKERS,
  );
});
