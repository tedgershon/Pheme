import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import type {
  BetSide,
  CreateMarketRequest,
  Market,
  ResolveMarketResponse,
} from "@/lib/types";
import {
  invalidateAfterCommunityVote,
  invalidateAfterDispute,
  invalidateAfterDisputeVote,
  invalidateAfterMarketCreate,
  invalidateAfterResolution,
} from "../invalidators";
import { queryKeys } from "../keys";
import { type RollbackContext, snapshotAndUpdate } from "../optimistic";

export function useCreateMarket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateMarketRequest) => api.createMarket(req),
    onSettled: () => invalidateAfterMarketCreate(qc),
  });
}

// creator proposes an outcome, we optimistically flip the market status
// so the UI shows "Pending Resolution" straight away
export function useResolveMarket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { marketId: string; outcome: BetSide }) =>
      api.resolveMarket(vars.marketId, { outcome: vars.outcome }),
    onMutate: async (vars): Promise<RollbackContext> => {
      const market = await snapshotAndUpdate<Market>(
        qc,
        queryKeys.markets.detail(vars.marketId),
        (m) =>
          m && {
            ...m,
            status: "pending_resolution",
            proposed_outcome: vars.outcome,
            proposed_at: new Date().toISOString(),
          },
      );
      return { rollbacks: [market.rollback] };
    },
    onSuccess: (res: ResolveMarketResponse, vars) => {
      // server may return an authoritative dispute_deadline, reflect it
      qc.setQueryData<Market>(queryKeys.markets.detail(vars.marketId), (m) =>
        m
          ? {
              ...m,
              status: res.status ?? m.status,
              proposed_outcome: res.proposed_outcome ?? m.proposed_outcome,
              dispute_deadline: res.dispute_deadline ?? m.dispute_deadline,
            }
          : m,
      );
    },
    onError: (_e, _v, ctx) => {
      ctx?.rollbacks.forEach((r) => {
        r();
      });
    },
    onSettled: (_d, _e, vars) => invalidateAfterResolution(qc, vars.marketId),
  });
}

export function useStartCommunityResolution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (marketId: string) => api.startCommunityResolution(marketId),
    onSuccess: (market) => {
      // server returns the updated market, drop it straight into the cache
      qc.setQueryData(queryKeys.markets.detail(market.id), market);
    },
    onSettled: (_d, _e, marketId) => invalidateAfterResolution(qc, marketId),
  });
}

export function useDisputeMarket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { marketId: string; explanation: string }) =>
      api.fileDispute(vars.marketId, { explanation: vars.explanation }),
    onMutate: async (vars): Promise<RollbackContext> => {
      const market = await snapshotAndUpdate<Market>(
        qc,
        queryKeys.markets.detail(vars.marketId),
        (m) => m && { ...m, status: "disputed" },
      );
      return { rollbacks: [market.rollback] };
    },
    onSuccess: (res, vars) => {
      qc.setQueryData<Market>(queryKeys.markets.detail(vars.marketId), (m) =>
        m
          ? {
              ...m,
              status: "disputed",
              // Later submissions join the case; they never change its metadata.
              ...(res.opened_case && {
                disputed_at: res.created_at,
                disputed_by: res.submitter_id,
              }),
              voting_ends_at: res.voting_deadline,
            }
          : m,
      );
    },
    onError: (_e, _v, ctx) => {
      ctx?.rollbacks.forEach((r) => {
        r();
      });
    },
    onSettled: (_d, _e, vars) => invalidateAfterDispute(qc, vars.marketId),
  });
}

export function useCastDisputeVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { marketId: string; vote: BetSide }) =>
      api.castDisputeVote(vars.marketId, { vote: vars.vote }),
    onSettled: (_d, _e, vars) => invalidateAfterDisputeVote(qc, vars.marketId),
  });
}

export function useCastCommunityVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { marketId: string; vote: BetSide }) =>
      api.castCommunityVote(vars.marketId, { vote: vars.vote }),
    onSettled: (_d, _e, vars) =>
      invalidateAfterCommunityVote(qc, vars.marketId),
  });
}
