# Decisions and history

Newest first inside each section. PR numbers are from `daggerok/gex`. Add a dated entry when you change an algorithm

## GEX levels

### Levels on the same price share one chart label (2026-10-07)

- `src/level-labels.ts` (`groupLevelLabels`, `labelLayout`, `MAX_INLINE_LABEL_CHARS = 26`): selected levels with the same price (equal to 1e-6) get ONE label on the first of them, each name in its own color. Joined with " + " on one line when it is at most 26 characters, otherwise one level per line (stacked in the rotated frame so the lines do not overlap). Every level still draws its own dashed line, same-price lines may sit on top of each other, the user does not mind
- Why: with the new Gamma Range levels, Call Wall 2 and Gamma Range High both landed on 778 on the SPY snapshot and their rotated labels printed on top of each other
- Verified live with Playwright: SPY shows "Call Wall 2" over "Gamma Range High" (30 characters, stacked), AAPL with all levels on shows "Put Wall + Gamma Range Low" (inline)

### Gamma Range High / Low added, Range High / Low renamed Call Wall 2 / Put Wall 2 (2026-10-07)

- New levels `gammaRangeHigh` / `gammaRangeLow` (`findGammaRange`, `GAMMA_RANGE_SHARE = 0.75`): from spot to the right the strike where the running positive `netGex` reaches 75% of the positive total at or above spot, from spot to the left the same over negative `netGex`. Computed from the profile of the selected expirations, same for every ticker, no per-symbol table. Chosen by the user so the levels need no per-ticker tuning. Original heuristic, tooltips say so
- The previous display names "Range High" / "Range Low" (themselves renamed from Resistance 2 / Support 2 earlier the same day) became "Call Wall 2" / "Put Wall 2" (ru: "Стена коллов 2" / "Стена путов 2") so the word "range" belongs to the new levels. Identifiers (`callWall2`, `putWall2`), i18n keys and the distance rule are unchanged
- New levels start ON by default together with Call Wall 2, Put Wall 2 and Gamma Flip. Colors: cyan-400 (high), pink-400 (low). Verified live with Playwright on SPY (cache): Gamma Range High 778.00, Gamma Range Low 760.00, both listed in the sidebar, the toggle panel and as chart lines

### Range High / Range Low default distance raised from 2% to 3% of spot (2026-10-07)

- `SECOND_WALL_MIN_DISTANCE_PCT` is now `0.03` in `src/gex.ts`, applies to every symbol without a row in `SECOND_WALL_DISTANCE_BY_SYMBOL` (SPX included, a short-lived `SPX: { pct: 0.03 }` row from the same day was dropped as redundant). `SPY: { usd: 3 }` stays. Tooltips in en and ru say 3%. The user wants to see the levels further out for now and will add specific per-symbol rows on top of the generic default later. On the 2026-10-05 SPY snapshot the SPY row is unaffected

### Resistance 2 / Support 2 renamed Range High / Range Low (2026-10-07)

- Display names only (en `Range High` / `Range Low`, ru `Верх диапазона` / `Низ диапазона`, the `(R2)` / `(S2)` suffixes dropped) in the Key Levels sidebar, the toggle panel and the chart labels. Code identifiers, i18n keys (`gex.level.resistance2`, `gex.chart.support2`, ...), `callWall2` / `putWall2` and the rule itself are unchanged. Older entries below keep the old names as history

### Second walls: directional, with a per-symbol distance (2026-10-07)

- Bug seen on SPY (cache snapshot 2026-10-05, spot 775.83): Resistance 2 showed 771, which is below both the call wall (787) and spot. The old rule only required `|strike - wall| >= 2% of spot`, so it could pick a strike on the wrong side of the wall. Support 2 had the mirror problem (the old test fixture even expected `putWall2 = 95` above `putWall = 90`)
- Fix 1: Resistance 2 must be above the call wall, Support 2 below the put wall. Applies to every symbol, SPX included
- Fix 2: the distance threshold can be set per symbol, as a percentage of spot or a flat price, in `SECOND_WALL_DISTANCE_BY_SYMBOL`. Default stays 2% of spot
- SPY is set to `{ usd: 3 }`. Reason: 2% of 775.83 is about $15.5, which pushes Resistance 2 to a negligible strike at 803. With $3 the strongest strike above 787 is 790 (+90M netGex), which is where the user expected the level. Values between $2 and $3 give the same result on that snapshot, the $3 number is a judgment call, tune it freely
- The user said SPX is fine at 2%, so it has no override. `computeGexLevels` and `useGexLevels` now pass the symbol through
- Tooltips for Resistance 2 and Support 2 were reworded in en and ru (direction plus the configurable distance), still labeled as the app's own heuristic
- Possible follow-up not done: edit the mapping from the Settings panel instead of in code

