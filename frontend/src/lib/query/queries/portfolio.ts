import { queryOptions } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { queryKeys } from "../keys";
import { STALE } from "../staleTimes";

export const portfolioQuery = () =>
  queryOptions({
    queryKey: queryKeys.portfolio.all,
    queryFn: ({ signal }) => api.getPortfolio({ signal }),
    staleTime: STALE.PORTFOLIO,
  });

export const transactionsQuery = (params?: api.ListTransactionsParams) =>
  queryOptions({
    queryKey: queryKeys.portfolio.transactions(params),
    queryFn: ({ signal }) => api.getTransactions(params, { signal }),
    staleTime: STALE.TRANSACTIONS,
  });

export const proposedMarketsQuery = () =>
  queryOptions({
    queryKey: queryKeys.portfolio.proposedMarkets,
    queryFn: ({ signal }) => api.getMyProposedMarkets({ signal }),
    staleTime: STALE.PORTFOLIO,
  });
