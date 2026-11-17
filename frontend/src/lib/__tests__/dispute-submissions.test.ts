import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fileDispute,
  getAdminDisputeCases,
  listDisputeSubmissions,
} from "../api";
import { invalidateAfterDispute } from "../query/invalidators";
import { queryKeys } from "../query/keys";

vi.mock("../supabase", () => ({ supabase: null }));

afterEach(() => vi.unstubAllGlobals());

describe("dispute submission API", () => {
  it("posts one explanation and reports whether it opened the case", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "s1",
          dispute_id: "d1",
          market_id: "m1",
          submitter_id: "u1",
          explanation: "Source disagrees",
          voting_deadline: "2026-11-20T00:00:00Z",
          opened_case: false,
          created_at: "2026-11-18T00:00:00Z",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fileDispute("m1", { explanation: "Source disagrees" });

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/markets\/m1\/dispute$/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ explanation: "Source disagrees" }),
    });
    expect(result.opened_case).toBe(false);
  });

  it("pages the public list and the admin queue", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ total: 0, has_submitted: false, items: [] }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [], total: 0, limit: 10, offset: 10 }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await listDisputeSubmissions("m1", { limit: 5, offset: 10 });
    await getAdminDisputeCases({
      status: "admin_review",
      limit: 10,
      offset: 10,
    });

    expect(fetchMock.mock.calls[0][0]).toMatch(
      /\/api\/markets\/m1\/dispute\/submissions\?limit=5&offset=10$/,
    );
    expect(fetchMock.mock.calls[1][0]).toMatch(
      /\/api\/admin\/markets\/disputes\?status=admin_review&limit=10&offset=10$/,
    );
  });
});

describe("invalidateAfterDispute", () => {
  it("refreshes the public concerns and every admin dispute view", async () => {
    const qc = new QueryClient();
    const keys = [
      queryKeys.markets.detail("m1"),
      queryKeys.disputes.submissions("m1"),
      queryKeys.admin.disputeCasePage({ limit: 10, offset: 0 }),
      queryKeys.admin.reviewQueue,
    ];
    for (const key of keys) qc.setQueryData(key, "cached");
    qc.setQueryData(queryKeys.disputes.submissions("other"), "cached");

    await invalidateAfterDispute(qc, "m1");

    for (const key of keys) {
      expect(qc.getQueryState(key)?.isInvalidated, String(key)).toBe(true);
    }
    expect(
      qc.getQueryState(queryKeys.disputes.submissions("other"))?.isInvalidated,
    ).toBe(false);
  });
});
