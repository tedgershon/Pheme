import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import type {
  BackrollRequest,
  ResolvedOutcome,
  ReviewMarketRequest,
} from "@/lib/types";
import {
  invalidateAfterAdminResolution,
  invalidateAfterAdminReview,
  invalidateAfterBackroll,
  invalidateAfterUserRoleUpdate,
} from "../invalidators";

export function useReviewMarket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { marketId: string; body: ReviewMarketRequest }) =>
      api.reviewMarket(vars.marketId, vars.body),
    onSettled: () => invalidateAfterAdminReview(qc),
  });
}

export function useAdminResolveMarket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { marketId: string; outcome: ResolvedOutcome }) =>
      api.adminResolveMarket(vars.marketId, { outcome: vars.outcome }),
    // Also on failure: a concurrent admin may already have settled the market.
    onSettled: (_d, _e, vars) =>
      invalidateAfterAdminResolution(qc, vars.marketId),
  });
}

export function useBackrollMarket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { marketId: string; body: BackrollRequest }) =>
      api.backrollMarket(vars.marketId, vars.body),
    onSettled: (_d, _e, vars) => invalidateAfterBackroll(qc, vars.marketId),
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { userId: string; role: string }) =>
      api.updateUserRole(vars.userId, vars.role),
    onSettled: () => invalidateAfterUserRoleUpdate(qc),
  });
}
