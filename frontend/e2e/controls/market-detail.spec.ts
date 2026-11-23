// AUTHZ_MATRIX.md §6a: controls on /markets/[id], per role, overlay and state.
// "anon" is the signed-out browser (the demo shell); the matrix gives anon and
// demo one column. Overlays come from real rows: creator_id, bets placed
// through the API, a backroll refund, a filed concern or a cast vote.
//
// Every test first waits for a note that only renders once the page knows the
// viewer and market state, so a `hidden` assertion cannot pass early. Paired
// API calls (§6d) check that a permission-hidden control's action is also
// rejected by the server.

import type { Locator, Page } from "@playwright/test";
import type { Caller, Role } from "../fixtures";
import {
  expect,
  type MarketSetup,
  type MarketState,
  OPTION_LABELS,
  type StatedMarket,
  test,
} from "./market-states";
import { type ControlCell, describeControl, expectCell } from "./matrix";

interface Case {
  viewer: Caller;
  /** Overlay label for the test title, e.g. "creator", "bettor". */
  overlay?: string;
  state: MarketState;
  setup?: MarketSetup;
  expected: ControlCell;
  /** Text that proves the page has loaded this viewer's view of this state. */
  marker: string | RegExp;
  /** §6d: the API call behind the control, and the status it must get. */
  api?: {
    method: string;
    path: string;
    body?: unknown | ((market: StatedMarket) => unknown);
    status: number;
  };
}

const NOTES = {
  signInToBet: "Sign in with your CMU email address to place a bet.",
  creatorCannotBet:
    "As the market creator, you cannot place bets on this market.",
  closed:
    "This market is pending review from the market creator and no longer accepting bets.",
  resolved: "This market has been resolved.",
  balance: "Your balance:",
  chooseResolution: "Choose Resolution Path",
  proposed: "Provide a short explanation if you want to dispute the",
  signInToDispute:
    "Sign in with your CMU email address to dispute this outcome.",
  creatorCannotDispute: "You proposed this outcome, so you cannot dispute it.",
  submittedConcerns: "Submitted Concerns",
  creatorCannotAddConcern:
    "You proposed this outcome, so you cannot add a concern.",
  alreadySubmitted:
    "You have already submitted a concern. It cannot be edited.",
  signInToVote: "Sign in with your CMU email address to vote.",
  canVote: "Cast your vote on the final outcome.",
  votedYes: "You voted YES.",
  creatorCannotVote:
    "You created this market, so you cannot vote on its dispute.",
  bettorCannotVote:
    "You bet on this market, so you cannot vote on its dispute.",
  community: "Community Resolution",
  creatorCommunity: "As the market creator, you propose a resolution via",
  communityVotedYes: "You voted YES",
  adminReview:
    "This market is awaiting a final decision from an admin and no longer accepting bets.",
};

function title(c: Case) {
  const who = c.overlay ? `${c.viewer}+${c.overlay}` : c.viewer;
  const state = c.setup?.multichoice ? `multichoice ${c.state}` : c.state;
  return `${who} on ${state} market → ${c.expected}`;
}

async function openAs(
  page: Page,
  signInAs: (role: Role) => Promise<void>,
  viewer: Caller,
  market: StatedMarket,
  marker: string | RegExp,
) {
  if (viewer !== "anon") await signInAs(viewer);
  await page.goto(`/markets/${market.id}`);
  await expect(page.getByRole("heading", { name: market.title })).toBeVisible();
  await expect(page.getByText(marker).first()).toBeVisible();
}

/** One test per case: build the market, open it as the viewer, check the cell. */
function controlCases(
  cases: Case[],
  controls: (page: Page, market: StatedMarket) => Locator[],
) {
  for (const c of cases) {
    test(title(c), async ({ page, signInAs, marketIn, apiAs }) => {
      const market = await marketIn(c.state, c.setup);
      await openAs(page, signInAs, c.viewer, market, c.marker);
      await expectCell(c.expected, ...controls(page, market));
      if (c.api) {
        const path = c.api.path.replace(":id", market.id);
        const body =
          typeof c.api.body === "function" ? c.api.body(market) : c.api.body;
        const result = await apiAs(c.viewer, c.api.method, path, body);
        expect(result.status, `${c.api.method} ${path}`).toBe(c.api.status);
      }
    });
  }
}

