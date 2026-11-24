import { expect, test } from "../fixtures";
import { describePage } from "./matrix";

describePage("/admin");
describePage("/admin/review");
describePage("/admin/disputes");
describePage("/admin/resolve");
describePage("/admin/stats");
describePage("/admin/users");

// #96 removed the resolution queue's old URL with no redirect. The proxy still
// sends non-admins home from any /admin path, existing or not, so only an
// admin can see that it is gone.
test.describe("removed /admin/admin-review", () => {
  test("anon is sent home like any /admin path", async ({ request }) => {
    const response = await request.get("/admin/admin-review", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers().location, response.url()).pathname).toBe(
      "/",
    );
  });

  test("an admin gets 404", async ({ context, signInAs }) => {
    await signInAs("admin");
    const response = await context.request.get("/admin/admin-review", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(404);
  });
});
