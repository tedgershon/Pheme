// apiFetch's handling of a 401 to a signed-in request (#86): refresh once and
// retry, then end the local session and send the user to sign in.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    refreshSession: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("../supabase", () => ({ supabase: { auth } }));

const fetchMock = vi.fn();
const assign = vi.fn();

const unauthorized = () =>
  new Response(
    JSON.stringify({
      detail: { code: "UNAUTHORIZED", message: "Invalid or expired token." },
    }),
    { status: 401 },
  );
const ok = () => new Response(JSON.stringify({ id: "me" }), { status: 200 });

function session(token: string | null) {
  return { data: { session: token ? { access_token: token } : null } };
}

/** Bearer tokens sent, in order. */
function sentTokens() {
  return fetchMock.mock.calls.map(
    ([, init]) =>
      (init?.headers as Record<string, string> | undefined)?.Authorization ??
      null,
  );
}

// A fresh module per test: the refresh and sign-out guards are module state.
async function loadApi() {
  vi.resetModules();
  return import("../api");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: { pathname: "/portfolio", assign } });
  auth.getSession.mockResolvedValue(session("stale-token"));
  auth.refreshSession.mockResolvedValue(session("fresh-token"));
  auth.signOut.mockResolvedValue({ error: null });
});

afterEach(() => vi.unstubAllGlobals());

describe("a 401 to a signed-in request", () => {
  it("refreshes once and retries with the new token", async () => {
    const { getMe } = await loadApi();
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok());

    await expect(getMe()).resolves.toEqual({ id: "me" });

    expect(sentTokens()).toEqual(["Bearer stale-token", "Bearer fresh-token"]);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("ends the local session and returns the user through sign-in when the retry is rejected", async () => {
    const { getMe, ApiError } = await loadApi();
    fetchMock.mockImplementation(async () => unauthorized());

    const error = await getMe().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(assign).toHaveBeenCalledWith(
      "/sign-in?next=%2Fportfolio&reason=session_expired",
    );
  });

  it.each([
    [
      "returns an error",
      () => ({ data: { session: null }, error: new Error("revoked") }),
    ],
    ["throws", () => Promise.reject(new Error("network"))],
  ])(
    "ends the session without a retry when the refresh %s",
    async (_case, refresh) => {
      const { getMe } = await loadApi();
      auth.refreshSession.mockImplementation(refresh);
      fetchMock.mockImplementation(async () => unauthorized());

      await expect(getMe()).rejects.toMatchObject({ status: 401 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(assign).toHaveBeenCalledTimes(1);
    },
  );

  it("still redirects when the local sign-out fails", async () => {
    const { getMe } = await loadApi();
    auth.signOut.mockRejectedValue(new Error("storage unavailable"));
    fetchMock.mockImplementation(async () => unauthorized());

    await expect(getMe()).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("refreshes and redirects once for concurrent 401s", async () => {
    const { getMe } = await loadApi();
    let release: () => void = () => {};
    auth.refreshSession.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(session("fresh-token"));
      }),
    );
    fetchMock.mockImplementation(async () => unauthorized());

    const calls = [getMe(), getMe(), getMe()].map((p) => p.catch(() => null));
    await vi.waitFor(() => expect(auth.refreshSession).toHaveBeenCalled());
    release();
    await Promise.all(calls);

    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);

    // Once the session has ended, later 401s neither refresh nor redirect.
    await getMe().catch(() => null);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
  });
});

describe("requests without a token", () => {
  it("leave an anonymous 401 to the caller: no refresh, no redirect", async () => {
    const { getMe } = await loadApi();
    auth.getSession.mockResolvedValue(session(null));
    fetchMock.mockResolvedValue(unauthorized());

    await expect(getMe()).rejects.toMatchObject({ status: 401 });

    expect(sentTokens()).toEqual([null]);
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("leave other failures alone", async () => {
    const { getMe } = await loadApi();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { code: "FORBIDDEN", message: "No." } }),
        { status: 403 },
      ),
    );

    await expect(getMe()).rejects.toMatchObject({ status: 403 });
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