const button = (page: Page, name: string | RegExp) =>
  page.getByRole("button", { name, exact: typeof name === "string" });

const BET = {
  method: "POST",
  path: "/api/markets/:id/bets",
  body: { side: "YES", amount: 1 },
};

describeControl("6a", "Place Bet (binary YES/NO)", () => {
  controlCases(
    [
      {
        viewer: "anon",
        state: "open",
        expected: "hidden",
        marker: NOTES.signInToBet,
        api: { ...BET, status: 401 },
      },
      {
        viewer: "user",
        state: "open",
        expected: "visible",
        marker: NOTES.balance,
      },
      {
        viewer: "user",
        state: "closed",
        expected: "hidden",
        marker: NOTES.closed,
        api: { ...BET, status: 409 },
      },
      {
        viewer: "user",
        state: "resolved",
        expected: "hidden",
        marker: NOTES.resolved,
      },
      {
        viewer: "user",
        overlay: "creator",
        state: "open",
        setup: { creator: "user" },
        expected: "hidden",
        marker: NOTES.creatorCannotBet,
        api: { ...BET, status: 403 },
      },
      {
        viewer: "user",
        overlay: "bettor",
        state: "open",
        setup: { bettors: ["user"] },
        expected: "visible",
        marker: NOTES.balance,
      },
      {
        viewer: "user",
        overlay: "bettor",
        state: "closed",
        setup: { bettors: ["user"] },
        expected: "hidden",
        marker: NOTES.closed,
      },
      {
        viewer: "admin",
        state: "open",
        setup: { creator: "super_admin" },
        expected: "visible",
        marker: NOTES.balance,
      },
      {
        viewer: "admin",
        overlay: "creator",
        state: "open",
        expected: "hidden",
        marker: NOTES.creatorCannotBet,
        api: { ...BET, status: 403 },
      },
      {
        viewer: "super_admin",
        state: "open",
        expected: "visible",
        marker: NOTES.balance,
      },
      {
        viewer: "super_admin",
        overlay: "creator",
        state: "open",
        setup: { creator: "super_admin" },
        expected: "hidden",
        marker: NOTES.creatorCannotBet,
      },
    ],
    (page) => [button(page, /^Yes \d+%$/), button(page, /^No \d+%$/)],
  );
});

describeControl("6a", "Place Bet (multichoice)", () => {
  const multichoice = (extra: MarketSetup = {}): MarketSetup => ({
    multichoice: true,
    ...extra,
  });
  const optionButtons = (page: Page) =>
    OPTION_LABELS.map((label) => button(page, new RegExp(`^${label}\\b`)));

  controlCases(
    [
      {
        viewer: "anon",
        state: "open",
        setup: multichoice(),
        expected: "hidden",
        marker: NOTES.signInToBet,
      },
      {
        viewer: "user",
        overlay: "creator",
        state: "open",
        setup: multichoice({ creator: "user" }),
        expected: "hidden",
        marker: NOTES.creatorCannotBet,
        api: {
          method: "POST",
          path: "/api/markets/:id/bets/option",
          body: (market: StatedMarket) => ({
            option_id: market.optionIds[0],
            amount: 1,
          }),
          status: 403,
        },
      },
      {
        viewer: "user",
        state: "closed",
        setup: multichoice(),
        expected: "hidden",
        marker: NOTES.closed,
      },
    ],
    optionButtons,
  );

  // Visible cells: the options are choices; Confirm Bet appears once one is selected.
  const visibleCases: Case[] = [
    {
      viewer: "user",
      state: "open",
      setup: multichoice(),
      expected: "visible",
      marker: NOTES.balance,
    },
    {
      viewer: "user",
      overlay: "bettor",
      state: "open",
      setup: multichoice({ bettors: ["user"] }),
      expected: "visible",
      marker: NOTES.balance,
    },
    {
      viewer: "admin",
      state: "open",
      setup: multichoice({ creator: "super_admin" }),
      expected: "visible",
      marker: NOTES.balance,
    },
    {
      viewer: "super_admin",
      state: "open",
      setup: multichoice(),
      expected: "visible",
      marker: NOTES.balance,
    },
  ];
  for (const c of visibleCases) {
    test(`${title(c)} once an option is selected`, async ({
      page,
      signInAs,
      marketIn,
    }) => {
      const market = await marketIn(c.state, c.setup);
      await openAs(page, signInAs, c.viewer, market, c.marker);
      const confirm = button(page, "Confirm Bet");
      await expectCell("visible", ...optionButtons(page));
      await expectCell("hidden", confirm);
      // A click before hydration is lost; the option toggles, so click only
      // while nothing is selected.
      await expect(async () => {
        if (!(await confirm.isVisible())) await optionButtons(page)[1].click();
        await expect(confirm).toBeVisible({ timeout: 1_000 });
      }).toPass();
      await expectCell("visible", confirm);
    });
  }
});

