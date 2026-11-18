import { queryOptions } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { queryKeys } from "../keys";
import { STALE } from "../staleTimes";

export const adminStatsQuery = () =>
  queryOptions({
    queryKey: queryKeys.admin.stats,
    queryFn: () => api.getAdminStats(),
    staleTime: STALE.ADMIN,
  });

export const marketsForReviewQuery = () =>
  queryOptions({
    queryKey: queryKeys.markets.review,
    queryFn: () => api.getMarketsForReview(),
    staleTime: STALE.ADMIN,
  });

export const adminReviewQueueQuery = () =>
  queryOptions({
    queryKey: queryKeys.admin.reviewQueue,
    queryFn: () => api.getAdminReviewQueue(),
    staleTime: STALE.ADMIN,
  });

export const adminDisputeCasesQuery = (params: api.AdminDisputeCaseParams) =>
  queryOptions({
    queryKey: queryKeys.admin.disputeCasePage(params),
    queryFn: () => api.getAdminDisputeCases(params),
    staleTime: STALE.ADMIN,
    placeholderData: (previous) => previous,
  });

export const searchUsersQuery = (query: string) =>
  queryOptions({
    queryKey: queryKeys.admin.users(query),
    queryFn: () => api.searchUsers(query),
    staleTime: STALE.ADMIN,
    enabled: query.trim().length > 0,
  });
