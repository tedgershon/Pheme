import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";

/**
 * Named invalidation helpers. The **only** place post-mutation invalidation
 * lists are defined. Mutation hooks call these from `onSettled` — no inline
 * `invalidateQueries` in mutation files.
 *
 * Adding a new query domain to the set that refreshes after some action?
 * Change it here, and every mutation that calls the helper picks it up.
 */

export const invalidateAfterBet = (qc: QueryClient, marketId: string) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.markets.detail(marketId) }),
    qc.invalidateQueries({ queryKey: queryKeys.markets.all }),
    qc.invalidateQueries({ queryKey: queryKeys.portfolio.all }),
    qc.invalidateQueries({ queryKey: queryKeys.me }),
    qc.invalidateQueries({ queryKey: queryKeys.bets.forMarket(marketId) }),
  ]);

export const invalidateAfterResolution = (qc: QueryClient, marketId: string) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.markets.detail(marketId) }),
    qc.invalidateQueries({ queryKey: queryKeys.markets.all }),
    qc.invalidateQueries({ queryKey: queryKeys.markets.resolutions }),
    qc.invalidateQueries({ queryKey: queryKeys.portfolio.all }),
    qc.invalidateQueries({ queryKey: queryKeys.portfolio.transactions() }),
    qc.invalidateQueries({ queryKey: queryKeys.me }),
  ]);

export const invalidateAfterDispute = (qc: QueryClient, marketId: string) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.markets.detail(marketId) }),
    qc.invalidateQueries({ queryKey: queryKeys.markets.resolutions }),
    qc.invalidateQueries({ queryKey: queryKeys.disputes.detail(marketId) }),
    qc.invalidateQueries({
      queryKey: queryKeys.disputes.submissions(marketId),
    }),
    // Admins see every concern grouped under the market's case.
    qc.invalidateQueries({ queryKey: queryKeys.admin.disputeCases }),
    qc.invalidateQueries({ queryKey: queryKeys.admin.reviewQueue }),
  ]);

export const invalidateAfterDisputeVote = (qc: QueryClient, marketId: string) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.disputes.votes(marketId) }),
    qc.invalidateQueries({
      queryKey: queryKeys.disputes.eligibility(marketId),
    }),
  ]);

export const invalidateAfterCommunityVote = (
  qc: QueryClient,
  marketId: string,
) => qc.invalidateQueries({ queryKey: queryKeys.communityVotes(marketId) });

export const invalidateAfterClaim = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.me }),
    qc.invalidateQueries({ queryKey: queryKeys.portfolio.transactions() }),
  ]);

export const invalidateAfterProfileUpdate = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: queryKeys.me });

export const invalidateAfterMarketCreate = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.portfolio.proposedMarkets }),
    qc.invalidateQueries({ queryKey: queryKeys.markets.all }),
    qc.invalidateQueries({ queryKey: queryKeys.markets.review }),
  ]);

export const invalidateAfterAdminReview = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.portfolio.proposedMarkets }),
    qc.invalidateQueries({ queryKey: queryKeys.markets.review }),
    qc.invalidateQueries({ queryKey: queryKeys.markets.all }),
  ]);

export const invalidateAfterBackroll = (qc: QueryClient, marketId: string) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.markets.detail(marketId) }),
    qc.invalidateQueries({ queryKey: queryKeys.markets.all }),
    qc.invalidateQueries({ queryKey: queryKeys.admin.stats }),
  ]);

// Settlement moves wallets, positions and rankings, not just the queue row.
export const invalidateAfterAdminResolution = (
  qc: QueryClient,
  marketId: string,
) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.admin.reviewQueue }),
    qc.invalidateQueries({ queryKey: queryKeys.admin.disputeCases }),
    qc.invalidateQueries({ queryKey: queryKeys.admin.stats }),
    qc.invalidateQueries({ queryKey: queryKeys.markets.detail(marketId) }),
    qc.invalidateQueries({ queryKey: queryKeys.markets.all }),
    qc.invalidateQueries({ queryKey: queryKeys.portfolio.all }),
    qc.invalidateQueries({ queryKey: queryKeys.me }),
    qc.invalidateQueries({ queryKey: queryKeys.leaderboardAll }),
  ]);

export const invalidateAfterUserRoleUpdate = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: ["admin", "users"] });

export const invalidateAfterNotificationsRead = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount }),
    qc.invalidateQueries({ queryKey: queryKeys.notifications.list() }),
  ]);

export const invalidateAfterBadgeCheck = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.rewards }),
    qc.invalidateQueries({ queryKey: ["badges"] }),
  ]);

// Market details/review results and portfolio data can contain private content.
// Reset cancels old requests, clears data and refetches mounted observers with
// the new session; invalidation alone would keep the previous account's data.
export const resetAfterSessionChange = (qc: QueryClient) => qc.resetQueries();
