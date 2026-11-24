// Error messages from the resolution, dispute and community-vote controls on
// /markets/[id]. Each test makes the real backend reject the action, using a
// page that has gone stale or another account's token (see helpers.ts), and
// checks the message the page shows: the exact text, and no raw error text.

import type { Page } from "@playwright/test";
import { expect, type StatedMarket, test } from "../controls/market-states";
import { serviceClient } from "../support/supabase";
import {
  actAndAwaitResponse,
  changeRequest,
  expectSafeMessage,
  mockApi,
  type RequestMatch,
} from "./helpers";

const RESOLVE: RequestMatch = {
  method: "POST",
  path: /^\/api\/markets\/[^/]+\/resolve$/,
};
const DISPUTE = { method: "POST", path: /^\/api\/markets\/[^/]+\/dispute$/ };
const DISPUTE_VOTE = {
  method: "POST",
  path: /^\/api\/markets\/[^/]+\/dispute\/vote$/,
};
const COMMUNITY_VOTE = {
  method: "POST",
  path: /^\/api\/markets\/[^/]+\/community-vote$/,
};

/** Opens the market and waits for text that only renders once the page knows its state. */
async function openMarket(
  page: Page,
  market: StatedMarket,
  marker: string | RegExp,
) {
  await page.goto(`/markets/${market.id}`);
  await expect(page.getByRole("heading", { name: market.title })).toBeVisible();
  await expect(page.getByText(marker).first()).toBeVisible();
}

test("RESOLUTION_NOT_CREATOR → 'Only the market creator can do this.'", async ({
  page,
  signInAs,
  marketIn,
  accessTokenFor,
}) => {
  await signInAs("user");
  const market = await marketIn("closed", { creator: "user" });
  // The page shows the creator's controls; the server sees someone else.
  await changeRequest(page, RESOLVE, { token: await accessTokenFor("admin") });
  await openMarket(page, market, "Choose Resolution Path");

  const response = await actAndAwaitResponse(page, RESOLVE, async () => {
    await page.getByRole("button", { name: "Resolve YES" }).click();
    await page.getByRole("button", { name: "Propose YES" }).click();
  });

  expect(response.status()).toBe(403);
  await expectSafeMessage(page, "Only the market creator can do this.");
});

const DISPUTE_NOTE = "Provide a short explanation if you want to dispute the";

/** Opens a proposed market, then ends its dispute window under the open page. */
async function openThenExpireDisputeWindow(page: Page, market: StatedMarket) {
  await openMarket(page, market, DISPUTE_NOTE);
  const { error } = await serviceClient()
    .from("markets")
    .update({ dispute_deadline: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", market.id);
  expect(error).toBeNull();
}

function submitDispute(page: Page) {
  return actAndAwaitResponse(page, DISPUTE, async () => {
    await page
      .getByPlaceholder("Why are you disputing this outcome?")
      .fill("The outcome does not match the criteria.");
    await page.getByRole("button", { name: "Submit Dispute" }).click();
  });
}

test("RESOLUTION_WINDOW_EXPIRED → 'The resolution window has expired.'", async ({
  page,
  signInAs,
  marketIn,
}) => {
  // Every route settles an expired window before it calls the database
  // function, so the backend returns this code only when the deadline passes
  // in the milliseconds between those two steps. That cannot be arranged on
  // demand, so the response is the backend's own, canned.
  await signInAs("user");
  const market = await marketIn("proposed");
  await mockApi(page, DISPUTE, 409, {
    detail: {
      code: "RESOLUTION_WINDOW_EXPIRED",
      message: "The resolution window has expired.",
    },
  });
  await openMarket(page, market, DISPUTE_NOTE);
  await submitDispute(page);

  await expectSafeMessage(page, "The resolution window has expired.");
});

test("an expired dispute window on a stale page → 'Market is not in its resolution period.'", async ({
  page,
  signInAs,
  marketIn,
}) => {
  // What actually happens when the window ends under an open page: the
  // backend settles the market first, so the dispute is refused as out of state.
  await signInAs("user");
  const market = await marketIn("proposed");
  await openThenExpireDisputeWindow(page, market);

  const response = await submitDispute(page);

  expect(response.status()).toBe(400);
  await expectSafeMessage(page, "Market is not in its resolution period.");
});

test("DISPUTE_BETTOR_RESTRICTED → 'Bettors cannot vote on disputes for markets they bet on.'", async ({
  page,
  signInAs,
  marketIn,
  accessTokenFor,
}) => {
  await signInAs("user");
  // The user is eligible, so the page enables voting. The server sees the
  // admin, who bet on this market.
  const market = await marketIn("disputed", {
    creator: "super_admin",
    bettors: ["admin"],
    disputer: "admin",
  });
  await changeRequest(page, DISPUTE_VOTE, {
    token: await accessTokenFor("admin"),
  });
  await openMarket(page, market, "Cast your vote on the final outcome.");

  const response = await actAndAwaitResponse(page, DISPUTE_VOTE, async () => {
    await page.getByRole("button", { name: "Vote YES" }).click();
  });

  expect(response.status()).toBe(403);
  await expectSafeMessage(
    page,
    "Bettors cannot vote on disputes for markets they bet on.",
  );
});

test('DISPUTE_VOTE_DUPLICATE → "You\'ve already voted."', async ({
  page,
  signInAs,
  marketIn,
  accessTokenFor,
}) => {
  await signInAs("user");
  // The user has not voted, so the page enables voting. The server sees the
  // admin, who already has.
  const market = await marketIn("disputed", {
    creator: "super_admin",
    disputer: "admin",
    disputeVoters: ["admin"],
  });
  await changeRequest(page, DISPUTE_VOTE, {
    token: await accessTokenFor("admin"),
  });
  await openMarket(page, market, "Cast your vote on the final outcome.");

  const response = await actAndAwaitResponse(page, DISPUTE_VOTE, async () => {
    await page.getByRole("button", { name: "Vote YES" }).click();
  });

  expect(response.status()).toBe(409);
  await expectSafeMessage(page, "You've already voted.");
});

test('COMMUNITY_VOTE_DUPLICATE → "You have already voted on this market\'s resolution."', async ({
  page,
  signInAs,
  marketIn,
  accessTokenFor,
}) => {
  await signInAs("user");
  // Same arrangement: the page offers the vote, the server sees a prior voter.
  const market = await marketIn("community", {
    creator: "super_admin",
    communityVoters: ["admin"],
  });
  await changeRequest(page, COMMUNITY_VOTE, {
    token: await accessTokenFor("admin"),
  });
  await openMarket(page, market, "Community Resolution");

  const response = await actAndAwaitResponse(page, COMMUNITY_VOTE, async () => {
    await page.getByRole("button", { name: "Vote YES" }).click();
  });

  expect(response.status()).toBe(409);
  await expectSafeMessage(
    page,
    "You have already voted on this market's resolution.",
  );
});
