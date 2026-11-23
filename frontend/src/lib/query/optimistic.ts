import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Snapshot + optimistic update helper for React Query mutations.
 *
 * Cancels any in-flight queries for `key`, reads the current cache value,
 * writes the updater's result, and returns a `rollback` thunk that restores
 * the snapshot. Use from `onMutate`; call `rollback()` from `onError`.
 *
 * This is the **only** sanctioned place for manual cache writes inside a
 * mutation — mutation hooks do not call `qc.getQueryData` / `qc.setQueryData`
 * directly.
 *
 * @example
 *   onMutate: async (vars) => {
 *     const market = await snapshotAndUpdate<Market>(
 *       qc,
 *       queryKeys.markets.detail(id),
 *       (m) => m && { ...m, yes_pool_total: m.yes_pool_total + vars.amount },
 *     );
 *     const me = await snapshotAndUpdate<UserProfile>(
 *       qc,
 *       queryKeys.me,
 *       (u) => u && { ...u, tartan_coin_balance: u.tartan_coin_balance - vars.amount },
 *     );
 *     return { rollbacks: [market.rollback, me.rollback] };
 *   },
 *   onError: (_e, _v, ctx) => ctx?.rollbacks.forEach((r) => r()),
 *   onSettled: () => invalidateAfterBet(qc, id),
 */
export async function snapshotAndUpdate<T>(
  qc: QueryClient,
  key: QueryKey,
  updater: (old: T | undefined) => T | undefined,
): Promise<{ prev: T | undefined; rollback: () => void }> {
  await qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<T>(key);
  qc.setQueryData<T>(key, updater(prev));
  return {
    prev,
    rollback: () => {
      qc.setQueryData<T>(key, prev);
    },
  };
}

/**
 * Convenience context type for mutations that snapshot multiple keys.
 * Return `{ rollbacks: [...] }` from `onMutate`; call them in `onError`.
 */
export type RollbackContext = { rollbacks: Array<() => void> };