const RESOLVE = {
  method: "POST",
  path: "/api/markets/:id/resolve",
  body: { outcome: "YES" },
};

describeControl("6a", "Propose Resolution (YES / NO)", () => {
  controlCases(
    [
      {
        viewer: "anon",
        state: "closed",
        expected: "hidden",
        marker: NOTES.closed,
        api: { ...RESOLVE, status: 401 },
      },
      {
        viewer: "user",
        state: "closed",
        expected: "hidden",
        marker: NOTES.closed,
        api: { ...RESOLVE, status: 403 },
      },
      {
        viewer: "user",
        overlay: "creator",
        state: "closed",
        setup: { creator: "user" },
        expected: "visible",
        marker: NOTES.chooseResolution,
      },
      {
        viewer: "user",
        overlay: "creator",
        state: "open",
        setup: { creator: "user" },
        expected: "hidden",
        marker: NOTES.creatorCannotBet,
      },
      {
        viewer: "user",
        overlay: "creator",
        state: "proposed",
        setup: { creator: "user" },
        expected: "hidden",
        marker: NOTES.creatorCannotDispute,
      },
      {
        viewer: "user",
        overlay: "bettor",
        state: "closed",
        setup: { bettors: ["user"] },
        expected: "hidden",
        marker: NOTES.closed,
      },
      {
        // Admin status does not grant creator actions on someone else's market.
        viewer: "admin",
        state: "closed",
        setup: { creator: "super_admin" },
        expected: "hidden",
        marker: NOTES.closed,
        api: { ...RESOLVE, status: 403 },
      },
      {
        viewer: "admin",
        overlay: "creator",
        state: "closed",
        expected: "visible",
        marker: NOTES.chooseResolution,
      },
      {
        viewer: "super_admin",
        state: "closed",
        expected: "hidden",
        marker: NOTES.closed,
      },
      {
        viewer: "super_admin",
        overlay: "creator",
        state: "closed",
        setup: { creator: "super_admin" },
        expected: "visible",
        marker: NOTES.chooseResolution,
      },
    ],
    (page) => [button(page, "Resolve YES"), button(page, "Resolve NO")],
  );
});

const COMMUNITY_START = {
  method: "POST",
  path: "/api/markets/:id/community-resolution",
};

describeControl("6a", "Start Community Resolution", () => {
  controlCases(
    [
      {
        viewer: "anon",
        state: "closed",
        expected: "hidden",
        marker: NOTES.closed,
      },
      {
        viewer: "user",
        state: "closed",
        expected: "hidden",
        marker: NOTES.closed,
        api: { ...COMMUNITY_START, status: 403 },
      },
      {
        viewer: "user",
        overlay: "creator",
        state: "closed",
        setup: { creator: "user" },
        expected: "visible",
        marker: NOTES.chooseResolution,
      },
      {
        viewer: "user",
        overlay: "creator",
        state: "proposed",
        setup: { creator: "user" },
        expected: "hidden",
        marker: NOTES.creatorCannotDispute,
      },
      {
        viewer: "user",
        overlay: "bettor",
        state: "closed",
        setup: { bettors: ["user"] },
        expected: "hidden",
        marker: NOTES.closed,
      },
      {
        viewer: "admin",
        state: "closed",
        setup: { creator: "super_admin" },
        expected: "hidden",
        marker: NOTES.closed,
        api: { ...COMMUNITY_START, status: 403 },
      },
      {
        viewer: "admin",
        overlay: "creator",
        state: "closed",
        expected: "visible",
        marker: NOTES.chooseResolution,
      },
      {
        viewer: "super_admin",
        overlay: "creator",
        state: "closed",
        setup: { creator: "super_admin" },
        expected: "visible",
        marker: NOTES.chooseResolution,
      },
    ],
    (page) => [button(page, "Start Community Resolution (24h)")],
  );
});

