// ---------------------------------------------------------------------------
// Domain types (mirror DATA_MODEL.md and backend response schemas)
// ---------------------------------------------------------------------------

export type MarketStatus =
  | "pending_review"
  | "open"
  | "closed"
  | "pending_resolution"
  | "disputed"
  | "admin_review"
  | "resolved"
  | "denied";
export type BetSide = "YES" | "NO";

export type UserRole = "user" | "admin" | "super_admin";
export type EquippedBadgesMap = Record<string, string | null>;

export interface UserProfile {
  id: string;
  andrew_id: string;
  display_name: string;
  banana_balance: number;
  created_at: string;
  claimed_today: boolean;
  role: UserRole;
  is_admin: boolean;
  claim_eligible: boolean;
  claim_amount: number;
  above_cap: boolean;
  equipped_badge_id: string | null;
  equipped_badges: EquippedBadgesMap;
  avatar_url: string | null;
}

export interface AdminStats {
  total_users: number;
  users_by_role: Record<string, number>;
  total_markets: number;
  markets_by_status: Record<string, number>;
  total_banana_traded: number;
  total_active_bets: number;
}

export interface UserSearchResult {
  id: string;
  andrew_id: string;
  display_name: string;
  role: string;
  created_at: string;
}

export interface MarketOption {
  id: string;
  market_id: string;
  label: string;
  pool_total: number;
  sort_order: number;
  is_winner: boolean | null;
  created_at: string;
}

export interface Market {
  id: string;
  title: string;
  description: string;

  creator_id: string;
  created_at: string;
  close_at: string;

  status: MarketStatus;

  resolution_criteria: string;
  yes_pool_total: number;
  no_pool_total: number;

  official_source?: string | null;
  yes_criteria?: string | null;
  no_criteria?: string | null;
  ambiguity_criteria?: string | null;
  proposed_outcome?: BetSide | null;
  proposed_at?: string | null;
  dispute_deadline?: string | null;
  resolved_outcome: BetSide | null;
  resolved_at: string | null;
  disputed_at?: string | null;
  disputed_by?: string | null;
  voting_ends_at?: string | null;
  category: string;
  link?: string | null;
  reviewed_by?: string | null;
  review_date?: string | null;
  review_notes?: string | null;
  resolution_window_end?: string | null;
  market_type: "binary" | "multichoice";
  multichoice_type: "exclusive" | "non_exclusive" | null;
  options?: MarketOption[] | null;
}

export interface Bet {
  id: string;
  user_id: string;
  market_id: string;

  side: BetSide | null;
  option_id?: string | null;
  amount: number;
  created_at: string;
}

export type TransactionType =
  | "initial_grant"
  | "bet_placement"
  | "payout"
  | "voter_stake"
  | "voter_reward"
  | "daily_claim"
  | "resolution_vote_reward";

export interface Transaction {
  id: string;
  user_id: string;
  market_id: string | null;
  transaction_type: TransactionType;
  amount: number;
  created_at: string;
}

export interface LeaderboardEntry {
  id: string;
  andrew_id: string;
  display_name: string;
  banana_balance: number;
  gain: number;
  equipped_badge_id: string | null;
  equipped_badges: EquippedBadgesMap;
  avatar_url: string | null;
}

export interface WeeklyLeaderboardEntry {
  id: string;
  andrew_id: string;
  display_name: string;
  banana_balance: number;
  gains: number;
}

export interface WeeklyLeaderboardResponse {
  period: "7d" | "30d" | "all_time";
  entries: WeeklyLeaderboardEntry[];
}

// ---------------------------------------------------------------------------
// Request types (match backend Pydantic request schemas)
// ---------------------------------------------------------------------------

