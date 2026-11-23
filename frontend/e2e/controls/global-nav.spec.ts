// AUTHZ_MATRIX.md §6b: the navigation shell, per role. "anon" is the
// signed-out browser (the demo shell). Each test waits for a control that only
// the expected shell renders, so a `hidden` assertion cannot pass early.

import type { Page } from "@playwright/test";
import { type Caller, expect, test } from "../fixtures";
import { type ControlCell, describeControl, expectCell } from "./matrix";

const CALLERS: readonly Caller[] = ["anon", "user", "admin", "super_admin"];

const signIn = (page: Page) =>
  page.getByRole("banner").getByRole("link", { name: "Sign In", exact: true });
const accountMenu = (page: Page) =>
  page.getByRole("button", { name: "Account menu" });
const bell = (page: Page) =>
  page.getByRole("button", { name: /^Notifications(, \d+ unread)?$/ });

/** Opens "/" as the caller and waits for the shell that caller should get. */
async function openShell(
  page: Page,
  signInAs: (role: Exclude<Caller, "anon">) => Promise<void>,
  caller: Caller,
) {
  if (caller !== "anon") await signInAs(caller);
  await page.goto("/");
  await expect(
    caller === "anon" ? signIn(page) : accountMenu(page),
  ).toBeVisible();
}

function shellCases(
  cells: Record<Caller, ControlCell>,
  control: (page: Page) => ReturnType<Page["locator"]>,
) {
  for (const caller of CALLERS) {
    test(`${caller} → ${cells[caller]}`, async ({ page, signInAs }) => {
      await openShell(page, signInAs, caller);
      await expectCell(cells[caller], control(page));
    });
  }
}

describeControl("6b", "Sign In button", () => {
  shellCases(
    { anon: "visible", user: "hidden", admin: "hidden", super_admin: "hidden" },
    signIn,
  );
});

describeControl("6b", "Profile dropdown", () => {
  shellCases(
    {
      anon: "hidden",
      user: "visible",
      admin: "visible",
      super_admin: "visible",
    },
    accountMenu,
  );

  test("user → opens with Profile and Sign Out", async ({ page, signInAs }) => {
    await openShell(page, signInAs, "user");
    const profile = page.getByRole("link", { name: "Profile", exact: true });
    await expect(async () => {
      if (!(await profile.isVisible())) await accountMenu(page).click();
      await expect(profile).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expectCell("visible", page.getByRole("button", { name: "Sign Out" }));
  });
});

describeControl("6b", "Notification bell", () => {
  shellCases(
    {
      anon: "hidden",
      user: "visible",
      admin: "visible",
      super_admin: "visible",
    },
    bell,
  );
});

describeControl("6b", '"Admin Panel" menu link', () => {
  // The link lives in the account dropdown; anon has no dropdown at all.
  test("anon → hidden", async ({ page, signInAs }) => {
    await openShell(page, signInAs, "anon");
    await expectCell(
      "hidden",
      accountMenu(page),
      page.getByRole("link", { name: "Admin Panel" }),
    );
  });

  const cells = { user: "hidden", admin: "visible", super_admin: "visible" };
  for (const [caller, cell] of Object.entries(cells) as [
    Exclude<Caller, "anon">,
    ControlCell,
  ][]) {
    test(`${caller} → ${cell} in the open account menu`, async ({
      page,
      signInAs,
    }) => {
      await openShell(page, signInAs, caller);
      // Profile is in every open menu, so it proves the menu rendered.
      const profile = page.getByRole("link", { name: "Profile", exact: true });
      await expect(async () => {
        if (!(await profile.isVisible())) await accountMenu(page).click();
        await expect(profile).toBeVisible({ timeout: 1_000 });
      }).toPass();
      const adminPanel = page.getByRole("link", { name: "Admin Panel" });
      await expectCell(cell, adminPanel);
      if (cell === "visible") {
        await expect(adminPanel).toHaveAttribute("href", "/admin");
      }
    });
  }
});

describeControl("6b", "Role-preview toggle", () => {
  // The toggle lives in the account dropdown; anon has no dropdown at all.
  // Its behavior (what a preview hides and keeps) is in role-preview.spec.ts.
  const toggle = (page: Page) =>
    page.getByRole("button", { name: /role preview/i });

  test("anon → hidden", async ({ page, signInAs }) => {
    await openShell(page, signInAs, "anon");
    await expectCell("hidden", accountMenu(page), toggle(page));
  });

  for (const [caller, cell] of [
    ["user", "hidden"],
    ["admin", "visible"],
    ["super_admin", "visible"],
  ] as const) {
    test(`${caller} → ${cell} in the open account menu`, async ({
      page,
      signInAs,
    }) => {
      await openShell(page, signInAs, caller);
      // Profile is in every open menu, so it proves the menu rendered.
      const profile = page.getByRole("link", { name: "Profile", exact: true });
      await expect(async () => {
        if (!(await profile.isVisible())) await accountMenu(page).click();
        await expect(profile).toBeVisible({ timeout: 1_000 });
      }).toPass();
      await expectCell(cell, toggle(page));
      if (cell === "visible") {
        await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
      }
    });
  }
});
