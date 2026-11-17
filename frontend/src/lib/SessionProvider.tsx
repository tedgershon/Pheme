"use client";

import * as Sentry from "@sentry/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { resetAfterSessionChange } from "./query/invalidators";
import { queryKeys } from "./query/keys";
import { supabase } from "./supabase";
import type { UserProfile } from "./types";

// DEMO MODE: GUEST_USER is the frontend-only sentinel that lets signed-out
// visitors render the app shell as if logged in (see docs/
// AUTHZ_MATRIX.md section 2 for the demo role definition). The backend never
// sees this user -- any actual API call from a demo client is `anon` from
// the backend's perspective. Do not extend this with backend writes.
// still exported because useMe() falls back to this when the cache is empty
// (logged out, first paint, 401), keeps consumers from having to null-check
export const GUEST_USER: UserProfile = {
  id: "00000000-0000-0000-0000-000000000000",
  andrew_id: "",
  display_name: "Guest",
  banana_balance: 0,
  created_at: new Date().toISOString(),
  claimed_today: false,
  role: "user",
  is_admin: false,
  claim_eligible: false,
  claim_amount: 0,
  above_cap: false,
  equipped_badge_id: null,
  equipped_badges: {},
  avatar_url: null,
};

interface SessionContextValue {
  isDemo: boolean;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const SessionCtx = createContext<SessionContextValue>({
  isDemo: true,
  isLoading: false,
  signOut: async () => {},
});

export function useSession() {
  return useContext(SessionCtx);
}

// session-shell provider — holds only auth-session bits
// profile data lives in the me query (useMe), never here
export function SessionProvider({
  children,
  initialUser,
}: {
  children: ReactNode;
  initialUser?: UserProfile | null;
}) {
  const qc = useQueryClient();
  const [isDemo, setIsDemo] = useState(!initialUser);
  const [isLoading, setIsLoading] = useState(!initialUser);

  // seed the me cache from SSR-fetched user so the first paint has real data
  // and nothing else has to know about the initialUser prop
  useState(() => {
    if (initialUser) qc.setQueryData(queryKeys.me, initialUser);
  });

  // track the last user id we've seen so onAuthStateChange only invalidates
  // when the user actually changes — supabase fires INITIAL_SESSION and
  // TOKEN_REFRESHED without an actual transition, we want to ignore those
  const lastUserIdRef = useRef<string | null>(initialUser?.id ?? null);

  useEffect(() => {
    if (!supabase) {
      // no supabase configured — we're permanently in demo mode
      setIsDemo(true);
      setIsLoading(false);
      return;
    }

    // onAuthStateChange fires INITIAL_SESSION right after subscribe with
    // the current session, so we don't need a separate getSession() call —
    // that was just a duplicate refetch
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const newUserId = session?.user.id ?? null;
      const changed = newUserId !== lastUserIdRef.current;
      lastUserIdRef.current = newUserId;

      if (changed) void resetAfterSessionChange(qc);

      if (session) {
        setIsDemo(false);
        // UUID only — never andrew_id or email
        // (docs/OBSERVABILITY.md)
        Sentry.setUser({ id: session.user.id });
      } else {
        setIsDemo(true);
        Sentry.setUser(null);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [qc]);

  const signOut = useCallback(async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setIsDemo(true);
    if (lastUserIdRef.current !== null) {
      lastUserIdRef.current = null;
      await resetAfterSessionChange(qc);
    }
  }, [qc]);

  const value = useMemo(
    () => ({ isDemo, isLoading, signOut }),
    [isDemo, isLoading, signOut],
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
