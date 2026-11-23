import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import type { Market, UserProfile } from "@/lib/types";
import { invalidateAfterBet } from "../invalidators";
import { queryKeys } from "../keys";
import { type RollbackContext, snapshotAndUpdate } from "../optimistic";

// binary YES/NO bet, optimistic pool + balance bump so the UI is instant
export function usePlaceBet(marketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { side: "YES" | "NO"; amount: number }) =>
      api.placeBet(marketId, vars),
    onMutate: async (vars): Promise<RollbackContext> => {
      const market = await snapshotAndUpdate<Market>(
        qc,
        queryKeys.markets.detail(marketId),
        (m) => {
          if (!m) return m;
          return vars.side === "YES"
            ? { ...m, yes_pool_total: m.yes_pool_total + vars.amount }
            : { ...m, no_pool_total: m.no_pool_total + vars.amount };
        },
      );
      const me = await snapshotAndUpdate<UserProfile>(
        qc,
        queryKeys.me,
        (u) =>
          u && {
            ...u,
            tartan_coin_balance: u.tartan_coin_balance - vars.amount,
          },
      );
      return { rollbacks: [market.rollback, me.rollback] };
    },
    onError: (_e, _v, ctx) => {
      ctx?.rollbacks.forEach((r) => {
        r();
      });
    },
    onSettled: () => invalidateAfterBet(qc, marketId),
  });
}

// multichoice bet, bumps the chosen option's pool + decrements balance
export function usePlaceMultichoiceBet(marketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { optionId: string; amount: number }) =>
      api.placeMultichoiceBet(marketId, {
        option_id: vars.optionId,
        amount: vars.amount,
      }),
    onMutate: async (vars): Promise<RollbackContext> => {
      const market = await snapshotAndUpdate<Market>(
        qc,
        queryKeys.markets.detail(marketId),
        (m) => {
          if (!m || !m.options) return m;
          return {
            ...m,
            options: m.options.map((opt) =>
              opt.id === vars.optionId
                ? { ...opt, pool_total: opt.pool_total + vars.amount }
                : opt,
            ),
          };
        },
      );
      const me = await snapshotAndUpdate<UserProfile>(
        qc,
        queryKeys.me,
        (u) =>
          u && {
            ...u,
            tartan_coin_balance: u.tartan_coin_balance - vars.amount,
          },
      );
      return { rollbacks: [market.rollback, me.rollback] };
    },
    onError: (_e, _v, ctx) => {
      ctx?.rollbacks.forEach((r) => {
        r();
      });
    },
    onSettled: () => invalidateAfterBet(qc, marketId),
  });
}