const DISPUTE = {
  method: "POST",
  path: "/api/markets/:id/dispute",
  body: { explanation: "Paired API check from the control tests." },
};

describeControl("6a", "Submit Dispute / Concern", () => {
  // While the creator's proposal is in its dispute window: "Submit Dispute".
  controlCases(
    [
      {
        viewer: "anon",
        state: "proposed",
        expected: "hidden",
        marker: NOTES.signInToDispute,
        api: { ...DISPUTE, status: 401 },
      },
      {
        viewer: "user",
        state: "closed",
        expected: "hidden",
        marker: NOTES.closed,
      },
      {
        viewer: "user",
        state: "proposed",
        expected: "visible",
        marker: NOTES.proposed,
      },
      {
        viewer: "user",
        overlay: "creator",
        state: "proposed",
        setup: { creator: "user" },
        expected: "hidden",
        marker: NOTES.creatorCannotDispute,
        api: { ...DISPUTE, status: 403 },
      },
      {
        viewer: "user",
        overlay: "bettor",
        state: "proposed",
        setup: { bettors: ["user"] },
        expected: "visible",
        marker: NOTES.proposed,
      },
      {
        viewer: "user",
        overlay: "refunded bettor",
        state: "proposed",
        setup: { refunded: ["user"] },
        expected: "visible",
        marker: NOTES.proposed,
      },
      {
        viewer: "admin",
        state: "proposed",
        setup: { creator: "super_admin" },
        expected: "visible",
        marker: NOTES.proposed,
      },
      {
        viewer: "admin",
        overlay: "creator",
        state: "proposed",
        expected: "hidden",
        marker: NOTES.creatorCannotDispute,
        api: { ...DISPUTE, status: 403 },
      },
    ],
    (page) => [button(page, "Submit Dispute")],
  );

  // Once a case is open, others add to it with "Submit Concern" until voting ends.
  controlCases(
    [
      {
        viewer: "anon",
        state: "disputed",
        setup: { disputer: "super_admin" },
        expected: "hidden",
        marker: "Sign in with your CMU email address to submit a concern.",
      },
      {
        viewer: "user",
        state: "disputed",
        setup: { disputer: "super_admin" },
        expected: "visible",
        marker: NOTES.submittedConcerns,
      },
      {
        viewer: "user",
        overlay: "submitter",
        state: "disputed",
        setup: { disputer: "user" },
        expected: "hidden",
        marker: NOTES.alreadySubmitted,
        api: { ...DISPUTE, status: 409 },
      },
      {
        viewer: "user",
        overlay: "creator",
        state: "disputed",
        setup: { creator: "user", disputer: "admin" },
        expected: "hidden",
        marker: NOTES.creatorCannotAddConcern,
        api: { ...DISPUTE, status: 403 },
      },
      {
        viewer: "user",
        overlay: "bettor",
        state: "disputed",
        setup: { bettors: ["user"], disputer: "super_admin" },
        expected: "visible",
        marker: NOTES.submittedConcerns,
      },
      {
        viewer: "super_admin",
        state: "disputed",
        setup: { disputer: "user" },
        expected: "visible",
        marker: NOTES.submittedConcerns,
      },
    ],
    (page) => [button(page, "Submit Concern")],
  );
});

const DISPUTE_VOTE = {
  method: "POST",
  path: "/api/markets/:id/dispute/vote",
  body: { vote: "NO" },
};