export interface CreateMarketRequest {
  title: string;
  description: string;
  close_at: string;
  close_timezone?: string;
  resolution_criteria: string;
  category?: string;
  official_source?: string;
  yes_criteria?: string;
  no_criteria?: string;
  ambiguity_criteria?: string;
  link?: string;
  market_type?: "binary" | "multichoice";
  multichoice_type?: "exclusive" | "non_exclusive";
  options?: string[];
}

export interface ReviewMarketRequest {
  action: "approve" | "deny";
  notes?: string | null;
  title?: string | null;
  description?: string | null;
  resolution_criteria?: string | null;
  close_at?: string | null;
  category?: string | null;
  link?: string | null;
}

export interface ResolveMarketRequest {
  outcome: BetSide;
}

export interface FileDisputeRequest {
  explanation: string;
}

export interface CastVoteRequest {
  vote: BetSide;
}

export interface PlaceBetRequest {
  side: BetSide;
  amount: number;
}

export interface PlaceMultichoiceBetRequest {
  option_id: string;
  amount: number;
}

export interface BackrollRequest {
  cutoff_date: string;
  close_market: boolean;
}

export interface BackrollResponse {
  market_id: string;
  bets_cancelled: number;
  total_refunded: number;
  market_closed?: boolean;
  cutoff_date?: string;
  status?: string;
}

export interface CreateProfileRequest {
  andrew_id: string;
  display_name: string;
}

// ---------------------------------------------------------------------------
// Response types (when they differ from the domain types above)
// ---------------------------------------------------------------------------

export interface PlaceBetResponse {
  bet_id: string;
  new_balance: number;
}

export interface ResolveMarketResponse {
  market_id: string;
  status: MarketStatus;
  proposed_outcome?: BetSide;
  dispute_deadline?: string | null;
  outcome?: BetSide;
}

export interface ClaimDailyResponse {
  new_balance: number;
  claimed_amount: number;
  claimed_at: string;
}

export interface DisputeResponse {
  id: string;
  market_id: string;
  disputer_id: string;
  explanation: string;
  voting_deadline: string;
  resolved_by_admin: boolean;
  created_at: string;
}

export interface VoteResponse {
  id: string;
  dispute_id: string;
  market_id: string;
  voter_id: string;
  selected_outcome: BetSide;
  created_at: string;
}

export interface CommunityVote {
  id: string;
  market_id: string;
  voter_id: string;
  selected_outcome: BetSide;
  created_at: string;
}

export interface NotificationResponse {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export interface PricePoint {
  timestamp: string;
  probability: number;
}

export interface BadgeDefinition {
  id: string;
  track: string;
  tier: number;
  name: string;
  description: string;
  threshold: number;
  color: string;
}

export interface UserBadge {
  id: string;
  user_id: string;
  badge_id: string;
  track: string;
  tier: number;
  earned_at: string;
  badge_definitions: BadgeDefinition;
}

export interface TrackProgress {
  track: string;
  track_display_name: string;
  track_description: string;
  current_value: number;
  next_threshold: number | null;
  current_tier: number;
  max_tier: number;
  tiers: BadgeDefinition[];
}

export interface RewardsResponse {
  tracks: TrackProgress[];
  badges: UserBadge[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Parimutuel yes-probability derived from pool totals
// TODO: later, consider taking into account the fee charged if we're reflecting payout
export function getMarketProbability(market: Market): number {
  const total = market.yes_pool_total + market.no_pool_total;
  if (total === 0) return 50;
  return Math.round((market.yes_pool_total / total) * 100);
}

// A market is only bettable if its DB status is 'open' AND close_at is still
// in the future. The backend state machine transitions open→closed lazily on
// endpoint hits, so there's a window where `status === "open"` lingers after
// `close_at` has elapsed. Checking both here closes that window client-side
// and keeps the bet button in sync with what `place_bet` will actually accept.
export function isMarketOpen(
  market: Pick<Market, "status" | "close_at">,
): boolean {
  if (market.status !== "open") return false;
  return new Date(market.close_at).getTime() > Date.now();
}
