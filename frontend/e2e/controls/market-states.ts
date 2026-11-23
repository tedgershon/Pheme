// Builds a market in a given lifecycle state for the control tests. Setup
// shortcuts that have no user-facing API (closing, resolving, escalating) are
// direct service-role writes; everything a user or admin does (bets, backroll,
// proposals, concerns, votes) goes through the API, so overlays such as
// "bettor", "submitter" and "voter" come from real rows.

import {
  type ApiResult,
  test as base,
  type Caller,
  type Role,
  type SeededMarket,
} from "../fixtures";
import { serviceClient } from "../support/supabase";

export type MarketState =
  | "open"
  | "closed"
  | "resolved"
  /** pending_resolution with the creator's YES proposal and an active dispute window */
  | "proposed"
  | "disputed"
  /** pending_resolution in a 24-hour community vote */
  | "community"
  | "admin_review";

export interface MarketSetup {
  /** Default: admin. */
  creator?: Role;
  /** An exclusive multichoice market with options Alpha, Beta and Gamma. */
  multichoice?: boolean;
  /** Bet while the market is open; their bets stay active. */
  bettors?: Role[];
  /** Bet while open, then refunded by an admin backroll, which closes the market. */
  refunded?: Role[];
  /** Files the concern that opens the case. Required for "disputed". */
  disputer?: Role;
  /** Vote YES on the dispute ("disputed" only). */
  disputeVoters?: Role[];
  /** Vote YES in the community vote ("community" only). */
  communityVoters?: Role[];
}

export const OPTION_LABELS = ["Alpha", "Beta", "Gamma"];

export interface StatedMarket extends SeededMarket {
  /** Option IDs in OPTION_LABELS order (multichoice only). */
  optionIds: string[];
}

async function update(market: SeededMarket, fields: Record<string, unknown>) {
  const { error } = await serviceClient()
    .from("markets")
    .update(fields)
    .eq("id", market.id);
  if (error) throw new Error(`Market update failed: ${error.message}`);
}

export const test = base.extend<{
  marketIn: (state: MarketState, setup?: MarketSetup) => Promise<StatedMarket>;
}>({
  marketIn: async ({ seedMarket, apiAs }, use) => {
    async function call(
      caller: Caller,
      method: string,
      path: string,
      body?: unknown,
    ): Promise<ApiResult> {
      const result = await apiAs(caller, method, path, body);
      if (result.status >= 300) {
        throw new Error(
          `Setup call ${caller} ${method} ${path} failed: HTTP ${result.status} ${JSON.stringify(result.body)}`,
        );
      }
      return result;
    }

    await use(async (state, setup = {}) => {
      const creator = setup.creator ?? "admin";
      const market = await seedMarket({
        creatorRole: creator,
        ...(setup.multichoice
          ? { market_type: "multichoice", multichoice_type: "exclusive" }
          : {}),
      });
      const marketPath = `/api/markets/${market.id}`;

      let optionIds: string[] = [];
      if (setup.multichoice) {
        const { data, error } = await serviceClient()
          .from("market_options")
          .insert(
            OPTION_LABELS.map((label, sort_order) => ({
              market_id: market.id,
              label,
              sort_order,
            })),
          )
          .select("id");
        if (error) throw new Error(`Option insert failed: ${error.message}`);
        optionIds = data.map((row) => row.id);
      }

      async function bet(role: Role) {
        if (setup.multichoice) {
          await call(role, "POST", `${marketPath}/bets/option`, {
            option_id: optionIds[0],
            amount: 10,
          });
        } else {
          await call(role, "POST", `${marketPath}/bets`, {
            side: "YES",
            amount: 10,
          });
        }
      }

      for (const role of setup.bettors ?? []) await bet(role);

      let closed = false;
      if (setup.refunded?.length) {
        if (state === "open") {
          throw new Error("Refunded bettors need a state past open");
        }
        // Backroll refunds bets placed after the cutoff; active bets are older.
        const { data: latest } = await serviceClient()
          .from("bets")
          .select("created_at")
          .eq("market_id", market.id)
          .order("created_at", { ascending: false })
          .limit(1);
        const cutoff = latest?.[0]?.created_at ?? market.created_at;
        for (const role of setup.refunded) await bet(role);
        await call(
          "super_admin",
          "POST",
          `/api/admin/markets/${market.id}/backroll`,
          {
            cutoff_date: cutoff,
            close_market: true,
          },
        );
        closed = true;
      }

      if (state !== "open" && !closed) {
        await update(market, {
          status: "closed",
          close_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        });
      }

      switch (state) {
        case "resolved":
          await update(market, {
            status: "resolved",
            resolved_outcome: "YES",
            resolved_at: new Date().toISOString(),
          });
          break;
        case "proposed":
        case "disputed":
          await call(creator, "POST", `${marketPath}/resolve`, {
            outcome: "YES",
          });
          if (state === "disputed") {
            if (!setup.disputer)
              throw new Error("A disputed market needs a disputer");
            await call(setup.disputer, "POST", `${marketPath}/dispute`, {
              explanation: "Seeded concern from the control tests.",
            });
            for (const role of setup.disputeVoters ?? []) {
              await call(role, "POST", `${marketPath}/dispute/vote`, {
                vote: "YES",
              });
            }
          }
          break;
        case "community":
          await call(creator, "POST", `${marketPath}/community-resolution`);
          for (const role of setup.communityVoters ?? []) {
            await call(role, "POST", `${marketPath}/community-vote`, {
              vote: "YES",
            });
          }
          break;
        case "admin_review":
          await update(market, { status: "admin_review" });
          break;
      }
      return { ...market, optionIds };
    });
  },
});

export { expect } from "../fixtures";
