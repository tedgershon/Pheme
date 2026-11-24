import * as Sentry from "@sentry/nextjs";
import { SESSION_EXPIRED, signInPath } from "./sign-in-redirect";
import { supabase } from "./supabase";
import type {
  AdminDisputeCasePage,
  AdminResolveMarketRequest,
  AdminResolveMarketResponse,
  AdminReviewItem,
  AdminStats,
  BackrollRequest,
  BackrollResponse,
  Bet,
  CastVoteRequest,
  CastVoteResponse,
  ClaimDailyResponse,
  CommunityVote,
  CreateMarketRequest,
  CreateProfileRequest,
  DisputeEligibility,
  DisputeResponse,
  DisputeSubmissionList,
  DisputeSubmissionResponse,
  FileDisputeRequest,
  LeaderboardEntry,
  Market,
  NotificationResponse,
  PlaceBetRequest,
  PlaceBetResponse,
  PlaceMultichoiceBetRequest,
  ResolveMarketRequest,
  ResolveMarketResponse,
  ReviewMarketRequest,
  RewardsResponse,
  Transaction,
  UserBadge,
  UserProfile,
  UserSearchResult,
  VoteResponse,
  WeeklyLeaderboardResponse,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const MAX_PROFILE_AVATAR_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  code: string;
  message: string;
  errors?: { field: string; message: string; type: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ApiError extends Error {
  public readonly code: string;
  public readonly userMessage: string;
  public readonly fieldErrors: { field: string; message: string }[];
  public readonly raw: string;
  /** Backend `x-request-id`, matching `extra.request_id` on its Sentry event. */
  public readonly requestId: string | null;

  constructor(
    public status: number,
    // Preserve body for existing callers until their error handling is migrated.
    public body: string,
    requestId: string | null = null,
  ) {
    let code = "UNKNOWN";
    let userMessage = `Request failed (${status}).`;
    const fieldErrors: { field: string; message: string }[] = [];

    try {
      const parsed: unknown = JSON.parse(body);
      const detail = isRecord(parsed) ? parsed.detail : undefined;
      if (
        isRecord(detail) &&
        typeof detail.code === "string" &&
        typeof detail.message === "string"
      ) {
        code = detail.code;
        userMessage = detail.message;
        if (Array.isArray(detail.errors)) {
          for (const error of detail.errors) {
            if (
              isRecord(error) &&
              typeof error.field === "string" &&
              typeof error.message === "string"
            ) {
              fieldErrors.push({ field: error.field, message: error.message });
            }
          }
        }
      }
    } catch {
      // Legacy text and malformed responses use the safe status-based fallback.
    }

    super(userMessage);
    this.name = "ApiError";
    this.code = code;
    this.userMessage = userMessage;
    this.fieldErrors = fieldErrors;
    this.raw = body;
    this.requestId = requestId;
  }
}

/**
 * Report a server failure so the browser event can be matched to the backend
 * event by request ID. Expected 4xx responses are not reported. The path omits
 * the query string, which can carry search text.
 */
function reportServerError(error: ApiError, path: string) {
  if (error.status < 500) return;
  Sentry.captureException(error, {
    tags: {
      error_code: error.code,
      http_status: String(error.status),
      ...(error.requestId ? { request_id: error.requestId } : {}),
    },
    extra: { path: path.split("?")[0] },
  });
}

export function parseApiError(
  err: unknown,
  fallback = "Something went wrong.",
): { code: string; message: string; fieldErrors: ApiError["fieldErrors"] } {
  if (err instanceof ApiError) {
    return {
      code: err.code,
      message: err.userMessage,
      fieldErrors: err.fieldErrors,
    };
  }
  if (err instanceof Error && err.name === "AbortError") {
    return { code: "ABORTED", message: "Request cancelled.", fieldErrors: [] };
  }
  if (err instanceof TypeError && /fetch/i.test(err.message)) {
    return {
      code: "NETWORK_ERROR",
      message: "Connection failed. Check your internet.",
      fieldErrors: [],
    };
  }
  return { code: "UNKNOWN", message: fallback, fieldErrors: [] };
}

async function accessToken(): Promise<string | null> {
  // browser client can't read cookies on the server — skip auth there
  // (server prefetch only hits public endpoints anyway)
  if (!supabase || typeof window === "undefined") return null;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    // session lookup failed — fall back to unauthenticated request
    return null;
  }
}

// Session-expiry handling (#86, docs/AUTHZ_MATRIX.md section 2). A 401 to a
// request that carried a token means the API rejected the session. The client
// refreshes it once and retries; if the retry is rejected too, it clears the
// local session and sends the user to sign in, then back to this page. Shared
// across concurrent requests, so a burst of 401s refreshes and redirects once.
let refreshing: Promise<string | null> | null = null;
let sessionEnded = false;

function refreshAccessToken(): Promise<string | null> {
  const client = supabase;
  if (!client || sessionEnded) return Promise.resolve(null);
  refreshing ??= Promise.resolve()
    .then(() => client.auth.refreshSession())
    .then(({ data, error }) => (error ? null : data.session?.access_token))
    .catch(() => null)
    .then((token) => token ?? null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function endRejectedSession() {
  if (sessionEnded || typeof window === "undefined") return;
  sessionEnded = true;
  try {
    // "local" revokes only this session (other devices stay signed in) and
    // deletes its cookie. If the logout call itself fails, supabase-js keeps
    // the cookie; the reason parameter still keeps /sign-in from bouncing back.
    await supabase?.auth.signOut({ scope: "local" });
  } catch {
    // Same as above: the redirect below does not depend on the sign-out.
  }
  window.location.assign(signInPath(window.location.pathname, SESSION_EXPIRED));
}

function send(
  path: string,
  options: RequestInit | undefined,
  token: string | null,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await accessToken();
  let res = await send(path, options, token);

  // Without a token a 401 is ordinary (anonymous browsing): no refresh, no
  // redirect. A 401 is sent before the handler runs, so a retry is safe.
  if (res.status === 401 && token) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await send(path, options, refreshed);
    if (res.status === 401) await endRejectedSession();
  }

  const raw = await res.text();

  if (!res.ok) {
    const error = new ApiError(
      res.status,
      raw,
      res.headers.get("x-request-id"),
    );
    reportServerError(error, path);
    throw error;
  }

  if (!raw) {
    return undefined as T;
  }

  return JSON.parse(raw) as T;
}

/**
 * Optional per-call options for endpoints that can be invoked from an effect
 * whose dependencies may change mid-flight. Pass an AbortSignal to cancel the
 * request when the effect re-runs or the component unmounts; a DOMException
 * named "AbortError" will be thrown and should generally be ignored.
 */
export interface FetchOpts {
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Auth  –  POST /api/auth/*
// ---------------------------------------------------------------------------

export function getMe(): Promise<UserProfile> {
  return apiFetch("/api/auth/me");
}

export function createProfile(
  body: CreateProfileRequest,
): Promise<UserProfile> {
  return apiFetch("/api/auth/profile", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateProfile(body: {
  display_name?: string;
  equipped_badge_id?: string | null;
  equipped_badges?: Record<string, string | null> | null;
  avatar_url?: string | null;
}): Promise<UserProfile> {
  return apiFetch("/api/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function uploadAvatar(
  userId: string,
  file: File,
): Promise<string> {
  const { supabase } = await import("./supabase");
  if (!supabase) throw new Error("Supabase not configured");

  if (!file.type.startsWith("image/")) {
    throw new Error("Please select an image file.");
  }
  if (file.size > MAX_PROFILE_AVATAR_BYTES) {
    throw new Error(
      "Profile photo is too large. Please upload an image under 5 MB.",
    );
  }

  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${userId}/avatar.${ext}`;

  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true });

  if (error) throw error;

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);

  return publicUrl;
}

/** Delete every stored file in the user's avatars folder. */
export async function removeAvatar(userId: string): Promise<void> {
  const { supabase } = await import("./supabase");
  if (!supabase) throw new Error("Supabase not configured");

  const bucket = supabase.storage.from("avatars");
  const { data, error } = await bucket.list(userId);
  if (error) throw error;

  const paths = (data ?? []).map((file) => `${userId}/${file.name}`);
  if (paths.length === 0) return;

  const { error: removeError } = await bucket.remove(paths);
  if (removeError) throw removeError;
}

export function claimDaily(): Promise<ClaimDailyResponse> {
  return apiFetch("/api/auth/claim-daily", { method: "POST" });
}

// ---------------------------------------------------------------------------
// Markets  –  /api/markets
// ---------------------------------------------------------------------------

export interface ListMarketsParams {
  status?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export function listMarkets(
  params?: ListMarketsParams,
  opts?: FetchOpts,
): Promise<Market[]> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.category) sp.set("category", params.category);
  if (params?.limit != null) sp.set("limit", String(params.limit));
  if (params?.offset != null) sp.set("offset", String(params.offset));
  const qs = sp.toString();
  return apiFetch(`/api/markets${qs ? `?${qs}` : ""}`, {
    signal: opts?.signal,
  });
}

export function getMarket(marketId: string, opts?: FetchOpts): Promise<Market> {
  return apiFetch(`/api/markets/${marketId}`, { signal: opts?.signal });
}

export function createMarket(body: CreateMarketRequest): Promise<Market> {
  return apiFetch("/api/markets", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function resolveMarket(
  marketId: string,
  body: ResolveMarketRequest,
): Promise<ResolveMarketResponse> {
  return apiFetch(`/api/markets/${marketId}/resolve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function startCommunityResolution(marketId: string): Promise<Market> {
  return apiFetch(`/api/markets/${marketId}/community-resolution`, {
    method: "POST",
  });
}

export function fileDispute(
  marketId: string,
  body: FileDisputeRequest,
): Promise<DisputeSubmissionResponse> {
  return apiFetch(`/api/markets/${marketId}/dispute`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getDispute(
  marketId: string,
  opts?: FetchOpts,
): Promise<DisputeResponse> {
  return apiFetch(`/api/markets/${marketId}/dispute`, { signal: opts?.signal });
}

export function listDisputeSubmissions(
  marketId: string,
  params?: { limit?: number; offset?: number },
  opts?: FetchOpts,
): Promise<DisputeSubmissionList> {
  const qs = new URLSearchParams();
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const suffix = qs.size ? `?${qs}` : "";
  return apiFetch(`/api/markets/${marketId}/dispute/submissions${suffix}`, {
    signal: opts?.signal,
  });
}

export function getDisputeEligibility(
  marketId: string,
  opts?: FetchOpts,
): Promise<DisputeEligibility> {
  return apiFetch(`/api/markets/${marketId}/dispute/eligibility`, {
    signal: opts?.signal,
  });
}

export function castDisputeVote(
  marketId: string,
  body: CastVoteRequest,
): Promise<CastVoteResponse> {
  return apiFetch(`/api/markets/${marketId}/dispute/vote`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listDisputeVotes(
  marketId: string,
  opts?: FetchOpts,
): Promise<VoteResponse[]> {
  return apiFetch(`/api/markets/${marketId}/dispute/votes`, {
    signal: opts?.signal,
  });
}

// ---------------------------------------------------------------------------
// Community Resolution Votes  –  /api/markets/:id/community-vote(s)
// ---------------------------------------------------------------------------

export function castCommunityVote(
  marketId: string,
  body: CastVoteRequest,
): Promise<CommunityVote> {
  return apiFetch(`/api/markets/${marketId}/community-vote`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listCommunityVotes(
  marketId: string,
  opts?: FetchOpts,
): Promise<CommunityVote[]> {
  return apiFetch(`/api/markets/${marketId}/community-votes`, {
    signal: opts?.signal,
  });
}

export function listResolutionMarkets(opts?: FetchOpts): Promise<Market[]> {
  return apiFetch("/api/markets/resolutions", { signal: opts?.signal });
}

export function getHotMarkets(limit = 5): Promise<Market[]> {
  return apiFetch(`/api/markets/hot?limit=${limit}`);
}

export function getTrendingMarkets(limit = 3): Promise<Market[]> {
  return apiFetch(`/api/markets/trending?limit=${limit}`);
}

export function getTopMarkets(limit = 3): Promise<Market[]> {
  return apiFetch(`/api/markets/top?limit=${limit}`);
}

// ---------------------------------------------------------------------------
// Bets  –  /api/markets/:id/bets
// ---------------------------------------------------------------------------

export function placeBet(
  marketId: string,
  body: PlaceBetRequest,
): Promise<PlaceBetResponse> {
  return apiFetch(`/api/markets/${marketId}/bets`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function placeMultichoiceBet(
  marketId: string,
  body: PlaceMultichoiceBetRequest,
): Promise<PlaceBetResponse> {
  return apiFetch(`/api/markets/${marketId}/bets/option`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface ListBetsParams {
  limit?: number;
  offset?: number;
}

export function listBetsForMarket(
  marketId: string,
  params?: ListBetsParams,
  opts?: FetchOpts,
): Promise<Bet[]> {
  const sp = new URLSearchParams();
  if (params?.limit != null) sp.set("limit", String(params.limit));
  if (params?.offset != null) sp.set("offset", String(params.offset));
  const qs = sp.toString();
  return apiFetch(`/api/markets/${marketId}/bets${qs ? `?${qs}` : ""}`, {
    signal: opts?.signal,
  });
}

// ---------------------------------------------------------------------------
// Portfolio  –  /api/portfolio, /api/transactions
// ---------------------------------------------------------------------------

export function getMyProposedMarkets(opts?: FetchOpts): Promise<Market[]> {
  return apiFetch("/api/portfolio/proposed-markets", { signal: opts?.signal });
}

export function getPortfolio(opts?: FetchOpts): Promise<Bet[]> {
  return apiFetch("/api/portfolio", { signal: opts?.signal });
}

export interface ListTransactionsParams {
  limit?: number;
  offset?: number;
}

export function getTransactions(
  params?: ListTransactionsParams,
  opts?: FetchOpts,
): Promise<Transaction[]> {
  const sp = new URLSearchParams();
  if (params?.limit != null) sp.set("limit", String(params.limit));
  if (params?.offset != null) sp.set("offset", String(params.offset));
  const qs = sp.toString();
  return apiFetch(`/api/transactions${qs ? `?${qs}` : ""}`, {
    signal: opts?.signal,
  });
}

// ---------------------------------------------------------------------------
// Leaderboard  –  /api/leaderboard
// ---------------------------------------------------------------------------

export function getLeaderboard(params?: {
  limit?: number;
}): Promise<LeaderboardEntry[]> {
  const sp = new URLSearchParams();
  if (params?.limit != null) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  return apiFetch(`/api/leaderboard${qs ? `?${qs}` : ""}`);
}

export function getWeeklyLeaderboard(
  limit = 10,
): Promise<WeeklyLeaderboardResponse> {
  return apiFetch(`/api/leaderboard/weekly?limit=${limit}`);
}

// ---------------------------------------------------------------------------
// Admin  –  /api/admin
// ---------------------------------------------------------------------------

export function getAdminStats(): Promise<AdminStats> {
  return apiFetch("/api/admin/stats");
}

export function searchUsers(query: string): Promise<UserSearchResult[]> {
  return apiFetch(`/api/admin/users/search?q=${encodeURIComponent(query)}`);
}

export function updateUserRole(
  userId: string,
  role: string,
): Promise<UserSearchResult> {
  return apiFetch(`/api/admin/users/${userId}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
}

export function getMarketsForReview(): Promise<{
  pending: Market[];
  approved: Market[];
  denied: Market[];
}> {
  return apiFetch("/api/admin/markets/review");
}

export function reviewMarket(
  marketId: string,
  body: ReviewMarketRequest,
): Promise<unknown> {
  return apiFetch(`/api/admin/markets/${marketId}/review`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getAdminReviewQueue(): Promise<AdminReviewItem[]> {
  return apiFetch("/api/admin/markets/admin-review");
}

export interface AdminDisputeCaseParams {
  status?: "disputed" | "admin_review";
  limit?: number;
  offset?: number;
}

export function getAdminDisputeCases(
  params?: AdminDisputeCaseParams,
): Promise<AdminDisputeCasePage> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const suffix = qs.size ? `?${qs}` : "";
  return apiFetch(`/api/admin/markets/disputes${suffix}`);
}

export function adminResolveMarket(
  marketId: string,
  body: AdminResolveMarketRequest,
): Promise<AdminResolveMarketResponse> {
  return apiFetch(`/api/admin/markets/${marketId}/resolve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function backrollMarket(
  marketId: string,
  body: BackrollRequest,
): Promise<BackrollResponse> {
  return apiFetch(`/api/admin/markets/${marketId}/backroll`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Notifications  –  /api/notifications
// ---------------------------------------------------------------------------

export function listNotifications(params?: {
  limit?: number;
  offset?: number;
}): Promise<NotificationResponse[]> {
  const sp = new URLSearchParams();
  if (params?.limit != null) sp.set("limit", String(params.limit));
  if (params?.offset != null) sp.set("offset", String(params.offset));
  const qs = sp.toString();
  return apiFetch(`/api/notifications${qs ? `?${qs}` : ""}`);
}

export function getUnreadNotificationCount(): Promise<{ count: number }> {
  return apiFetch("/api/notifications/unread-count");
}

export function markNotificationsRead(): Promise<{ status: string }> {
  return apiFetch("/api/notifications/read", { method: "POST" });
}

export function markNotificationRead(
  notificationId: string,
): Promise<{ status: string }> {
  return apiFetch(`/api/notifications/${notificationId}/read`, {
    method: "POST",
  });
}

export function deleteNotification(
  notificationId: string,
): Promise<{ status: string }> {
  return apiFetch(`/api/notifications/${notificationId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Rewards  –  /api/rewards
// ---------------------------------------------------------------------------

export function getUserRewards(): Promise<RewardsResponse> {
  return apiFetch("/api/rewards");
}

export function getUserBadges(userId: string): Promise<UserBadge[]> {
  return apiFetch(`/api/rewards/badges/${userId}`);
}

export function checkBadges(): Promise<{ new_badges: unknown[] }> {
  return apiFetch("/api/rewards/check", { method: "POST" });
}