describeControl("6a", "Cast Dispute Vote (YES / NO)", () => {
  controlCases(
    [
      {
        viewer: "anon",
        state: "disputed",
        setup: { disputer: "super_admin" },
        expected: "hidden",
        marker: NOTES.signInToVote,
        api: { ...DISPUTE_VOTE, status: 401 },
      },
      {
        viewer: "user",
        state: "disputed",
        setup: { disputer: "super_admin" },
        expected: "visible",
        marker: NOTES.canVote,
      },
      {
        // Filing a concern neither grants nor removes a vote.
        viewer: "user",
        overlay: "submitter",
        state: "disputed",
        setup: { disputer: "user" },
        expected: "visible",
        marker: NOTES.canVote,
      },
      {
        viewer: "user",
        overlay: "dispute-voter",
        state: "disputed",
        setup: { disputer: "super_admin", disputeVoters: ["user"] },
        expected: "disabled",
        marker: NOTES.votedYes,
        api: { ...DISPUTE_VOTE, status: 409 },
      },
      {
        viewer: "user",
        overlay: "creator",
        state: "disputed",
        setup: { creator: "user", disputer: "admin" },
        expected: "disabled",
        marker: NOTES.creatorCannotVote,
        api: { ...DISPUTE_VOTE, status: 403 },
      },
      {
        viewer: "user",
        overlay: "bettor",
        state: "disputed",
        setup: { bettors: ["user"], disputer: "super_admin" },
        expected: "disabled",
        marker: NOTES.bettorCannotVote,
        api: { ...DISPUTE_VOTE, status: 403 },
      },
      {
        viewer: "user",
        overlay: "refunded bettor",
        state: "disputed",
        setup: { refunded: ["user"], disputer: "super_admin" },
        expected: "disabled",
        marker: NOTES.bettorCannotVote,
        api: { ...DISPUTE_VOTE, status: 403 },
      },
      {
        viewer: "admin",
        state: "disputed",
        setup: { creator: "super_admin", disputer: "user" },
        expected: "visible",
        marker: NOTES.canVote,
      },
      {
        viewer: "admin",
        overlay: "bettor",
        state: "disputed",
        setup: { creator: "super_admin", bettors: ["admin"], disputer: "user" },
        expected: "disabled",
        marker: NOTES.bettorCannotVote,
      },
      {
        viewer: "admin",
        overlay: "creator",
        state: "disputed",
        setup: { disputer: "user" },
        expected: "disabled",
        marker: NOTES.creatorCannotVote,
      },
      {
        viewer: "super_admin",
        state: "disputed",
        setup: { disputer: "user" },
        expected: "visible",
        marker: NOTES.canVote,
      },
    ],
    (page) => [button(page, "Vote YES"), button(page, "Vote NO")],
  );
});

const COMMUNITY_VOTE = {
  method: "POST",
  path: "/api/markets/:id/community-vote",
  body: { vote: "NO" },
};

describeControl("6a", "Cast Community Vote (YES / NO)", () => {
  controlCases(
    [
      {
        viewer: "anon",
        state: "community",
        expected: "hidden",
        marker: NOTES.signInToVote,
        api: { ...COMMUNITY_VOTE, status: 401 },
      },
      {
        viewer: "user",
        state: "community",
        expected: "visible",
        marker: NOTES.community,
      },
      {
        viewer: "user",
        overlay: "creator",
        state: "community",
        setup: { creator: "user" },
        expected: "hidden",
        marker: NOTES.creatorCommunity,
        api: { ...COMMUNITY_VOTE, status: 403 },
      },
      {
        viewer: "user",
        overlay: "community-voter",
        state: "community",
        setup: { communityVoters: ["user"] },
        expected: "hidden",
        marker: NOTES.communityVotedYes,
        api: { ...COMMUNITY_VOTE, status: 409 },
      },
      {
        viewer: "user",
        overlay: "bettor",
        state: "community",
        setup: { bettors: ["user"] },
        expected: "visible",
        marker: NOTES.community,
      },
      {
        viewer: "admin",
        state: "community",
        setup: { creator: "super_admin" },
        expected: "visible",
        marker: NOTES.community,
      },
      {
        viewer: "admin",
        overlay: "creator",
        state: "community",
        expected: "hidden",
        marker: NOTES.creatorCommunity,
      },
      {
        viewer: "super_admin",
        state: "community",
        expected: "visible",
        marker: NOTES.community,
      },
    ],
    (page) => [button(page, "Vote YES"), button(page, "Vote NO")],
  );
});

