import { expect, test } from "../fixtures";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("signInAs shows the signed-in navigation and signOut removes it", async ({
  page,
  signInAs,
  signOut,
}) => {
  await signInAs("user");
  await page.goto("/");
  const createMarket = page.getByRole("link", { name: "Create Market" });
  await expect(createMarket).toBeVisible();

  await signOut();
  await page.reload();
  await expect(page.getByRole("link", { name: "Leaderboard" })).toBeVisible();
  await expect(createMarket).toBeHidden();
});

test("seedMarket returns a market that its page renders", async ({
  page,
  seedMarket,
}) => {
  const market = await seedMarket({ status: "open" });
  expect(market.id).toMatch(UUID);

  await page.goto(`/markets/${market.id}`);
  await expect(page.getByRole("heading", { name: market.title })).toBeVisible();
});

test("seedBet places a bet that reduces the bettor's balance", async ({
  seedMarket,
  seedBet,
  getBalance,
}) => {
  const market = await seedMarket({ creatorRole: "admin" });
  const before = await getBalance("user");

  const betId = await seedBet(market, { role: "user", side: "YES", amount: 5 });

  expect(betId).toMatch(UUID);
  expect(await getBalance("user")).toBe(before - 5);
});

test("setBalance changes the balance the app shows", async ({
  page,
  seedMarket,
  setBalance,
  signInAs,
}) => {
  const market = await seedMarket();
  await setBalance("user", 0);
  await signInAs("user");

  await page.goto(`/markets/${market.id}`);
  await expect(page.getByRole("heading", { name: market.title })).toBeVisible();
  await expect(page.locator('header a[href="/portfolio"]')).toHaveText("0");
});
