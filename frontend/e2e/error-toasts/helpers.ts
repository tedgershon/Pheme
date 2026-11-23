// Shared pieces for the error-message tests (#17).
//
// The app has no toast component: a failed action renders its message inline in
// an element with role="alert" (role="status" for the neutral admin users
// message). Every test reads that element, compares it with the exact message,
// and checks it carries no raw error text.
//
// Failures come from the real backend wherever the UI can reach them, in one of
// three ways that need no test-only routes:
//   1. Stale page: load the page, change the database underneath it (another
//      tab's vote, a balance drop, a closed market), then click. The page still
//      shows the old state, so the click sends a request the server rejects.
//   2. Another caller: replace the request's bearer token with a different
//      fixture account's, so the server judges the action as that account.
//   3. A changed request: rewrite one part of the request in flight.
// A canned response (`mockApi`) is used only where the real backend cannot
// produce the failure on demand, and each use says why.

import type { Page, Request, Response, Route } from "@playwright/test";
import { expect } from "../fixtures";

/** Text that must never reach the screen: SQL, stack traces, raw API bodies, emails. */
export const RAW_ERROR_MARKERS =
  /SQL|Traceback|HTTPException|insufficient_balance|\bRPC\b|column|constraint|postgres|psycopg|APIError|P0001|\bAPI \d{3}\b|\{"detail"|"code"\s*:|[\w.+-]+@[\w-]+\.[\w.-]+/i;

/** Next.js adds its own role="alert" live region, which holds the page title. */
export const errorAlert = (page: Page) =>
  page.locator('[role="alert"]:not(#__next-route-announcer__)');

/**
 * The paired assertions every error test makes: the visible message is exactly
 * the expected one (positive), and it has no raw error text (negative).
 */
export async function expectSafeMessage(
  page: Page,
  expected: string,
  locator = errorAlert(page),
) {
  await expect(locator).toHaveText(expected);
  const shown = (await locator.textContent()) ?? "";
  expect(shown).not.toMatch(RAW_ERROR_MARKERS);
}

const apiUrl = () => process.env.E2E_API_URL as string;

export interface RequestMatch {
  method: string;
  /** Matched against the path, without the query string. */
  path: RegExp | string;
}

function matches(route: Route, match: RequestMatch) {
  const request = route.request();
  if (request.method() !== match.method) return false;
  const url = new URL(request.url());
  if (!request.url().startsWith(apiUrl())) return false;
  return typeof match.path === "string"
    ? url.pathname === match.path
    : match.path.test(url.pathname);
}

export interface RequestChange {
  /** Replacement bearer token; `null` removes the header. */
  token?: string | null;
  /** Replacement request path. */
  path?: string;
  /** Receives the parsed JSON body and returns the one to send. */
  body?: (body: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Sends the matching request to the real backend with one change. Other
 * requests, and CORS preflights, pass through untouched.
 */
export async function changeRequest(
  page: Page,
  match: RequestMatch,
  change: RequestChange,
) {
  await page.route(`${apiUrl()}/**`, async (route) => {
    if (!matches(route, match)) return route.fallback();
    const request = route.request();
    const headers = { ...request.headers() };
    if (change.token === null) delete headers.authorization;
    else if (change.token) headers.authorization = `Bearer ${change.token}`;
    const overrides: Parameters<Route["continue"]>[0] = { headers };
    if (change.path) {
      const url = new URL(request.url());
      url.pathname = change.path;
      overrides.url = url.toString();
    }
    if (change.body) {
      overrides.postData = JSON.stringify(
        change.body(request.postDataJSON() ?? {}),
      );
    }
    return route.continue(overrides);
  });
}

function requestMatches(request: Request, match: RequestMatch) {
  if (request.method() !== match.method) return false;
  const { pathname } = new URL(request.url());
  return typeof match.path === "string"
    ? pathname === match.path
    : match.path.test(pathname);
}

/**
 * Performs `act` until it sends the matching request, then returns that
 * request's response. A click made before the page has hydrated is lost, so
 * the action is retried until a request goes out; it is never repeated once
 * one has, so the page is not acted on after it has handled the response.
 */
export async function actAndAwaitResponse(
  page: Page,
  match: RequestMatch,
  act: () => Promise<void>,
): Promise<Response> {
  let request: Request | undefined;
  await expect(async () => {
    const sent = page.waitForRequest((r) => requestMatches(r, match), {
      timeout: 2_000,
    });
    sent.catch(() => {});
    await act();
    request = await sent;
  }).toPass();
  const response = await (request as Request).response();
  if (!response) {
    const reason = (request as Request).failure()?.errorText ?? "unknown";
    throw new Error(`No response to ${match.method} ${match.path}: ${reason}`);
  }
  return response;
}

/**
 * Answers the matching request with a canned error and never calls the
 * backend. Only for failures the backend cannot be made to produce on demand.
 */
export async function mockApi(
  page: Page,
  match: RequestMatch,
  status: number,
  body: unknown,
  contentType = "application/json",
) {
  await page.route(`${apiUrl()}/**`, async (route) => {
    if (!matches(route, match)) return route.fallback();
    return route.fulfill({
      status,
      contentType,
      headers: { "access-control-allow-origin": "*" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  });
}
