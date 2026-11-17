import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invalidateAfterAdminReview,
  invalidateAfterMarketCreate,
  resetAfterSessionChange,
} from "../query/invalidators";
import { queryKeys } from "../query/keys";
import { proposedMarketsQuery } from "../query/queries/portfolio";

vi.mock("../supabase", () => ({ supabase: null }));

describe("proposed-market privacy and refresh", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the owner endpoint and passes its abort signal", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetch);
    const qc = new QueryClient();
    try {
      await expect(qc.fetchQuery(proposedMarketsQuery())).resolves.toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toMatch(
        /\/api\/portfolio\/proposed-markets$/,
      );
      expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    } finally {
      qc.clear();
    }
  });

  it.each([invalidateAfterMarketCreate, invalidateAfterAdminReview])(
    "refreshes cached proposals after creation or admin review",
    async (invalidate) => {
      const qc = new QueryClient();
      try {
        qc.setQueryData(queryKeys.portfolio.proposedMarkets, [
          { id: "pending" },
        ]);
        await invalidate(qc);
        expect(
          qc.getQueryState(queryKeys.portfolio.proposedMarkets)?.isInvalidated,
        ).toBe(true);
      } finally {
        qc.clear();
      }
    },
  );

  it("clears private data on an account switch and discards the old in-flight response", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = queryKeys.portfolio.proposedMarkets;
    qc.setQueryData(key, [{ id: "a-private" }]);
    qc.setQueryData(queryKeys.markets.detail("a-private"), {
      title: "private title",
    });
    qc.setQueryData(queryKeys.markets.review, { pending: ["a-private"] });
    let finishOld!: (data: { id: string }[]) => void;
    let finishNew!: (data: { id: string }[]) => void;
    const queryFn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNew = resolve;
          }),
      );
    const observer = new QueryObserver(qc, { queryKey: key, queryFn });
    const unsubscribe = observer.subscribe(() => {});
    try {
      expect(queryFn).toHaveBeenCalledTimes(1);
      const reset = resetAfterSessionChange(qc);
      expect(observer.getCurrentResult().data).toBeUndefined();
      expect(
        qc.getQueryData(queryKeys.markets.detail("a-private")),
      ).toBeUndefined();
      expect(qc.getQueryData(queryKeys.markets.review)).toBeUndefined();
      expect(queryFn).toHaveBeenCalledTimes(2);
      finishNew([{ id: "b-private" }]);
      await reset;
      finishOld([{ id: "a-private" }]);
      await Promise.resolve();
      expect(observer.getCurrentResult().data).toEqual([{ id: "b-private" }]);
    } finally {
      unsubscribe();
      qc.clear();
    }
  });
});
