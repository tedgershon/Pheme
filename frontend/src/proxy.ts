import { type CookieOptions, createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { SIGN_IN_PATH, safeNextPath, signInPath } from "./lib/sign-in-redirect";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isWithin = (route: string) =>
    pathname === route || pathname.startsWith(`${route}/`);
  const isAdminRoute = isWithin("/admin");
  const requiresUser = [
    "/markets/create",
    "/portfolio",
    "/profile",
    "/rewards",
  ].some(isWithin);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let supabaseResponse = NextResponse.next({ request });

  function redirectTo(destination: string) {
    const response = NextResponse.redirect(new URL(destination, request.url));
    // Keep token refreshes and expired-session cookie deletions on redirects.
    for (const cookie of supabaseResponse.cookies.getAll()) {
      response.cookies.set(cookie);
    }
    return response;
  }

  function anonymousResponse() {
    if (isAdminRoute) return redirectTo("/");
    // The path only: query strings are not carried through sign-in.
    if (requiresUser) return redirectTo(signInPath(pathname));
    return supabaseResponse;
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return anonymousResponse();
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: {
          name: string;
          value: string;
          options: CookieOptions;
        }[],
      ) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // Validate with Auth rather than trusting the session stored in cookies.
  let user: User | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error) user = data.user;
  } catch {
    // An unavailable identity service must not allow a protected page through.
  }

  if (!user) return anonymousResponse();

  // Exact match: the OAuth callback below it must stay reachable.
  if (pathname === SIGN_IN_PATH || pathname === `${SIGN_IN_PATH}/`) {
    const params = request.nextUrl.searchParams;
    // The API rejected this session even though Auth accepts its cookie. Show
    // the sign-in page rather than return to a page that would fail again.
    if (params.has("reason")) return supabaseResponse;
    return redirectTo(safeNextPath(params.get("next")));
  }

  if (isAdminRoute) {
    // Role preview and user-editable JWT metadata are presentation only.
    let role: string | undefined;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (!error) role = data?.role;
    } catch {
      // Missing/unreadable roles fail closed, just like non-admin roles.
    }
    const allowed = isWithin("/admin/users")
      ? role === "super_admin"
      : role === "admin" || role === "super_admin";
    if (!allowed) return redirectTo("/");
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
