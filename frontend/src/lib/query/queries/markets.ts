import { queryOptions } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { queryKeys } from "../keys";
import { STALE } from "../staleTimes";

// all market-scoped read queries live here, same file so a reader can see the
// whole markets surface at a glance

export const marketsQuery = (params?: api.ListMarketsParams) =>
  queryOptions({
    queryKey: queryKeys.markets.list(params),
    queryFn: ({ signal }) => api.listMarkets(params, { signal }),
    staleTime: STALE.MARKETS_LIST,
  });

export const marketQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.markets.detail(id),
    queryFn: ({ signal }) => api.getMarket(id, { signal }),
    staleTime: STALE.MARKET_DETAIL,
  });

export const hotMarketsQuery = (limit?: number) =>
  queryOptions({
    queryKey: queryKeys.markets.hot(limit),
    queryFn: () => api.getHotMarkets(limit),
    staleTime: STALE.MARKETS_LIST,
  });

export const trendingMarketsQuery = (limit?: number) =>
  queryOptions({
    queryKey: queryKeys.markets.trending(limit),
    queryFn: () => api.getTrendingMarkets(limit),
    staleTime: STALE.MARKETS_LIST,
  });

export const topMarketsQuery = (limit?: number) =>
  queryOptions({
    queryKey: queryKeys.markets.top(limit),
    queryFn: () => api.getTopMarkets(limit),
    staleTime: STALE.MARKETS_LIST,
  });

export const resolutionMarketsQuery = () =>
  queryOptions({
    queryKey: queryKeys.markets.resolutions,
    queryFn: ({ signal }) => api.listResolutionMarkets({ signal }),
    staleTime: STALE.MARKETS_LIST,
  });

export const betsForMarketQuery = (
  marketId: string,
  params?: api.ListBetsParams,
) =>
  queryOptions({
    queryKey: queryKeys.bets.forMarket(marketId, params),
    queryFn: ({ signal }) =>
      api.listBetsForMarket(marketId, params, { signal }),
    staleTime: STALE.BETS,
  });

export const disputeQuery = (marketId: string) =>
  queryOptions({
    queryKey: queryKeys.disputes.detail(marketId),
    queryFn: ({ signal }) => api.getDispute(marketId, { signal }),
    staleTime: STALE.VOTES,
  });

export const disputeSubmissionsQuery = (marketId: string) =>
  queryOptions({
    queryKey: queryKeys.disputes.submissions(marketId),
    queryFn: ({ signal }) =>
      api.listDisputeSubmissions(marketId, {}, { signal }),
    staleTime: STALE.VOTES,
  });

// Signed-in only; session changes reset the cache, so the key needs no user id.
export const disputeEligibilityQuery = (marketId: string) =>
  queryOptions({
    queryKey: queryKeys.disputes.eligibility(marketId),
    queryFn: ({ signal }) => api.getDisputeEligibility(marketId, { signal }),
    staleTime: STALE.VOTES,
  });

export const disputeVotesQuery = (marketId: string) =>
  queryOptions({
    queryKey: queryKeys.disputes.votes(marketId),
    queryFn: ({ signal }) => api.listDisputeVotes(marketId, { signal }),
    staleTime: STALE.VOTES,
  });

export const communityVotesQuery = (marketId: string) =>
  queryOptions({
    queryKey: queryKeys.communityVotes(marketId),
    queryFn: ({ signal }) => api.listCommunityVotes(marketId, { signal }),
    staleTime: STALE.VOTES,
  });
