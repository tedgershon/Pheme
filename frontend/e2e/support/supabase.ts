// Test-only Supabase access. The service-role client is setup tooling for the
// local stack and never runs inside the application.

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  FIXTURE_PASSWORD,
  localStack,
  type Role,
  roleEmail,
} from "./local-stack";

let service: SupabaseClient | undefined;

export function serviceClient(): SupabaseClient {
  if (!service) {
    const { supabaseUrl, serviceRoleKey } = localStack();
    service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return service;
}

export interface FixtureSession {
  /** Cookies exactly as the app's @supabase/ssr clients write them. */
  cookies: { name: string; value: string }[];
  accessToken: string;
}

/**
 * Signs a fixture account in with a real password grant. The cookies come from
 * the same SSR cookie adapter the app uses, so the proxy's server-side
 * getUser() check and the browser client both accept them.
 */
export async function signInSession(role: Role): Promise<FixtureSession> {
  const { supabaseUrl, anonKey } = localStack();
  const jar = new Map<string, string>();
  const client = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies: { name: string; value: string }[]) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: roleEmail(role),
    password: FIXTURE_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(
      `Fixture sign-in failed for ${role}: ${error?.message ?? "no session"}`,
    );
  }
  if (jar.size === 0) throw new Error("Sign-in did not write session cookies");
  return {
    cookies: [...jar].map(([name, value]) => ({ name, value })),
    accessToken: data.session.access_token,
  };
}

/** True while Auth still accepts the token (it is revoked by app sign-out). */
export async function sessionIsValid(accessToken: string): Promise<boolean> {
  const { data, error } = await serviceClient().auth.getUser(accessToken);
  return !error && !!data.user;
}
