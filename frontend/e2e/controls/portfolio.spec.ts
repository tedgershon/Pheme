// Gap B-2 (AUTHZ_MATRIX.md §3b history, fixed in #9): a user's portfolio shows
// only their own proposed markets. Another account's pending and denied
// proposals must not reach the page or the APIs behind it. The admin fixture
// plays "user B": ownership, not role, decides what the portfolio lists.

import { expect, test } from "../fixtures";

test("portfolio lists only the viewer's own proposed markets", async ({
  page,
  signInAs,
  seedMarket,
  apiAs,
}) => {
  const mine = await seedMarket({
    status: "pending_review",
    creatorRole: "user",
  });
  const otherPending = await seedMarket({
    status: "pending_review",
    creatorRole: "admin",
  });
  const otherDenied = await seedMarket({
    status: "denied",
    creatorRole: "admin",
    review_notes: "Seeded denial for the isolation test.",
  });

  await signInAs("user");
  await page.goto("/portfolio");
  const proposed = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Proposed Markets" }) });
  // The viewer's own proposal proves the section loaded.
  await expect(proposed.getByText(mine.title)).toBeVisible();
  await expect(page.getByText(otherPending.title)).toHaveCount(0);
  await expect(page.getByText(otherDenied.title)).toHaveCount(0);

  // §6d: the APIs behind the page give user A nothing of user B's.
  const list = await apiAs("user", "GET", "/api/portfolio/proposed-markets");
  expect(list.status).toBe(200);
  const ids = (list.body as { id: string }[]).map((m) => m.id);
  expect(ids).toContain(mine.id);
  expect(ids).not.toContain(otherPending.id);
  expect(ids).not.toContain(otherDenied.id);
  for (const other of [otherPending, otherDenied]) {
    const detail = await apiAs("user", "GET", `/api/markets/${other.id}`);
    expect(detail.status, `GET /api/markets/${other.status} market`).toBe(404);
  }
});