### Gamma flip rewritten to hypothetical-spot recompute (#33, 2026-10-05)

- Before: cumulative sum, then last zero crossing of the per-strike netGex profile, then a +/- directional split, real-bar anchoring and zero-boundary trim (#27 and earlier)
- Problem: all of those scanned the profile already computed at the real spot. Gamma depends on spot, so that sign pattern is a different quantity from "where would the whole book net to zero if spot moved there"
- Now: `findGammaFlipHypotheticalSpot` re-prices every quote at 60 spots across +/-20%, see `gex-levels.md` for citations
- The old plan had listed this as "approach B, out of scope for v1" and kept the `findGammaFlip(profile)` signature stable for a later swap. The replacement took raw quotes instead

### IV floor for the gamma flip sweep (#33)

- Found against real cached `SPX.json`, not theoretical. A quote (SPXW261009C07125000, OI 15) carried `iv = 0.00001`. CBOE's own feed, passed through by `scripts/options-data.py`
- The distinct sub-0.3 IVs form a halving sequence (1e-5, 0.000254, 0.000498, 0.000987, 0.001963, 0.003916, 0.007822, 0.015635, 0.031260, 0.062509, 0.125009, 0.250008), the signature of CBOE's bisection IV solver giving up on quotes with no two-sided market (bid = ask = 0 for about 98% of the sub-0.01 group)
- BS gamma scales as 1/(S * sigma * sqrt(T)), so near-zero sigma makes gamma explode as the swept S nears that strike. That one quote produced about a $19.7B swing at one grid point against normal per-quote contributions in the hundreds of millions, flipping the aggregate sign and creating a fake second crossing
- Fix: `GAMMA_FLIP_MIN_IV = 0.05`. Genuine SPX-family IV never goes below it and even the 2020 crash peaked under 0.9. Large failed-solve IVs (7.93 seen) only shrink gamma, so no cap
- The old per-strike algorithm never hit this because it used the provider's real-spot gamma

### Dual Gamma Flip +/- display removed

- `gammaFlipPos` / `gammaFlipNeg` were shown as adaptive "Gamma Flip +" and "Gamma Flip -" levels (#30), then collapsed back to one plain Key Level
- The two fields remain on `GexLevels`, the single `gammaFlip` is chosen by the sign of `totalNetGex`, and that choice is documented as a placeholder rule for the rare two-crossing chain

### Resistance 1.5 / Support 1.5 added then removed (#31, removed in #33)

- Rule was "nearest strong wall, no distance restriction", shade between wall and wall 2
- Removed entirely after shipping: the user found them not working out. Do not reintroduce unasked

### Resistance 2 / Support 2 use a 2%-of-spot distance rule (initial plan, 2026-09-27)

- A "second wall" is not a standard concept. The plan invented the 2% distance only so the result is deterministic, and flagged it as tunable
- The simplest alternative (next-highest netGex with no distance filter) just returns a neighbor strike of the primary wall, which is why a distance filter was added
- Open question if it is ever revisited: top-N by absolute gamma, or local maxima of the profile, instead of a fixed percentage. No research has been done on either

### Key Levels panel behavior

- Panel is sorted by strike, right-aligned, uses available row space instead of a fixed cap (#32, #36, #37)
- Defaults (`DEFAULT_SELECTED_LEVELS` in `GexView.tsx`): only Resistance 2, Support 2 and Gamma Flip start ON. Call Wall and Put Wall are OFF (redundant with the tallest bars), Max Pain and Spot are OFF for a quieter default view. Some older comments in that file still describe earlier revisions, trust the constant
- All rotated level labels share one baseline rather than staggering, an accepted tradeoff is overlap when strikes are close

### Absolute Gamma metric (#35)

- Added as a chart metric with its own secondary axis, defined per SpotGamma's "Absolute Gamma" support page

## Data and providers

- SPX and other index options support: #7 (SPX), #15 (XSP, NDX, DJX, RUT). Research condensed in `spec-index-options.md`. SPY was added to the universe in #4
- VIX/VXN GEX: first suppressed as wrong for futures-priced symbols (#17), then supported via per-expiration forwards and Black-76 (Phase 3, see `spec-vix-futures.md` section 9)
- Chart OHLC uses the Yahoo chart endpoint through the proxy. A CBOE historical-bars fallback was only a hypothesis, never verified

## Repo history

- GEX tab fills the height down to the footer (2026-10-07): the chart height was a magic `lg:h-[calc(100dvh-304px)]`, 23px short of the real budget on a single-line header and 23-46px too tall when the Expirations panel wrapped, so the footer looked detached on GEX compared with Desk and Chart. Now `main.tsx` gives the GEX wrapper `flex shrink-0 grow flex-col` and `GexView` chains `flex-1` through main, the row and the chart (`lg:min-h-[420px]` floor kept, a viewport shorter than ~730px still scrolls). Measured live with Playwright on SPY at 1440x900, 1440x1200, 2000x1000 and 1100x800: GEX footer top equals Desk and Chart, document height equals the viewport. At 1440x700 the 420px chart floor still overflows by ~27px, same as before
- Key Levels panel grows leftward (2026-10-07): `grow basis-0 min-w-[300px] max-w-fit` replaces `shrink max-w-[45%]` in `GexView.tsx`. It extends from the right edge until it is one `gap-2` from the Metrics panel, capped at its own content width, and its chip row scrolls only once it has reached Metrics. Verified live with Playwright on SPY (cache): 2000px no scroll and a 272px gap, 1700/1440/1100/768px gap 8px with scroll, both panels on one line at every width. The old 45% cap clipped the first chip at 2000px while a wide gap stayed empty
- CI runs on pull requests only (2026-10-07): `ci.yaml` triggers on `pull_request` to `main` plus manual dispatch, with a per-ref concurrency group that cancels superseded runs. Pushes to `main` are built and deployed by `github-pages.yml`, so a second build there was redundant (tests no longer run on push to main, they gate the PR). The `npm-check-updates` job moved to its own manual workflow `npm-check-updates.yml`
- Fetch and rebase rule (2026-10-07): `rules/workflow.md` requires `git fetch` + `git rebase origin/main` before starting work and before every push. Reason: parallel PRs kept colliding, e.g. two PRs adding an entry at the top of this section conflicted in `decisions.md`
- `npm-check-updates` CI job is manual-only (2026-10-07, later moved to `npm-check-updates.yml`): so push and PR runs no longer bump dependencies and fail on upstream releases. Run it from the Actions tab. The separate `dependency-updates.yml` workflow was already manual
- Dependabot uses the `bun` ecosystem with `bun.lock` pinned to `lockfileVersion` 1 (2026-10-07): the bun updater cannot parse version 2 (`Unsupported bun.lock 'lockfileVersion' 2`), so no JS update PRs were ever created. Switching to `npm` was tried and fails too: it refuses bun-managed projects (`bun.lock` without `package-lock.json`) and says to use `bun`. bun 1.4.2 accepts version 1 and keeps it on `bun add` and `bun install`, so the fix is to hold the lockfile at 1, reset it by hand if a newer bun bumps it. The `github-actions` entry also scans `.github/actions/uv`
- `.plans/` removed (2026-10-07). The three plans were condensed into `spec-gex-app.md`, `spec-index-options.md` and `spec-vix-futures.md` with the section numbers cited by code comments preserved. The two wireframe SVGs, the symbol-routing diagram and the two competitor screenshots were dropped: the wireframes are fully implemented (GexView and ChartView are the truth), the routing is a table in `spec-index-options.md`, the screenshots were vibe reference only. Originals remain in git history before this change. New research or specs go to `.claude/docs/spec-<topic>.md`

- `daggerok/gex` was cloned from `daggerok/options-desk` to be developed independently. It was fully renamed and cleaned up (storage key prefixes `gex.*`, proxy identifiers, User-Agent `GexBot`)
- The agentic scaffolding inherited from options-desk (AGENT.md, ARENA, Setup, .cursorrules) was deleted on purpose, then this `.claude/` setup replaced it. Do not recreate the old files
- The original `src/main.tsx` monolith (5,065 lines) was split in Phase 0 as a zero-behavior-change PR, that approach (mechanical refactor first, features after) is the pattern to follow for large changes

## Open items worth knowing

- Gamma flip never compared against a third-party published value for the same day
- Fixed 2% second-wall rule untested against real strike spacing across tickers
- lightweight-charts attribution wording is a paraphrase
- Workflows were checked by filename only in the original plan, `ci.yaml` has since been read (see `architecture.md`)
