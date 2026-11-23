// NOTIFICATION_NOT_FOUND. A notification that is missing and one that belongs
// to someone else get the same 404, so its existence is not revealed
// (AUTHZ_MATRIX.md section 7f). The notification menu shows no message when a
// delete fails, so unlike the other error specs there is no text to compare:
// the checks are the response itself, and that nothing raw reaches the page.

import { expect, test } from "../fixtures";
import { ROLE_IDS } from "../support/local-stack";
import { serviceClient } from "../support/supabase";
import {
  actAndAwaitResponse,
  changeRequest,
  errorAlert,
  RAW_ERROR_MARKERS,
} from "./helpers";

const DELETE = {
  method: "DELETE",
  path: /^\/api\/notifications\/[^/]+$/,
};

async function seedNotification(title: string) {
  const { data, error } = await serviceClient()
    .from("notifications")
    .insert({
      user_id: ROLE_IDS.user,
      type: "system",
      title,
      body: "Seeded by the browser test fixtures.",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not seed a notification: ${error.message}`);
  return data.id as string;
}

test("NOTIFICATION_NOT_FOUND: another account's notification gets a safe 404", async ({
  apiAs,
}) => {
  const id = await seedNotification("E2E notification (API)");
  try {
    for (const caller of ["admin", "super_admin"] as const) {
      const { status, body } = await apiAs(
        caller,
        "DELETE",
        `/api/notifications/${id}`,
      );
      expect(status, `${caller} deleting the user's notification`).toBe(404);
      expect(body.detail).toEqual({
        code: "NOTIFICATION_NOT_FOUND",
        message: "Notification not found.",
      });
    }
    // Nothing was deleted by the rejected requests.
    const { data } = await serviceClient()
      .from("notifications")
      .select("id")
      .eq("id", id);
    expect(data).toHaveLength(1);
  } finally {
    await serviceClient().from("notifications").delete().eq("id", id);
  }
});

test("NOTIFICATION_NOT_FOUND from the menu: the failed delete shows nothing raw", async ({
  page,
  signInAs,
  accessTokenFor,
}) => {
  const title = "E2E notification (menu)";
  const id = await seedNotification(title);
  try {
    await signInAs("user");
    // The menu lists the user's notification; the server sees another account.
    await changeRequest(page, DELETE, { token: await accessTokenFor("admin") });
    await page.goto("/");

    const item = page.getByRole("listitem").filter({ hasText: title });
    await expect(async () => {
      await page.getByRole("button", { name: /^Notifications/ }).click();
      await expect(item).toBeVisible({ timeout: 2_000 });
    }).toPass();

    const response = await actAndAwaitResponse(page, DELETE, async () => {
      await item.getByTitle("Delete").click();
    });

    expect(response.status()).toBe(404);
    expect((await response.json()).detail).toEqual({
      code: "NOTIFICATION_NOT_FOUND",
      message: "Notification not found.",
    });
    // The menu has no error display, so no alert appears, and the page text
    // carries nothing from the failed request.
    await expect(errorAlert(page)).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(
      RAW_ERROR_MARKERS,
    );
    // The rejected delete removed nothing.
    const { data } = await serviceClient()
      .from("notifications")
      .select("id")
      .eq("id", id);
    expect(data).toHaveLength(1);
  } finally {
    await serviceClient().from("notifications").delete().eq("id", id);
  }
});
