import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import * as api from "@/lib/api";
import { applyRolePreview } from "@/lib/role-preview";
import { GUEST_USER, useSession } from "@/lib/SessionProvider";
import { useUiStore } from "@/lib/stores/uiStore";
import { queryKeys } from "../keys";
import { STALE } from "../staleTimes";

// meQuery is the single source of truth for profile data
// nothing should mirror this into zustand or context state
export const meQuery = () =>
  queryOptions({
    queryKey: queryKeys.me,
    queryFn: () => api.getMe(),
    staleTime: STALE.ME,
    // 401 when logged out shouldn't retry
    retry: false,
  });

// thin wrapper that always returns a user shape so consumers don't have to
// guard against undefined during the first render or logged-out state
//
// This is also the one place admin role preview is applied: while a preview
// is on, `user` carries role "user" and every existing role check follows it.
// `actualRole` is the real role, for the preview toggle and indicator only
// (a preview never changes the server role or any API call). The demo
// session ignores the store.
export function useMe() {
  const { data, isLoading, isFetching } = useQuery(meQuery());
  const { isDemo } = useSession();
  const preview = useUiStore((s) => s.rolePreview);
  const profile = data ?? GUEST_USER;
  const user = useMemo(
    () => applyRolePreview(profile, isDemo ? null : preview),
    [profile, isDemo, preview],
  );
  return {
    user,
    isLoading,
    isFetching,
    actualRole: profile.role,
    isPreviewing: user !== profile,
  };
}
