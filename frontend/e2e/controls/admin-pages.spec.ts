// AUTHZ_MATRIX.md §6c: controls on the admin pages. `user` cells are n/a
// because the proxy redirects (covered by page-gating/admin.spec.ts); the
// admin-vs-super_admin differences and per-market conditions are checked here.
// Nothing is clicked that would change data.

import type { Page } from "@playwright/test";
import { ROLE_IDS } from "../support/local-stack";
import { expect, test } from "./market-states";
import { describeControl, expectCell } from "./matrix";

const dashboardLinks = (page: Page) =>
  page.getByRole("main").locator('a[href^="/admin/"]');

/** One test per admin role; also checks the card count (4 admin, 5 super_admin). */
function cardCases(title: string, href: string, superAdminOnly = false) {
  for (const role of ["admin", "super_admin"] as const) {
    const cell = superAdminOnly && role === "admin" ? "hidden" : "visible";
    test(`${role} → ${cell}`, async ({ page, signInAs }) => {
      await signInAs(role);
      await page.goto("/admin");
      await expect(
        page.getByRole("heading", { level: 1, name: "Admin Dashboard" }),
      ).toBeVisible();
      await expect(dashboardLinks(page)).toHaveCount(role === "admin" ? 4 : 5);
      await expectCell(
        cell,
        page.getByRole("main").locator(`a[href="${href}"]`, { hasText: title }),
      );
    });
  }
}

describeControl("6c", '/admin dashboard card "Approve New Markets"', () => {
  cardCases("Approve New Markets", "/admin/review");
});

describeControl("6c", '/admin dashboard card "Monitor Disputes"', () => {
  cardCases("Monitor Disputes", "/admin/disputes");
});

describeControl("6c", '/admin dashboard card "Resolve Markets"', () => {
  cardCases("Resolve Markets", "/admin/resolve");
});

describeControl("6c", '/admin dashboard card "Platform Statistics"', () => {
  cardCases("Platform Statistics", "/admin/stats");
});

describeControl("6c", '/admin dashboard card "Manage User Roles"', () => {
  cardCases("Manage User Roles", "/admin/users", true);
});

