import type {
  AdminDisputeCaseParams,
  ListBetsParams,
  ListMarketsParams,
  ListTransactionsParams,
} from "@/lib/api";

/**
 * Query key factory. The **only** place query keys are defined in the app.
 *
 * Rules:
 * - Every `useQuery`, `prefetchQuery`, `setQueryData`, and `invalidateQueries`
 *   call reads its key from here.
 * - String keys are forbidden elsewhere in the codebase.
 * - To invalidate a domain broadly, use its `.all` tuple (e.g.
 *   `queryKeys.markets.all` invalidates every markets-scoped query).
 */
export const queryKeys = {
  markets: {
    all: ["markets"] as const,
    list: (p?: ListMarketsParams) => ["markets", "list", p ?? {}] as const,
    detail: (id: string) => ["markets", "detail", id] as const,
    hot: (limit?: number) => ["markets", "hot", limit ?? 5] as const,
    trending: (limit?: number) => ["markets", "trending", limit ?? 3] as const,
    top: (limit?: number) => ["markets", "top", limit ?? 3] as const,
    resolutions: ["markets", "resolutions"] as const,
    review: ["markets", "review"] as const,
  },
  bets: {
    forMarket: (marketId: string, p?: ListBetsParams) =>
      ["bets", "market", marketId, p ?? {}] as const,
  },
  portfolio: {
    all: ["portfolio"] as const,
    proposedMarkets: ["portfolio", "proposedMarkets"] as const,
    transactions: (p?: ListTransactionsParams) =>
      ["portfolio", "transactions", p ?? {}] as const,
  },
  me: ["me"] as const,
  leaderboardAll: ["leaderboard"] as const,
  leaderboard: (p?: { limit?: number }) => ["leaderboard", p ?? {}] as const,
  weeklyLeaderboard: (limit?: number) =>
    ["leaderboard", "weekly", limit ?? 10] as const,
  rewards: ["rewards"] as const,
  badges: (userId: string) => ["badges", userId] as const,
  notifications: {
    list: (p?: { limit?: number; offset?: number }) =>
      ["notifications", "list", p ?? {}] as const,
    unreadCount: ["notifications", "unread-count"] as const,
  },
  admin: {
    stats: ["admin", "stats"] as const,
    reviewQueue: ["admin", "review-queue"] as const,
    disputeCases: ["admin", "dispute-cases"] as const,
    disputeCasePage: (p: AdminDisputeCaseParams) =>
      ["admin", "dispute-cases", p] as const,
    users: (query: string) => ["admin", "users", query] as const,
  },
  disputes: {
    detail: (marketId: string) => ["disputes", marketId] as const,
    votes: (marketId: string) => ["disputes", marketId, "votes"] as const,
    submissions: (marketId: string) =>
      ["disputes", marketId, "submissions"] as const,
    eligibility: (marketId: string) =>
      ["disputes", marketId, "eligibility"] as const,
  },
  communityVotes: (marketId: string) => ["communityVotes", marketId] as const,
} as const;
