import { expect, test } from "../fixtures";
import { describePage } from "./matrix";

describePage("/");

test("home shows a featured market and capped open and pending sections", async ({
  page,
  seedMarket,
}) => {
  await Promise.all(
    Array.from({ length: 7 }, (_, i) =>
      seedMarket({
        status: "open",
        title: `Home open market ${i + 1}`,
      }),
    ),
  );
  await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      seedMarket({
        status: "pending_resolution",
        title: `Home pending market ${i + 1}`,
      }),
    ),
  );
  const resolved = await seedMarket({
    status: "resolved",
    title: "Home resolved market should be hidden",
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: /Markets/ }),
  ).toHaveCount(0);
  await expect(page.getByTestId("category-filter")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Featured Market" }),
  ).toBeVisible();
  const featured = page.getByRole("region", { name: "Featured Market" });
  await expect(featured.getByText("Current outlook")).toBeVisible();
  await expect(
    featured.getByRole("link", { name: "View market" }),
  ).toHaveAttribute("href", /^\/markets\/[^/]+$/);
  await expect(page.getByTestId("home-open-market-card")).toHaveCount(6);
  await expect(page.getByTestId("home-pending-market-card")).toHaveCount(3);
  await expect(page.getByText(resolved.title)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Closed Markets" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Resolved Markets" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Browse all markets", exact: true }),
  ).toHaveAttribute("href", "/markets");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    featured.getByRole("link", { name: "View market" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Pending Resolution" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
});

test("markets route retains full browsing and category filtering", async ({
  page,
  seedMarket,
}) => {
  const open = await seedMarket({
    status: "open",
    category: "Browser test category",
    title: "Markets route open test market",
  });
  await seedMarket({ status: "pending_resolution" });
  await seedMarket({
    status: "resolved",
    title: "Markets route resolved test market",
  });

  await page.goto("/markets");

  await expect(
    page.getByRole("heading", { level: 1, name: "Markets" }),
  ).toBeVisible();
  await expect(page.getByTestId("category-filter")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Open Markets/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Markets Pending Resolution/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Closed Markets/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Markets route resolved test market"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Browser test category" }).click();
  await expect(page.getByText(open.title).first()).toBeVisible();
});

test("signed-in users see the home dashboard and browse link", async ({
  page,
  signInAs,
}) => {
  await signInAs("user");
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "What's happening at CMU?",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Browse all markets", exact: true }),
  ).toHaveAttribute("href", "/markets");
});
