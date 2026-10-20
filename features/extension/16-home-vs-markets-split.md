# Feature 16: Home vs Markets Split — Curated Dashboard at `/`, Full Browse at `/markets`

**Status:** Design ratified
**Phase:** UX hardening
**Depends on:** None (refactor-only; doesn't touch the API or auth)
**Parallelizable with:** `features/extension/12-observability.md`, `features/extension/13-backend-hardening.md`, `features/extension/17-market-creation-validation.md`, `features/extension/18-dummy-data-removal.md`
**Reads from:** `project-specs/AUTHZ_MATRIX.md` §5 (`/` and `/markets` rows — both render for all roles, with same gating)
**Branch:** `feature/home-vs-markets-split` → 2 sub-PRs (see `issues/16.*.md`)
**Execution items:** `issues/16.1-route-split.md`, `issues/16.2-curated-home-dashboard.md`

---

## Summary

Today, `frontend/src/app/page.tsx` is a one-line re-export of `markets/page.tsx`. The root route (`/`) and the markets-browse route (`/markets`) render the **identical** experience. This wastes the most valuable real estate in the app — the landing page — on a generic browse view, and forces every visitor through the same dense category-filtered grid.

This feature splits them into two distinct experiences with different goals:

- **`/` (root, "home")** — a **curated dashboard**. No category filter. No "Markets" page title. Limited counts (≤6 open markets, ≤3 markets pending resolution). **No closed markets at all.** Designed for first-impression and quick navigation.
- **`/markets`** — the **full browse**. Title "Markets". Category filter at top. All states represented (open, pending resolution, closed, resolved). The page that exists today, lifted to its own route file (no behavior change).

Same access spec for both routes per matrix §5 (`render-readonly` for anon/demo; `render` for everyone else). Same UI controls per §6a. **Pure UX shape change**, not an authorization change.

---

## Why split

- **First-time visitors** see the root URL. Today they get a category filter for content they haven't seen yet, and a wall of closed markets that look stale. A curated view gives them the "current activity" view they actually want.
- **Returning users browsing markets** want the full view (filter by Tech, see all the open ones, find what's pending resolution). That experience already exists today — moving it to `/markets` makes the URL match the intent.
- **Closed markets matter for `/markets` (history, learning) but not for `/`** (signal-to-noise — they crowd out the live activity).

---

## Layout Specification

### `/` (curated home)

```
┌─────────────────────────────────────────────────┐
│  [no page title — landing-page treatment]       │
├─────────────────────────────────────────────────┤
│  Hero / featured market (existing component)    │
├─────────────────────────────────────────────────┤
│  Open Markets                                   │
│  [grid of ≤6 market cards, no category filter]  │
├─────────────────────────────────────────────────┤
│  Pending Resolution                             │
│  [grid of ≤3 market cards]                      │
├─────────────────────────────────────────────────┤
│  [link: "Browse all markets →" → /markets]      │
└─────────────────────────────────────────────────┘
```

- **No "Markets" heading.** The page is the home page; it doesn't need to label itself.
- **No category filter.** First impressions stay clean. Filtering moves to `/markets`.
- **Caps:** `slice(0, 6)` for open, `slice(0, 3)` for pending resolution. If there are more, the "Browse all markets" link takes the user to `/markets`.
- **No closed/resolved markets.** History lives at `/markets`.
- **Same query as today** — `marketsQuery()` returns all markets; the home page client-side filters by status and slices. No new backend endpoint needed.

### `/markets` (full browse)

```
┌─────────────────────────────────────────────────┐
│  Markets                                        │
│  [page title h1]                                │
├─────────────────────────────────────────────────┤
│  [Category filter: All / Academics / Tech / …]  │
├─────────────────────────────────────────────────┤
│  Open Markets                                   │
│  [all open markets matching filter]             │
├─────────────────────────────────────────────────┤
│  Pending Resolution                             │
│  [all pending-resolution markets]               │
├─────────────────────────────────────────────────┤
│  Closed                                         │
│  [all closed markets]                           │
├─────────────────────────────────────────────────┤
│  Resolved                                       │
│  [all resolved markets]                         │
└─────────────────────────────────────────────────┘
```

- **Identical to today's page.** This route lifts the existing implementation; the only change is the URL.
- All sections, all states, full counts, category filter at top.

### Navigation

- **Top nav** keeps a "Markets" link pointing to `/markets` (today this entry points to `/`; just retarget it). The existing Pheme brand element in `frontend/src/components/navbar.tsx` (line 28) is already a `<Link href="/">` — it continues to serve as the home link. **No new "Home" entry is added.**
- **The "Browse all markets" CTA** at the bottom of `/` deep-links to `/markets`.

---

## Implementation Approach

### 16.1: Route split (no UX change)

The first PR is a pure refactor: lift the existing `markets/page.tsx` + `markets-client.tsx` so it serves at `/markets`, and replace `app/page.tsx`'s re-export with an empty stub (or temporary copy of the same content). Net effect: the experience at `/` and `/markets` is unchanged from today, but they're now separate page implementations ready for divergence in 16.2.

This step is mechanically cheap and lets the next PR focus purely on the new home design without entangling refactor diff.

### 16.2: Build the curated home

Replace the stub at `app/page.tsx` (or its server-component prefetch wrapper) with the new curated layout per the spec above. New client component (e.g., `frontend/src/app/home-client.tsx`) renders the hero + Open + Pending Resolution sections with `slice(0, 6)` and `slice(0, 3)`. Reuses `MarketCard`, `marketsQuery`, and any hero component already in use.

---

## Files Affected

| Area | File | Status |
|---|---|---|
| Frontend | `frontend/src/app/page.tsx` | MODIFY — replace `export { default } from "./markets/page"` with the new curated home (16.2). |
| Frontend | `frontend/src/app/home-client.tsx` | NEW (16.2) — curated home client component. |
| Frontend | `frontend/src/app/markets/page.tsx` | MODIFY (16.1) — confirm it serves the existing markets browse cleanly when accessed at `/markets`. (Likely no change — it already does.) |
| Frontend | `frontend/src/app/markets/markets-client.tsx` | MODIFY (16.1) — verify it still works as the `/markets` body. (Likely no change.) |
| Frontend | `frontend/src/components/navbar.tsx` | MODIFY — retarget the existing `NAV_LINKS` "Markets" entry from `/` to `/markets`. The brand element (`<Link href="/">`) is already the home link and is left untouched. |
| Spec | `project-specs/AUTHZ_MATRIX.md` §5 | MODIFY — add a one-line note distinguishing the two routes' *content* (matrix already covers their access spec; this is just clarifying the layout difference). |
| Tests | `frontend/e2e/page-gating/markets.spec.ts` | MODIFY (post-15.2) — add tests asserting the layout differences (no "Markets" heading on `/`, no closed-market section on `/`, etc.). |

---

## Execution

| Issue | Title | Depends on |
|---|---|---|
| `issues/16.1-route-split.md` | Lift `markets-client` so `/markets` serves it cleanly; stub `/` temporarily so they're separate page implementations. | — |
| `issues/16.2-curated-home-dashboard.md` | Replace the stub at `/` with the curated dashboard per spec. | 16.1 |

Both small. 16.1 is ~30 min of work; 16.2 is the design-doc translation work, ~2–3 hours.

---

## Cross-References

| Doc | Relationship |
|---|---|
| `project-specs/AUTHZ_MATRIX.md` | §5 governs access (both routes `render` for signed-in roles, `render-readonly` for anon/demo). This doc only changes *content*, not gating. |
| `features/extension/15-playwright-ui-tests.md` | §15a tests assume both routes exist with their specified content. Post-16, the `/` test asserts no "Markets" heading + no closed-market section; the `/markets` test asserts the existing dense layout. |
| `features/extension/17-market-creation-validation.md` / `features/extension/18-dummy-data-removal.md` | Land in parallel; touching different files. |
