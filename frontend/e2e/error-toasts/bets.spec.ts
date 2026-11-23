// Error messages from the bet form on /markets/[id]. Each test makes the real
// backend reject a bet and checks the message the page shows. Every test makes
// both assertions: the exact message, and no raw error text.

import type { Page } from "@playwright/test";
import { expect, test } from "../controls/market-states";
import type { SeededMarket } from "../fixtures";
import { serviceClient } from "../support/supabase";
import {
  actAndAwaitResponse,
  changeRequest,
  expectSafeMessage,
  mockApi,
} from "./helpers";

const BET = { method: "POST", path: /^\/api\/markets\/[^/]+\/bets$/ };
const OPTION_BET = {
  method: "POST",
  path: /^\/api\/markets\/[^/]+\/bets\/option$/,
};

/** Opens the market and waits until the page knows the viewer and their balance. */
async function openMarket(page: Page, market: SeededMarket) {
  await page.goto(`/markets/${market.id}`);
  await expect(page.getByRole("heading", { name: market.title })).toBeVisible();
  await expect(page.getByText("Your balance:")).toBeVisible();
}

/** Enters an amount and bets YES; returns the backend's response. */
function betYes(page: Page, amount: string) {
  return actAndAwaitResponse(page, BET, async () => {
    await page.getByPlaceholder("Amount").fill(amount);
    await page.getByRole("button", { name: /^Yes/ }).click();
  });
}

test("BET_INSUFFICIENT_BALANCE → 'Insufficient banana balance.'", async ({
  page,
  signInAs,
  seedMarket,
  setBalance,
}) => {
  await signInAs("user");
  const market = await seedMarket({ status: "open", creatorRole: "admin" });
  await openMarket(page, market);

  // The page still shows the old balance, so its own check passes and the
  // server is the one to refuse.
  await setBalance("user", 0);
  const response = await betYes(page, "10");

  expect(response.status()).toBe(409);
  await expectSafeMessage(page, "Insufficient banana balance.");
});

test("BET_INVALID_AMOUNT → 'Bet amount must be positive.'", async ({
  page,
  signInAs,
  seedMarket,
}) => {
  // The form rejects amounts of zero or less, and the request model rejects
  // them with VALIDATION_FAILED, so the backend only returns this code when
  // the database function refuses an amount the model let through. That cannot
  // be arranged from the UI, so the response is the backend's own, canned.
  await signInAs("user");
  const market = await seedMarket({ status: "open", creatorRole: "admin" });
  await mockApi(page, BET, 400, {
    detail: {
      code: "BET_INVALID_AMOUNT",
      message: "Bet amount must be positive.",
    },
  });
  await openMarket(page, market);
  await betYes(page, "10");

  await expectSafeMessage(page, "Bet amount must be positive.");
});

test("BET_INVALID_OPTION → 'Invalid market option.'", async ({
  page,
  signInAs,
  marketIn,
}) => {
  await signInAs("user");
  const market = await marketIn("open", { multichoice: true });
  // The page only offers this market's options; send one that does not exist.
  await changeRequest(page, OPTION_BET, {
    body: (body) => ({
      ...body,
      option_id: "00000000-0000-4000-8000-000000000000",
    }),
  });
  await openMarket(page, market);

  const response = await actAndAwaitResponse(page, OPTION_BET, async () => {
    await page.getByRole("button", { name: /Alpha/ }).click();
    await page.getByPlaceholder("Amount").fill("10");
    await page.getByRole("button", { name: "Confirm Bet" }).click();
  });

  expect(response.status()).toBe(400);
  await expectSafeMessage(page, "Invalid market option.");
});

test("BET_CREATOR_RESTRICTED → 'You cannot bet on a market you created.'", async ({
  page,
  signInAs,
  seedMarket,
  accessTokenFor,
}) => {
  await signInAs("user");
  // The page is open as a bettor, but the server sees the market's creator.
  const market = await seedMarket({ status: "open", creatorRole: "admin" });
  await changeRequest(page, BET, { token: await accessTokenFor("admin") });
  await openMarket(page, market);

  const response = await betYes(page, "10");

  expect(response.status()).toBe(403);
  await expectSafeMessage(page, "You cannot bet on a market you created.");
});

test("MARKET_NOT_OPEN → 'Market is not open for betting.'", async ({
  page,
  signInAs,
  seedMarket,
}) => {
  await signInAs("user");
  const market = await seedMarket({ status: "open", creatorRole: "admin" });
  await openMarket(page, market);

  // The market closes while the page is open.
  const { error } = await serviceClient()
    .from("markets")
    .update({
      status: "closed",
      close_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .eq("id", market.id);
  expect(error).toBeNull();

  const response = await betYes(page, "10");

  expect(response.status()).toBe(409);
  await expectSafeMessage(page, "Market is not open for betting.");
});
