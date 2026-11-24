import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import {
  NEXT_COOKIE,
  SIGN_IN_PATH,
  safeNextPath,
} from "@/lib/sign-in-redirect";

function readNext(raw: string | undefined): string {
  if (!raw) return "/";
  try {
    return safeNextPath(decodeURIComponent(raw));
  } catch {
    return "/";
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  // 0.0.0.0 is not a valid browser URL, replace with localhost
  const origin = url.origin.replace("0.0.0.0", "localhost");
  const code = searchParams.get("code");

  const cookieStore = await cookies();
  // Set by the sign-in page; validated so the callback is never an open redirect.
  const next = readNext(cookieStore.get(NEXT_COOKIE)?.value);
  cookieStore.delete(NEXT_COOKIE);

  function failed(message: string) {
    const params = new URLSearchParams({ error: message });
    if (next !== "/") params.set("next", next);
    return NextResponse.redirect(`${origin}${SIGN_IN_PATH}?${params}`);
  }

  if (code) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return failed("Auth not configured");
    }

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options: Record<string, unknown>;
          }[],
        ) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    });

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocal = process.env.NODE_ENV === "development";
      const redirectBase =
        isLocal || !forwardedHost ? origin : `https://${forwardedHost}`;

      let destination = next;
      if (destination === "/") {
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("role")
              .eq("id", user.id)
              .single();
            if (profile?.role === "admin" || profile?.role === "super_admin") {
              destination = "/admin";
            }
          }
        } catch {
          // fall through to default destination
        }
      }

      return NextResponse.redirect(`${redirectBase}${destination}`);
    }
  }

  return failed("Could not authenticate");
}