/** Opens /admin/review with the market's row expanded (pending rows only). */
async function openReview(page: Page, marketId: string, title: string) {
  await page.goto(`/admin/review?marketId=${marketId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Approve New Markets" }),
  ).toBeVisible();
  await expect(page.locator(`#review-market-${marketId}`)).toContainText(title);
  return page.locator(`#review-market-${marketId}`);
}

/** Review-button cells: visible on pending rows, absent on approved ones. */
function reviewButtonCases(control: "Approve Market" | "Deny Market") {
  for (const role of ["admin", "super_admin"] as const) {
    test(`${role} on pending_review market → visible`, async ({
      page,
      signInAs,
      seedMarket,
    }) => {
      const market = await seedMarket({
        status: "pending_review",
        creatorRole: "user",
      });
      await signInAs(role);
      const row = await openReview(page, market.id, market.title);
      await expectCell("visible", row.getByRole("button", { name: control }));
    });
  }

  test("admin on approved market → hidden", async ({
    page,
    signInAs,
    seedMarket,
  }) => {
    const market = await seedMarket({
      status: "open",
      creatorRole: "user",
      reviewed_by: ROLE_IDS.super_admin,
      review_date: new Date().toISOString(),
    });
    await signInAs("admin");
    await page.goto("/admin/review");
    const row = page.locator(`#review-market-${market.id}`);
    // Clicks before hydration are lost; open the Approved list and the row.
    await expect(async () => {
      if (!(await row.isVisible())) {
        await page.getByRole("button", { name: /^Approved/ }).click();
      }
      await row.getByRole("button", { name: market.title }).click();
      await expect(row.getByText("Resolution Criteria")).toBeVisible({
        timeout: 1_000,
      });
    }).toPass();
    await expectCell("hidden", row.getByRole("button", { name: control }));
  });
}

describeControl("6c", "Approve Market button (/admin/review)", () => {
  reviewButtonCases("Approve Market");
});

describeControl("6c", "Deny Market button (/admin/review)", () => {
  reviewButtonCases("Deny Market");
});

describeControl(
  "6c",
  "Resolve as YES / NO / AMBIGUOUS buttons (/admin/resolve)",
  () => {
    const outcomeButtons = (page: Page, marketId: string) => {
      const card = page.locator(`#resolve-${marketId}`);
      return {
        card,
        yes: card.getByRole("button", { name: "Resolve YES" }),
        no: card.getByRole("button", { name: "Resolve NO" }),
        ambiguous: card.getByRole("button", { name: /^Ambiguous/ }),
      };
    };

    async function openQueue(page: Page) {
      await page.goto("/admin/resolve");
      await expect(
        page.getByRole("heading", { level: 1, name: "Resolve Markets" }),
      ).toBeVisible();
    }

    for (const role of ["admin", "super_admin"] as const) {
      test(`${role} on binary admin_review market → YES, NO and AMBIGUOUS visible`, async ({
        page,
        signInAs,
        marketIn,
      }) => {
        const market = await marketIn("admin_review", { creator: "user" });
        await signInAs(role);
        await openQueue(page);
        const { card, yes, no, ambiguous } = outcomeButtons(page, market.id);
        await expect(card).toContainText(market.title);
        await expectCell("visible", yes, no, ambiguous);
      });
    }

    test("admin on multichoice admin_review market → AMBIGUOUS only", async ({
      page,
      signInAs,
      marketIn,
    }) => {
      const market = await marketIn("admin_review", {
        creator: "user",
        multichoice: true,
      });
      await signInAs("admin");
      await openQueue(page);
      const { card, yes, no, ambiguous } = outcomeButtons(page, market.id);
      await expect(card).toContainText(
        "Option-based settlement is not available yet",
      );
      await expectCell("visible", ambiguous);
      await expectCell("hidden", yes, no);
    });

    for (const role of ["admin", "super_admin"] as const) {
      test(`${role}+creator on own admin_review market → hidden`, async ({
        page,
        signInAs,
        marketIn,
        apiAs,
      }) => {
        const market = await marketIn("admin_review", { creator: role });
        await signInAs(role);
        await openQueue(page);
        const { card, yes, no, ambiguous } = outcomeButtons(page, market.id);
        await expect(card).toContainText(
          "You created this market, so another admin must resolve it.",
        );
        await expectCell("hidden", yes, no, ambiguous);
        // §6d: the creator restriction holds at the API as well.
        const result = await apiAs(
          role,
          "POST",
          `/api/admin/markets/${market.id}/resolve`,
          { outcome: "AMBIGUOUS" },
        );
        expect(result.status).toBe(403);
      });
    }
  },
);

async function searchUsers(page: Page, query: string) {
  const input = page.getByPlaceholder("Search by Andrew ID...");
  // Typing before hydration is lost; retry until the search runs.
  await expect(async () => {
    await input.fill("");
    await input.fill(query);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("table")).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

const userRow = (page: Page, andrewId: string) =>
  page.getByRole("row").filter({
    has: page.getByRole("cell", { name: andrewId, exact: true }),
  });

describeControl("6c", "Search Users input (/admin/users)", () => {
  test("super_admin → visible", async ({ page, signInAs }) => {
    await signInAs("super_admin");
    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { level: 1, name: "Manage User Roles" }),
    ).toBeVisible();
    await expectCell(
      "visible",
      page.getByPlaceholder("Search by Andrew ID..."),
    );
  });

  test("admin → hidden (page redirects)", async ({ page, signInAs, apiAs }) => {
    await signInAs("admin");
    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { level: 1, name: "Markets" }),
    ).toBeVisible();
    await expectCell("hidden", page.getByPlaceholder("Search by Andrew ID..."));
    // §6d: the search API is super-admin only.
    const result = await apiAs(
      "admin",
      "GET",
      "/api/admin/users/search?q=test",
    );
    expect(result.status).toBe(403);
  });
});

async function openUsersPage(page: Page) {
  await page.goto("/admin/users");
  await expect(
    page.getByRole("heading", { level: 1, name: "Manage User Roles" }),
  ).toBeVisible();
}

describeControl("6c", "Promote/Demote User (/admin/users)", () => {
  test("super_admin on a user row → Promote visible", async ({
    page,
    signInAs,
  }) => {
    await signInAs("super_admin");
    await openUsersPage(page);
    await searchUsers(page, "test-user");
    await expectCell(
      "visible",
      userRow(page, "test-user").getByRole("button", {
        name: "Promote to Admin",
      }),
    );
  });

  test("super_admin on an admin row → Demote visible", async ({
    page,
    signInAs,
  }) => {
    await signInAs("super_admin");
    await openUsersPage(page);
    await searchUsers(page, "test-admin");
    await expectCell(
      "visible",
      userRow(page, "test-admin").getByRole("button", {
        name: "Demote to User",
      }),
    );
  });

  test("super_admin on own row → hidden", async ({ page, signInAs, apiAs }) => {
    await signInAs("super_admin");
    await openUsersPage(page);
    await searchUsers(page, "test-super-admin");
    const row = userRow(page, "test-super-admin");
    await expect(row).toContainText("Super Admin");
    await expectCell(
      "hidden",
      row.getByRole("button", { name: /Promote|Demote/ }),
    );
    // §6d: the API refuses a self role change.
    const result = await apiAs(
      "super_admin",
      "PUT",
      `/api/admin/users/${ROLE_IDS.super_admin}/role`,
      { role: "user" },
    );
    expect(result.status).toBe(400);
  });

  test("admin → hidden; the role API is super-admin only", async ({
    apiAs,
  }) => {
    // The page itself redirects admins (see the search test above).
    const result = await apiAs(
      "admin",
      "PUT",
      `/api/admin/users/${ROLE_IDS.user}/role`,
      { role: "admin" },
    );
    expect(result.status).toBe(403);
  });
});