const BACKROLL = {
  method: "POST",
  path: "/api/admin/markets/:id/backroll",
  body: { cutoff_date: new Date(0).toISOString(), close_market: false },
};

describeControl("6a", "Backroll Panel", () => {
  controlCases(
    [
      {
        viewer: "anon",
        state: "open",
        expected: "hidden",
        marker: NOTES.signInToBet,
        api: { ...BACKROLL, status: 401 },
      },
      {
        viewer: "user",
        state: "open",
        expected: "hidden",
        marker: NOTES.balance,
        api: { ...BACKROLL, status: 403 },
      },
      {
        viewer: "user",
        overlay: "creator",
        state: "closed",
        setup: { creator: "user" },
        expected: "hidden",
        marker: NOTES.chooseResolution,
      },
      {
        viewer: "admin",
        state: "resolved",
        expected: "hidden",
        marker: NOTES.resolved,
        api: { ...BACKROLL, status: 400 },
      },
      {
        viewer: "super_admin",
        state: "resolved",
        expected: "hidden",
        marker: NOTES.resolved,
      },
    ],
    (page) => [page.getByText("Admin Backroll", { exact: true })],
  );

  const visibleCases: Case[] = [
    {
      viewer: "admin",
      state: "open",
      setup: { creator: "super_admin" },
      expected: "visible",
      marker: NOTES.balance,
    },
    {
      viewer: "admin",
      state: "disputed",
      setup: { creator: "super_admin", disputer: "user" },
      expected: "visible",
      marker: NOTES.submittedConcerns,
    },
    {
      viewer: "admin",
      state: "admin_review",
      expected: "visible",
      marker: NOTES.adminReview,
    },
    {
      viewer: "super_admin",
      state: "open",
      expected: "visible",
      marker: NOTES.balance,
    },
  ];
  for (const c of visibleCases) {
    test(title(c), async ({ page, signInAs, marketIn }) => {
      const market = await marketIn(c.state, c.setup);
      await openAs(page, signInAs, c.viewer, market, c.marker);
      await expect(
        page.getByText("Admin Backroll", { exact: true }),
      ).toBeVisible();
      // Execute stays disabled until a cutoff is chosen; it is not clicked.
      const execute = button(page, "Execute Backroll");
      await expectCell("disabled", execute);
      // An input filled before hydration loses the change, so retry until it
      // sticks; clearing first makes each retry a real change for React.
      const cutoff = page.getByLabel("Cutoff Date/Time");
      await expect(async () => {
        await cutoff.fill("");
        await cutoff.fill("2026-01-01T12:00");
        await expect(execute).toBeEnabled({ timeout: 1_000 });
      }).toPass();
    });
  }
});

describeControl(
  "6a",
  "Admin Resolve banner (when M.status='admin_review')",
  () => {
    const banner = (page: Page) =>
      page.getByRole("link", {
        name: "Make the final call in Resolve Markets",
      });
    const bannerControls = (page: Page) => [banner(page)];

    controlCases(
      [
        {
          viewer: "anon",
          state: "admin_review",
          expected: "hidden",
          marker: NOTES.adminReview,
        },
        {
          viewer: "user",
          state: "admin_review",
          expected: "hidden",
          marker: NOTES.adminReview,
        },
        {
          viewer: "user",
          overlay: "creator",
          state: "admin_review",
          setup: { creator: "user" },
          expected: "hidden",
          marker: NOTES.adminReview,
        },
        {
          viewer: "admin",
          state: "disputed",
          setup: { creator: "super_admin", disputer: "user" },
          expected: "hidden",
          marker: NOTES.submittedConcerns,
        },
      ],
      bannerControls,
    );

    for (const viewer of ["admin", "super_admin"] as const) {
      test(`${viewer} on admin_review market → visible link to the queue`, async ({
        page,
        signInAs,
        marketIn,
      }) => {
        const market = await marketIn("admin_review", { creator: "user" });
        await openAs(page, signInAs, viewer, market, NOTES.adminReview);
        await expect(banner(page)).toBeVisible();
        await expect(banner(page)).toHaveAttribute(
          "href",
          `/admin/resolve#resolve-${market.id}`,
        );
      });
    }
  },
);
