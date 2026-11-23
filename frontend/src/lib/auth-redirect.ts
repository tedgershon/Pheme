// Where sign-in sends a visitor afterwards. The page they were on travels as
// `/auth?next=<path>`, then in a short-lived cookie through the OAuth round
// trip (a query string on the callback URL would have to match each Supabase
// redirect allow-list entry), and the callback redirects to it.

/** `/auth?reason=` value set when the API rejected a signed-in session. */
export const SESSION_EXPIRED = "session_expired";

/** Holds the return path between the sign-in click and the OAuth callback. */
export const NEXT_COOKIE = "pheme-auth-next";
export const NEXT_COOKIE_MAX_AGE = 600;

const BASE = "http://pheme.invalid";

/**
 * Returns `value` when it is a same-origin path other than the sign-in pages,
 * otherwise `/`. Parsing as a URL catches `//host`, `/\host` and tab or
 * newline tricks that browsers normalize into another origin.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/";
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE) return "/";
  if (url.pathname === "/auth" || url.pathname.startsWith("/auth/")) {
    return "/";
  }
  return url.pathname + url.search + url.hash;
}

/** The sign-in page URL that returns the visitor to `next` afterwards. */
export function signInPath(next: string, reason?: string): string {
  const params = new URLSearchParams();
  const destination = safeNextPath(next);
  if (destination !== "/") params.set("next", destination);
  if (reason) params.set("reason", reason);
  const query = params.toString();
  return query ? `/auth?${query}` : "/auth";
}
