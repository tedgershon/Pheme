// Page-gating tests generated from docs/AUTHZ_MATRIX.md section 5. The matrix
// is the spec: each spec file in this directory calls describePage() for its
// routes, and coverage.spec.ts fails when a section 5 row has no such call.

import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  APIRequestContext,
  APIResponse,
  Page,
  Request,
  Response,
} from "@playwright/test";
import { expect, type SeededMarket, test } from "../fixtures";
import { REPO_ROOT, type Role } from "../support/local-stack";

export type MatrixRole = "anon" | "demo" | Role;
export const MATRIX_ROLES: readonly MatrixRole[] = [
  "anon",
  "demo",
  "user",
  "admin",
  "super_admin",
];

export type PageCell =
  | "render"
  | "render-readonly"
  | "redirect→/sign-in"
  | "redirect→/"
  | "404"
  | "not-applicable";

const CELLS: readonly string[] = [
  "render",
  "render-readonly",
  "redirect→/sign-in",
  "redirect→/",
  "404",
  "not-applicable",
];

/** Parses the section 5 table: route -> role -> cell. */
export function readPageMatrix(): Map<string, Record<MatrixRole, PageCell>> {
  const doc = readFileSync(
    path.join(REPO_ROOT, "docs/AUTHZ_MATRIX.md"),
    "utf-8",
  );
  const section = doc.split(/^## 5\. Page Matrix$/m)[1]?.split(/^##+ /m)[0];
  if (!section) throw new Error("AUTHZ_MATRIX.md has no section 5 table");
  const rows = new Map<string, Record<MatrixRole, PageCell>>();
  for (const line of section.split(/\r?\n/)) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replaceAll("`", ""));
    if (!cells[0]?.startsWith("/")) continue;
    const [route, ...roleCells] = cells;
    const row = {} as Record<MatrixRole, PageCell>;
    MATRIX_ROLES.forEach((role, index) => {
      const cell = roleCells[index];
      if (!CELLS.includes(cell)) {
        throw new Error(`Unknown section 5 cell for ${route}/${role}: ${cell}`);
      }
      row[role] = cell as PageCell;
    });
    rows.set(route, row);
  }
  return rows;
}

/** Heading that only the page itself renders (never the shared shell). */
const MARKERS: Record<string, string> = {
  "/": "Welcome to Pheme",
  "/markets": "Markets",
  "/markets/create": "Create a Market",
  "/portfolio": "Portfolio",
  "/profile": "Profile",
  "/leaderboard": "Leaderboard",
  "/resolutions": "Resolutions",
  "/rewards": "Rewards",
  "/sign-in": "Welcome to Pheme",
  "/admin": "Admin Dashboard",
  "/admin/review": "Approve New Markets",
  "/admin/disputes": "Monitor Disputes",
  "/admin/resolve": "Resolve Markets",
  "/admin/stats": "Platform Statistics",
  "/admin/users": "Manage User Roles",
};

function marker(page: Page, name: string) {
  return page.getByRole("heading", { level: 1, name, exact: true });
}

function redirectTarget(cell: PageCell): string | null {
  if (cell === "redirect→/sign-in") return "/sign-in";
  if (cell === "redirect→/") return "/";
  return null;
}

const isRedirect = (status: number) => status >= 300 && status < 400;

/** Every document response of one browser navigation, first request first. */
async function documentChain(response: Response) {
  const chain: { path: string; status: number }[] = [];
  for (
    let request: Request | null = response.request();
    request;
    request = request.redirectedFrom()
  ) {
    const status = (await request.response())?.status() ?? 0;
    chain.unshift({ path: new URL(request.url()).pathname, status });
  }
  return chain;
}

/** Follows redirects one hop at a time without a browser or cookies. */
async function rawChain(request: APIRequestContext, start: string) {
  const hops: { path: string; status: number; body: string }[] = [];
  let next: string | null = start;
  while (next && hops.length < 5) {
    const response: APIResponse = await request.get(next, { maxRedirects: 0 });
    const location = response.headers().location;
    hops.push({
      path: new URL(response.url()).pathname,
      status: response.status(),
      body: await response.text(),
    });
    next =
      isRedirect(response.status()) && location
        ? new URL(location, response.url()).pathname
        : null;
  }
  return hops;
}

/**
 * One test.describe per route, one test per matrix role.
 *
 * anon is a cookie-less HTTP client, so it checks the server response itself.
 * demo is the signed-out browser (the SessionProvider guest shell); signed-in
 * roles use real fixture sessions. A redirect cell passes only when the first
 * document response is already a redirect, so a client-side redirect after the
 * protected page was served fails.
 */
export function describePage(route: string) {
  const row = readPageMatrix().get(route);

  test.describe(route, () => {
    if (!row) {
      test(`is a section 5 route`, () => {
        throw new Error(`${route} has no row in AUTHZ_MATRIX.md section 5`);
      });
      return;
    }

    for (const role of MATRIX_ROLES) {
      const cell = row[role];
      test(`${role} → ${cell}`, async ({
        page,
        request,
        seedMarket,
        signInAs,
      }) => {
        test.skip(cell === "not-applicable", "Cell does not apply");

        // Dynamic routes get a real seeded row; its title is the marker.
        let visit = route;
        let markerName = MARKERS[route];
        if (route === "/markets/[id]") {
          const market: SeededMarket = await seedMarket();
          visit = `/markets/${market.id}`;
          markerName = market.title;
        }
        if (!markerName) throw new Error(`No marker heading for ${route}`);

        const target = redirectTarget(cell);
        // Where the browser should end up: the redirect target, or the page.
        const landedPath = target ?? visit;

        if (role === "anon") {
          const hops = await rawChain(request, visit);
          const last = hops[hops.length - 1];
          // Every hop before the destination is a server redirect whose body
          // carries none of the protected page.
          for (const hop of hops.slice(0, -1)) {
            expect(isRedirect(hop.status), `${hop.path} status`).toBe(true);
            expect(hop.body).not.toContain(markerName);
          }
          if (cell === "404") {
            expect(last.status).toBe(404);
            return;
          }
          expect(last.status).toBe(200);
          expect(last.path).toBe(landedPath);
          if (!target) expect(hops).toHaveLength(1);
          return;
        }

        if (role !== "demo") await signInAs(role);
        const response = await page.goto(visit);
        if (!response) throw new Error(`No document response for ${visit}`);
        const chain = await documentChain(response);

        if (cell === "404") {
          expect(response.status()).toBe(404);
          return;
        }

        expect(response.status()).toBe(200);
        if (target) {
          // Server-side: the requested page itself answered with a redirect.
          expect(chain[0].path).toBe(visit);
          expect(isRedirect(chain[0].status), "first response").toBe(true);
          await expect(marker(page, MARKERS[target])).toBeVisible();
          await expect(marker(page, markerName)).toHaveCount(0);
        } else {
          expect(chain).toHaveLength(1);
          await expect(marker(page, markerName)).toBeVisible();
        }
        // Once the page has loaded it stays put: no client-side bounce.
        expect(new URL(page.url()).pathname).toBe(landedPath);
      });
    }
  });
}
