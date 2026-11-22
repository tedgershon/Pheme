// Browser-test fixtures. Import `test` and `expect` from here instead of
// @playwright/test. Every write goes to the local Supabase stack; markets are
// deleted and fixture balances restored after each test.

import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import { ROLE_IDS, type Role } from "./support/local-stack";
import {
  type FixtureSession,
  serviceClient,
  sessionIsValid,
  signInSession,
} from "./support/supabase";

export { expect };
export type { Role };

export interface SeededMarket {
  id: string;
  title: string;
  status: string;
  creator_id: string;
  [column: string]: unknown;
}

export type SeedMarketOptions = {
  status?: string;
  creatorRole?: Role;
} & Record<string, unknown>;

export interface SeedBetOptions {
  role: Role;
  side: "YES" | "NO";
  amount?: number;
}

// Tables whose rows reference a market, deleted child-first before it.
// Settled community markets also have a receipt in private.community_settlements,
// which the service role cannot delete; tests that settle that way need their
// own cleanup.
const MARKET_CHILD_TABLES = [
  "dispute_submissions",
  "resolution_votes",
  "community_votes",
  "disputes",
  "bets",
  "transactions",
  "notifications",
];

/** Reuses one Auth session per role per worker to stay under the sign-in rate limit. */
class SessionCache {
  private sessions = new Map<Role, FixtureSession>();

  async get(role: Role): Promise<FixtureSession> {
    const cached = this.sessions.get(role);
    // App sign-out revokes the session; sign in again when that happened.
    if (cached && (await sessionIsValid(cached.accessToken))) return cached;
    const session = await signInSession(role);
    this.sessions.set(role, session);
    return session;
  }
}

/** Rows one test created and the balances to put back afterwards. */
class TestData {
  readonly marketIds: string[] = [];
  private balances = new Map<string, number>();

  async snapshot() {
    const { data, error } = await serviceClient()
      .from("profiles")
      .select("id, banana_balance")
      .in("id", Object.values(ROLE_IDS));
    if (error) throw new Error(`Could not read balances: ${error.message}`);
    for (const row of data)
      this.balances.set(row.id, Number(row.banana_balance));
  }

  async cleanup() {
    const db = serviceClient();
    const failures: string[] = [];
    if (this.marketIds.length) {
      for (const table of MARKET_CHILD_TABLES) {
        const { error } = await db
          .from(table)
          .delete()
          .in("market_id", this.marketIds);
        if (error) failures.push(`${table}: ${error.message}`);
      }
      const { error } = await db
        .from("markets")
        .delete()
        .in("id", this.marketIds);
      if (error) failures.push(`markets: ${error.message}`);
    }
    const { data, error } = await db
      .from("profiles")
      .select("id, banana_balance")
      .in("id", [...this.balances.keys()]);
    if (error) failures.push(`profiles: ${error.message}`);
    for (const row of data ?? []) {
      const original = this.balances.get(row.id);
      if (original === undefined || Number(row.banana_balance) === original)
        continue;
      const { error: restoreError } = await db
        .from("profiles")
        .update({ banana_balance: original })
        .eq("id", row.id);
      if (restoreError)
        failures.push(`balance ${row.id}: ${restoreError.message}`);
    }
    if (failures.length) {
      throw new Error(`Fixture cleanup failed:\n${failures.join("\n")}`);
    }
  }
}

interface Fixtures {
  /** Adds the role's session cookies to the browser context. Does not navigate. */
  signInAs: (role: Role, opts?: { creatorOf?: string }) => Promise<void>;
  /** Removes Supabase session cookies and storage from the browser context. */
  signOut: () => Promise<void>;
  /** Inserts a market (setup only). Defaults: open, created by the admin. */
  seedMarket: (opts?: SeedMarketOptions) => Promise<SeededMarket>;
  /** Places a bet through the API, i.e. the transactional place_bet path. Returns the bet ID. */
  seedBet: (market: SeededMarket, opts: SeedBetOptions) => Promise<string>;
  /** Writes a fixture profile's balance directly (setup only). */
  setBalance: (role: Role, amount: number) => Promise<void>;
  getBalance: (role: Role) => Promise<number>;
  testData: TestData;
}

interface WorkerFixtures {
  sessions: SessionCache;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  sessions: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from this pattern.
    async ({}, use) => {
      await use(new SessionCache());
    },
    { scope: "worker" },
  ],

  testData: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from this pattern.
    async ({}, use) => {
      const data = new TestData();
      await data.snapshot();
      await use(data);
      await data.cleanup();
    },
    { auto: true },
  ],

  signInAs: async ({ context, sessions, baseURL }, use) => {
    await use(async (role, _opts) => {
      // opts.creatorOf only documents the test's setup; it does not change the session.
      const { cookies } = await sessions.get(role);
      await context.clearCookies({ name: /^sb-/ });
      await context.addCookies(
        cookies.map((cookie) => ({
          ...cookie,
          url: baseURL as string,
          sameSite: "Lax" as const,
        })),
      );
    });
  },

  signOut: async ({ context }, use) => {
    await use(async () => {
      await context.clearCookies({ name: /^sb-/ });
      for (const page of context.pages()) {
        if (!page.url().startsWith("http")) continue;
        await page.evaluate(() => {
          for (const store of [localStorage, sessionStorage]) {
            for (const key of Object.keys(store)) {
              if (key.startsWith("sb-")) store.removeItem(key);
            }
          }
        });
      }
    });
  },

  seedMarket: async ({ testData }, use) => {
    await use(
      async ({ status = "open", creatorRole = "admin", ...fields } = {}) => {
        const { data, error } = await serviceClient()
          .from("markets")
          .insert({
            title: `E2E market ${randomUUID().slice(0, 8)}`,
            description: "Seeded by the browser test fixtures.",
            resolution_criteria: "Resolves according to the test's setup.",
            category: "General",
            close_at: new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            creator_id: ROLE_IDS[creatorRole],
            status,
            ...fields,
          })
          .select()
          .single();
        if (error) throw new Error(`seedMarket failed: ${error.message}`);
        testData.marketIds.push(data.id);
        return data as SeededMarket;
      },
    );
  },

  seedBet: async ({ testData, sessions }, use) => {
    await use(async (market, { role, side, amount = 10 }) => {
      if (!testData.marketIds.includes(market.id)) {
        throw new Error(
          "seedBet only bets on markets from seedMarket, so teardown can remove them",
        );
      }
      const { accessToken } = await sessions.get(role);
      const response = await fetch(
        `${process.env.E2E_API_URL}/api/markets/${market.id}/bets`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ side, amount }),
        },
      );
      if (!response.ok) {
        throw new Error(
          `seedBet failed: HTTP ${response.status} ${await response.text()}`,
        );
      }
      const body = await response.json();
      return body.bet_id as string;
    });
  },

  // The auto testData fixture restores the original balance after the test.
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from this pattern.
  setBalance: async ({}, use) => {
    await use(async (role, amount) => {
      const { error } = await serviceClient()
        .from("profiles")
        .update({ banana_balance: amount })
        .eq("id", ROLE_IDS[role]);
      if (error) throw new Error(`setBalance failed: ${error.message}`);
    });
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from this pattern.
  getBalance: async ({}, use) => {
    await use(async (role) => {
      const { data, error } = await serviceClient()
        .from("profiles")
        .select("banana_balance")
        .eq("id", ROLE_IDS[role])
        .single();
      if (error) throw new Error(`getBalance failed: ${error.message}`);
      return Number(data.banana_balance);
    });
  },
});
