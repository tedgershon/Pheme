// VALIDATION_FAILED on the create-market form (#21). The form checks every
// field before it sends, so the requests here are changed in flight to carry
// values the server rejects. The server's 422 lists errors by full path
// ("body.title"); the page must put each message under its own field, and show
// the ones it has no field for at form level.

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  actAndAwaitResponse,
  changeRequest,
  RAW_ERROR_MARKERS,
} from "./helpers";

const CREATE = { method: "POST", path: "/api/markets" };

/** The value of a datetime-local input a week from now, in the browser's zone. */
function inOneWeek() {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Fills the binary form with values that pass its own checks, then submits. */
function submitValidForm(page: Page) {
  return actAndAwaitResponse(page, CREATE, async () => {
    await page.getByLabel("Title").fill("Will the validation test pass?");
    await page.getByLabel("Description").fill("Checks field error rendering.");
    await page.getByLabel("Resolution criteria").fill("Resolves by the test.");
    await page.getByLabel("Official source").fill("The test suite");
    await page.getByLabel("YES criteria").fill("The test passes.");
    await page.getByLabel("NO criteria").fill("The test fails.");
    await page.getByLabel("Ambiguity criteria").fill("The test is skipped.");
    await page.getByLabel("Close date & time").fill(inOneWeek());
    await page.getByRole("button", { name: "Submit for Review" }).click();
  });
}

test("VALIDATION_FAILED: each server field error appears under its own field", async ({
  page,
  signInAs,
}) => {
  await signInAs("user");
  // Too long a title and a blank description get past the form's own checks
  // only because the request is changed after them.
  await changeRequest(page, CREATE, {
    body: (body) => ({
      ...body,
      title: "x".repeat(500),
      description: "   ",
    }),
  });
  await page.goto("/markets/create");
  await expect(
    page.getByRole("heading", { name: "Create a Market" }),
  ).toBeVisible();

  const response = await submitValidForm(page);

  expect(response.status()).toBe(422);
  const { detail } = await response.json();
  expect(detail.code).toBe("VALIDATION_FAILED");
  // The server names fields by full path; the page maps them to its inputs.
  expect(detail.errors.map((e: { field: string }) => e.field)).toEqual(
    expect.arrayContaining(["body.title", "body.description"]),
  );

  await expect(page.locator("#title-error")).toHaveText(
    "Title must be 120 characters or fewer",
  );
  await expect(page.locator("#description-error")).toHaveText(
    "Description must not be empty",
  );
  for (const id of ["#title-error", "#description-error"]) {
    const shown = (await page.locator(id).textContent()) ?? "";
    expect(shown).not.toMatch(RAW_ERROR_MARKERS);
    // Neither the path nor pydantic's prefix reaches the user.
    expect(shown).not.toMatch(/body\.|Value error/);
  }
  // Every error had a field, so no form-level message is shown.
  await expect(
    page.locator('[role="alert"]:not(#__next-route-announcer__)'),
  ).toHaveCount(0);
});

test("VALIDATION_FAILED: an error with no field on the form is shown at form level", async ({
  page,
  signInAs,
}) => {
  await signInAs("user");
  await changeRequest(page, CREATE, {
    body: (body) => ({ ...body, multichoice_type: "not-a-type" }),
  });
  await page.goto("/markets/create");
  await expect(
    page.getByRole("heading", { name: "Create a Market" }),
  ).toBeVisible();

  const response = await submitValidForm(page);

  expect(response.status()).toBe(422);
  const alert = page.locator('[role="alert"]:not(#__next-route-announcer__)');
  await expect(alert).toBeVisible();
  const shown = (await alert.textContent()) ?? "";
  expect(shown.length).toBeGreaterThan(0);
  expect(shown).not.toMatch(RAW_ERROR_MARKERS);
  expect(shown).not.toMatch(/body\.|Value error/);
});
