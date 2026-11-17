import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminResolveMarket, getAdminReviewQueue } from "../api";
import { invalidateAfterAdminResolution } from "../query/invalidators";
import { queryKeys } from "../query/keys";

vi.mock("../supabase", () => ({ supabase: null }));

afterEach(() => vi.unstubAllGlobals());

describe("admin resolution API", () => {
  it("lists the queue and posts outcomes to the admin route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("[]"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            market_id: "m1",
            status: "resolved",
            outcome: "AMBIGUOUS",
            refunded_total: 175,
            refunded_users: 2,
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAdminReviewQueue()).resolves.toEqual([]);
    const result = await adminResolveMarket("m1", { outcome: "AMBIGUOUS" });

    expect(fetchMock.mock.calls[0][0]).toMatch(
      /\/api\/admin\/markets\/admin-review$/,
    );
    expect(fetchMock.mock.calls[1][0]).toMatch(
      /\/api\/admin\/markets\/m1\/resolve$/,
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ outcome: "AMBIGUOUS" }),
    });
    expect(result.refunded_total).toBe(175);
  });
});

describe("invalidateAfterAdminResolution", () => {
  it("refreshes the queue, market, wallet, portfolio and leaderboard data", async () => {
    const qc = new QueryClient();
    const keys = [
      queryKeys.admin.reviewQueue,
      queryKeys.markets.detail("m1"),
      queryKeys.markets.list(),
      queryKeys.portfolio.transactions(),
      queryKeys.me,
      queryKeys.leaderboard(),
      queryKeys.weeklyLeaderboard(),
    ];
    for (const key of keys) qc.setQueryData(key, "cached");
    qc.setQueryData(queryKeys.notifications.unreadCount, 0);

    await invalidateAfterAdminResolution(qc, "m1");

    for (const key of keys) {
      expect(qc.getQueryState(key)?.isInvalidated, String(key)).toBe(true);
    }
    expect(
      qc.getQueryState(queryKeys.notifications.unreadCount)?.isInvalidated,
    ).toBe(false);
  });
});
