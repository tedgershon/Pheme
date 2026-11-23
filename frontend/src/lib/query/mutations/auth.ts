import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import type { UserProfile } from "@/lib/types";
import {
  invalidateAfterClaim,
  invalidateAfterProfileUpdate,
} from "../invalidators";
import { queryKeys } from "../keys";
import { type RollbackContext, snapshotAndUpdate } from "../optimistic";

// optimistically bumps balance + flips claimed_today so the banner disappears
// right away, server reconciles on invalidate
export function useClaimDaily() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.claimDaily(),
    onSuccess: (res) => {
      qc.setQueryData<UserProfile>(queryKeys.me, (u) =>
        u
          ? {
              ...u,
              tartan_coin_balance: res.new_balance,
              claimed_today: true,
              claim_eligible: false,
            }
          : u,
      );
    },
    onSettled: () => invalidateAfterClaim(qc),
  });
}

type ProfileUpdate = Parameters<typeof api.updateProfile>[0];

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileUpdate) => api.updateProfile(body),
    onMutate: async (body): Promise<RollbackContext> => {
      const me = await snapshotAndUpdate<UserProfile>(
        qc,
        queryKeys.me,
        (u) => u && ({ ...u, ...body } as UserProfile),
      );
      return { rollbacks: [me.rollback] };
    },
    onSuccess: (updated) => {
      qc.setQueryData<UserProfile>(queryKeys.me, updated);
    },
    onError: (_e, _v, ctx) => {
      ctx?.rollbacks.forEach((r) => {
        r();
      });
    },
    onSettled: () => invalidateAfterProfileUpdate(qc),
  });
}
