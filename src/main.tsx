// main.tsx
/**
 * ============================================================================
 * AGENTIC AI ENFORCED SPECIFICATION & GUIDELINES (CRITICAL)
 * ============================================================================
 * 1. KEEP DOCUMENTATION USEFUL: Preserve accurate design docs and type
 *    descriptors, but correct or remove stale comments instead of carrying
 *    misleading history forward.
 * 2. AGENT READ-WRITE RULE: If a future deployment or agent updates the code,
 *    this header section and related documentation blocks MUST be kept accurate
 *    and synchronized with feature upgrades.
 * 3. MODULE LAYOUT: Since v0.9.47 the app is split into modules under src/
 *    (layout per .claude/docs/spec-gex-app.md section 4). This file is
 *    the App shell only (state, effects, render) plus this shared changelog.
 *    (Optional INFRASTRUCTURE lives outside src/ — see "COMPANION
 *    INFRASTRUCTURE" below — and is not required for the app to run.)
 * ============================================================================
 *
 * ============================================================================
 * AGENTIC AI DOCUMENTATION & SYSTEM ARCHITECTURE  (main.tsx)
 * ============================================================================
 *
 * PROJECT: GEX
 * ENVIRONMENT: Bun scripts, Parcel build, React, TypeScript, TailwindCSS v4
 *
 * ---------------------------------------------------------------------------
 * CHANGELOG (append newest at top; keep history accurate):
 * ---------------------------------------------------------------------------
 * v0.9.54 - Fix footer spacing on a tall/loaded Desk chain (reported w/
 *          screenshot: footer sat flush at the viewport's bottom edge with
 *          almost no visible gap below it, unlike the already-correct short-
 *          content case):
 *          - ROOT CAUSE (confirmed live via Playwright + getBoundingClientRect
 *            at 390/768/1024/1440/1920px): ChainTable's scroll container used
 *            a hardcoded `max-h-[calc(100dvh-254px)]`. That "254" budgeted
 *            ONLY the chrome ABOVE the desk (true back when it was tuned in
 *            v0.9.48 for a fixed 44px tab row) and never subtracted anything
 *            for what renders BELOW it (DeskView's own `py-4` bottom padding +
 *            the page footer). It had also gone stale above the desk too:
 *            v0.9.51's shared expiration-picker+Load panel wraps to 2 lines at
 *            common widths (measured nav height 100px at 1024-1440px, 154.5px
 *            at 390px - both well past the ~44-63px the constant assumed).
 *            Net effect: loading any chain tall enough to hit this cap forced
 *            the WHOLE PAGE to scroll 44px (1024-1440px) to 90px (390px)
 *            further than one viewport before the footer (with its own
 *            correctly-tuned small padding, see AttributionFooter.tsx) ever
 *            became visible - instead of staying immediately visible the way
 *            it does on an empty/short tab. At the viewport's natural (un-
 *            scrolled) position the footer was entirely below the fold.
 *          - FIX: replaced the hardcoded dvh offset with real flex layout, so
 *            the browser computes the remaining space instead of a hand-
 *            maintained constant. Root `min-h-screen` -> `h-dvh` (a floor
 *            alone never gives the flex chain below it a DEFINITE height to
 *            redistribute - `flex-grow` only ever redistributes space already
 *            bounded from above). The Desk-only chain (hidden tab wrapper ->
 *            DeskView's `<main>` -> ChainTable's root -> `.table-container`)
 *            now threads `flex-1 min-h-0` down to the scroll container, which
 *            dropped the `max-h` calc for plain `flex-1 min-h-0 overflow-auto`.
 *          - GOTCHA (found live measuring the GEX tab, two wrong attempts
 *            before landing here): the shared tab-content wrapper can't
 *            unconditionally carry `min-h-0` - that strips flex's default
 *            `min-height: auto` protection for EVERY child uniformly, so it
 *            also let GEX/Chart's own content (which has no `overflow-auto` of
 *            its own by design) get shrunk below its real height, rendering
 *            past/behind the footer instead of pushing it down. Fixed by
 *            conditioning that wrapper's `min-h-0` on `activeTab === 'desk'`
 *            (plus defensive `shrink-0` on the nav row and each tab-content
 *            block) - GEX/Chart keep their pre-existing "just overflow the
 *            page if too tall" behavior, only Desk opts into the shrink/clamp.
 *          - VERIFIED live via Playwright (390/768/1024/1440/1920px): Desk
 *            empty, Desk loaded (SPX, 15 expirations), GEX loaded, Chart
 *            loaded, GEX/Chart empty - footer sits flush at the true page
 *            bottom with its tuned small padding in every case, Desk's chain
 *            table scrolls entirely internally (no more extra outer-page
 *            scroll), and GEX/Chart still overflow the page normally when
 *            their own content needs more than one viewport.
 * v0.9.53 - Footer scoped per tab (user request: show the TradingView/
 *          lightweight-charts attribution only where that library is
 *          actually used): AttributionFooter.tsx now renders only when
 *          `activeTab === 'chart'`; every other tab shows the new
 *          `RepoFooter` (plain link to this project's own GitHub repo)
 *          instead. Reverses the earlier "on every tab" choice noted in
 *          v0.9.52's own entry below - that was a reasonable reading of
 *          Apache-2.0 at the time, but scoping to the one tab that actually
 *          generates the display lightweight-charts' NOTICE refers to is the
 *          more precise one.
 * v0.9.52 - Persist UI state across reloads (user request: "if I refreshed a
 *          page or opened after close, is it possible to keep this"):
 *          - Settings gains three fields: `activeTab` (AppTab), `selectedExps`
 *            (string[]), `gexMetrics` (GexMetric[]) — see types.ts/
 *            settings-store.ts. `lastTicker` already existed but, until now,
 *            was WRITE-ONLY: nothing on boot ever read it back.
 *          - REVERSES v0.9.48's deliberate choice to keep `activeTab`
 *            transient ("every page load starts on Desk"): the user now
 *            explicitly wants the opposite. `selectedExps`/`gexMetrics` had
 *            no persistence before at all.
 *          - BOOT SEQUENCE (new `hasPersistedState` + restoreSession, both
 *            near the top of App): if a settings record already existed at
 *            mount (the ONLY reliable "is there something to restore" check —
 *            `lastTicker`'s default 'AAPL' is indistinguishable in value from
 *            a real prior load of AAPL), replay the exact same `getDates()`
 *            fetch path a manual search uses for the persisted ticker, then
 *            intersect the persisted `selectedExps` against the freshly
 *            fetched expirations (a stale selection may name dates that no
 *            longer exist) — falling back to getDates' own nearest-expiration
 *            default when the intersection is empty. `activeTab`/`gexMetrics`
 *            restore immediately via lazy useState initializers (no fetch
 *            needed) and, since their defaults now equal the old hardcoded
 *            constants, a brand-new user's first load is unchanged.
 *          - FAILS SAFELY: any restore-fetch failure is handled entirely by
 *            getDates' existing try/catch (same as a failed manual search) —
 *            no new error path, no stuck spinner.
 *          - Fully automatic/silent by design (no "resume session?" prompt) —
 *            matches the user's own framing of the request.
 * v0.9.51 - Share the expiration panel + Load button across Desk and GEX:
 *          - PROBLEM: since v0.9.49/50 unified `selectedExps` between Desk and
 *            GEX, a user could pick/deselect expirations from the GEX tab (its
 *            own "All" toggle), but the Load button existed ONLY on Desk - a
 *            lazy YAHOO expiration picked from the GEX tab had no way to
 *            actually be fetched from that tab.
 *          - FIX: the expiration chips + Load <form> moved OUT of DeskView
 *            (and GexView's now-redundant own copy was removed) into ONE
 *            shared panel. TabSwitcher gained an `endSlot` prop that renders
 *            in the SAME ROW as the Desk/GEX/Chart pills, to their right - one
 *            horizontal bar: [Desk|GEX|Chart]  [chips… All] [Load]. main.tsx
 *            passes the panel only when `meta` exists AND `activeTab !==
 *            'chart'` - Chart doesn't act on the expiration selection the way
 *            Desk/GEX do, so the panel is hidden there entirely (not just
 *            inert). Same `loadChain()` wiring, button states/labels and
 *            Enter-to-submit <form> behavior as before - a relocation, not a
 *            redesign. Desk keeps its own chainSymbol/spot/provider display
 *            and Cancel button (those reflect the loaded DESK chain
 *            specifically, not the picker) - only the picker+Load moved.
 *          - The shared panel now offers the FULL `meta.expirations` list
 *            (previously GexView restricted its OWN chip copy to
 *            `gexExpirations`, the already-loaded subset) since the Load
 *            button is right there to fetch whatever's selected; an
 *            unloaded expiration simply contributes no quotes
 *            (quotesByExp[exp] ?? [] in useGexLevels) - an expectedly
 *            incomplete analysis until Load is pressed, not an error.
 *            GexView's top empty-gate is now just "is a ticker loaded"
 *            (`!symbol`) instead of also requiring already-loaded data.
 *          - BUG FIX (reported w/ screenshot, reproduced live via Playwright
 *            at mobile widths 320-414px before fixing): ExpirationChips'
 *            own chip strip already capped+scrolled itself
 *            (max-w-[46vw]/overflow-x-auto), but its caller's row was a
 *            plain `flex` (no wrap) - so the fixed-width "All"/"None" toggle
 *            and the Load button, siblings in that row, got pushed past the
 *            viewport's right edge at narrow widths (confirmed:
 *            document.documentElement.scrollWidth > window.innerWidth, and
 *            the Load button's bounding rect exceeded innerWidth) - genuinely
 *            clipped, not reachable via the chip strip's own scrollbar. Fixed
 *            at two levels: TabSwitcher's own row is `flex-wrap` (so the whole
 *            expiration form drops below the tab pills when it doesn't fit
 *            next to them) and the form itself is also `flex-wrap` (so Load
 *            drops to its own line within the form as a second line of
 *            defense). Also widened the chip strip's cap to max-w-[70vw] - it
 *            no longer shares a row with Desk's ticker-input/provider-dropdown
 *            or GEX's metric toggle, so it can afford more room. Verified at
 *            320-1440px (390px wraps to two lines; 1024/1440px fit on one).
 * v0.9.50 - Phase 5 Chart tab: views/ChartView.tsx replaces the 'chart' TabStub
 *          (plan section 8.2). Daily candles from providers/chart.ts fetchOhlc
 *          (range 1M / 3M / 6M default / 1Y, interval fixed 1d) drawn with
 *          lightweight-charts (new dependency, Chart tab only, React.lazy-loaded)
 *          plus one price line per non-null GEX level, colored from gex-colors.ts.
 *          GexLevels are now computed ONCE here (use-gex-levels.ts, for the GEX
 *          tab's expiration selection) and passed to both GexView and ChartView;
 *          neither view calls computeGexLevels itself. Range is held here so it
 *          survives tab switches. New i18n keys: chart.*.
 *          components/AttributionFooter.tsx renders the lightweight-charts
 *          NOTICE (verbatim) + https://www.tradingview.com/ link on every tab.
 * v0.9.49 - Phase 3 GEX tab: views/GexView.tsx replaces the 'gex' TabStub
 *          (plan section 8.1). Sidebar (OI Volume / GEX Analysis / Key Levels /
 *          P/C Ratio) + recharts bar chart by strike with spot and call/Min Net GEX
 *          reference lines, metric toggle (Net GEX / Call OI / Put OI / Call
 *          Volume / Put Volume). All numbers come from src/gex.ts. No new fetch:
 *          bulk providers (CACHE/CBOE/NASDAQ) read the whole chain already held
 *          by getBulk() after "Expirations"; lazy YAHOO only offers the
 *          expirations already in expData. The tab has its OWN expiration
 *          selection (default: nearest single date, reset per provider+symbol)
 *          and metric, held here so they survive tab switches. GexView is
 *          React.lazy-loaded so recharts stays out of the initial bundle. The Desk's chip
 *          strip is extracted to components/ExpirationChips.tsx and reused.
 *          Level colors live in gex-colors.ts for reuse by the Chart tab.
 * v0.9.48 - Phase 2 tabs shell: App holds a transient `activeTab`
 *          ('desk' | 'gex' | 'chart', default 'desk', not persisted). A
 *          TabSwitcher (header Pill control) renders under <TopBar/>. Desk is
 *          the unchanged DeskView, kept mounted (hidden) on other tabs so its
 *          ChainTable state survives switching. GEX / Chart are placeholder
 *          stubs until Phase 3 / Phase 5. New i18n keys: tabs.*.
 *          ChainTable max-height offset 210px -> 254px to absorb the 44px tab
 *          row, so a loaded desk still fits the viewport (no page scroll).
 * v0.9.47 - Phase 0 file-layout refactor (zero behavior change): the former
 *          single-file app is split verbatim into modules:
 *            types.ts, i18n.tsx, utils.ts, greeks.ts, theme.ts,
 *            settings-store.ts, providers/{index,cache,cboe,nasdaq,yahoo,
 *            proxy-search,loader}.ts, components/*.tsx, views/DeskView.tsx.
 *          Model greeks single source of truth is now src/greeks.ts.
 * v0.9.46 - Provider select: CACHE mode locks to CACHE only (disabled);
 *          LIVE mode lists only CBOE / NASDAQ / YAHOO (no CACHE item).
 * v0.9.45 - Header/settings/debug VISUAL parity with fundamentals:
 *          - Same sticky surface tokens (slate-950/95, backdrop-blur-md),
 *            Pill segmented controls, emoji theme ☀️/🌙 + ⚙️ settings,
 *            flag i18n pills, and card-shell debug/settings popovers.
 * v0.9.44 - Header parity with fundamentals + CACHE-muted proxies:
 *          - Sticky header now mirrors fundamentals order: debug · proxy dots ·
 *            ticker · search · CACHE/LIVE · theme · i18n · settings.
 *          - When CACHE (static) is selected, proxy health dots are muted grey
 *            and the provider dropdown is disabled (non-functional, greyed).
 *          - LIVE mode shows green/red proxy health against proxyBase /health.
 * v0.9.43 - Static index without timestamp churn:
 *          - data/options/index.json `files` is a sorted ticker list (no per-ticker
 *            updated ISO map) and `generated` is dropped. loadStaticTickerManifest
 *            still accepts the legacy map shape. Freshness lives on file mtime /
 *            in-file `updated`, so no-op fetch runs no longer rewrite the index.
 * v0.9.42 - Shared color palettes (merge-ready with fundamentals):
 *          - Settings gain a Color palette control with two product skins:
 *            Emerald Ledger (`fundamentals`) and Indigo Desk (`gex`).
 *          - Default remains Indigo Desk (this app's native look). Emerald is
 *            the native fundamentals palette so a future merge already has both
 *            UIs prepared and consistent. Persisted as `settings.colorTheme`.
 *          - `useThemeController` sets `data-palette` on <html>; accent classes
 *            (buttons, focus rings, brand chip, Theme/Language switches) and
 *            index.css surface tokens follow the selected palette.
 * v0.9.41 - i18n(ru): translate Bid / Mid / Ask (and OI tooltip) on the desk:
 *          - Price columns were hard-coded as English `"Bid"` / `"Mid"` / `"Ask"`
 *            in `deskColumns()` so the chain header stayed Latin under RU locale
 *            while every other label (Коллы, Путы, Страйк, Объём, Вега…) was
 *            already translated. Wired them through `t(...)` with new keys
 *            `settings.deskColumns.bid|mid|ask` + short `deskColumns.header.*`.
 *          - RU headers: `Бид` / `Мид` / `Аск` (common broker shorthand);
 *            full Settings labels: `Бид (спрос)` / `Мид (середина)` /
 *            `Аск (предложение)`. EN keeps Bid / Mid / Ask.
 *          - RU open-interest header uses Cyrillic `ОИ` (not Latin `OI`);
 *            Settings label `Открытый интерес (ОИ)` matches.
 *          - Settings note translated fully: Bid/Mid/Ask/Strike/Rho →
 *            Бид/Мид/Аск/Страйк/Ро.
 * v0.9.40 - Strike column containment fix:
 *          - Strike ($) track was too narrow for high-priced underlyings
 *            (e.g. MPWR ~$1,344 → strikes like `1,480.00`). With default
 *            OI/Vol/IV/Greeks + Bid/Mid/Ask on both sides, the center track
 *            compressed so strike text spilled past its cell into Put Bid.
 *          - Widened Strike track to `minmax(5.75rem, 1.15fr)`, bumped the
 *            desk min-width strike allowance (4.5 → 6.25 rem), tightened strike
 *            cell padding (`px-1.5`), and added CSS containment on
 *            `.od-strike-cell` (`min-width: 0`, `overflow: hidden`,
 *            `text-overflow: ellipsis`, `white-space: nowrap`) so the value
 *            stays INSIDE the Strike column at every viewport width. Full value
 *            remains available via the cell `title` tooltip if clipped.
 * v0.9.39 - Option desk spacing, flag & i18n updates:
 *          - Spacing: widened Strike ($) column (`minmax(4.25rem, 1.05fr)`) and
 *            added scalable `--od-cgap: 0.25rem` (`column-gap: var(--od-cgap)`)
 *            between grid tracks so Strike ($) and Put Bid (plus all desk columns)
 *            stay clearly separated and scale smoothly without clashing.
 *            Added `headerLabel` support (`OI`, `IV`, `Vol`, `Δ`, `Γ`...) and
 *            tooltip (`title`) to column headers (`.od-labels`).
 *          - Language flag: use US flag (`🇺🇸`) instead of GB (`🇬🇧`) for `en`.
 *          - i18n(en/ru): updated `settings.deskColumns.openInterest` (`Open interest (OI)`
 *            / `Открытый интерес (OI)`) and `iv` (`Implied volatility (IV)` /
 *            `Подразумеваемая волатильность (IV)`). Translated Greek names into
 *            standard Russian Cyrillic spelling (`Дельта Δ`, `Гамма Γ`, `Тета Θ`,
 *            `Вега`, `Ро ρ`, `Лямбда λ`, `Ванна`, `Вомма`, `Чарм`, `Спид`, `Зомма`,
 *            `Колор`) for Settings with short `headerLabel`s for chain table.
 * v0.9.38 - i18n(ru): translate the option-chain section headers that were
 *          left in English under Russian locale — chain.calls/puts/strike now
 *          render Коллы / Путы / Страйк (previously hard-coded "Calls/Puts/Strike"
 *          in the RU dictionary). Settings deskColumns labels + the "(no options)"
 *          ticker badge translated too. Greek-letter / IV / API labels stay in
 *          Latin by design (standard in Russian options terminology).
 * v0.9.37 - i18n consolidation & fixes (PR #21):
 *          - Inlined src/i18n.tsx into this file (single-file continuity);
 *            src/ now holds only main.tsx, index.html, index.css, favicon.ico.
 *          - Fixed literal {{expirations}} / {{load}} in the empty-state hints:
 *            the two templated sentences are now fragment keys with the button
 *            label rendered as a styled inline span (no unsubstituted placeholders).
 *          - Language switcher now shows distinct ru/en flag icons (🇬🇧/🇷🇺)
 *            instead of a single shared 🌐 globe for both languages.
 * v0.9.36 - Rename primary action button label Get dates → Expirations
 *          (loading: Loading…). Internal getDates() name unchanged.
 * v0.9.35 - After confirming a ticker (suggestion click, or Enter in the
 *          input), focus jumps to the Expirations button so Space/Enter runs
 *          the fetch without a mouse trip (mirrors Load-button focus UX).
 * v0.9.34 - Ticker input selects all text on focus/click so typing a new
 *          symbol replaces the previous ticker without manual clear.
 * v0.9.33 - Single source of truth for model greeks (UI only):
 *          - scripts/options-data.py no longer runs Black-Scholes / higher-order
 *            math; it only attaches Cboe delayed 1st-order when available.
 *          - λ + 2nd/3rd-order + full BS fallback remain exclusively in this
 *            file (blackScholesGreeks / enrichQuotesWithModelGreeks) so live
 *            and CACHE providers share one implementation without duplication.
 * v0.9.32 - Providers trimmed to CACHE + CBOE + NASDAQ + YAHOO:
 *          - Removed marketdata.app and DoltHub from the live registry.
 *          - Short uppercase labels; fixed dropdown order: CACHE, CBOE, NASDAQ, YAHOO.
 *          - Default selection only (not order): CBOE on localhost/LAN; CACHE on Pages.
 *          - Settings migration: unknown/removed providerId resets to host default.
 * v0.9.31 - Client-side Black-Scholes greeks enrichment for live providers:
 *          - Higher-order greeks (λ, vanna, vomma, charm, speed, zomma, color)
 *            used to exist only on Static cache because scripts/options-data.py
 *            pre-computed them at build time. Live providers (CBOE/Yahoo/
 *            NASDAQ) now get the same model enrichment in the browser after
 *            fetch, using spot + IV + strike + side + expiration.
 *          - Provider-supplied 1st-order greeks (e.g. CBOE delta/gamma) are kept;
 *            only missing fields are filled. Full model set is used when the
 *            provider has IV but no greeks (Yahoo). NASDAQ still has no IV, so
 *            model greeks remain empty there.
 *          - Enrichment runs in putBulk / loadExpiration so desk columns work
 *            uniformly across providers without changing proxy APIs.
 * v0.9.30 - Static-cache higher-order greeks parse fix:
 *          - Static provider now maps lambda + 2nd/3rd-order greeks
 *            (vanna/vomma/charm/speed/zomma/color) exactly once (no duplicate
 *            object keys). OptionQuote types document these optional fields.
 *          - Desk column renderers read typed fields instead of `as any`.
 * v0.9.29 - Desk columns + compact theme picker:
 *          - Options desk columns are now user-configurable in Settings. OI,
 *            Volume, IV and Greeks can be toggled; Bid/Mid/Ask and Strike stay
 *            visible so the desk remains readable. Greeks are enabled by
 *            default and render delta/gamma/theta/vega when available.
 *          - Missing quote data now renders as an empty cell instead of a dash.
 *          - Theme switch is now a compact current-theme icon with an animated
 *            dropdown of the other themes; Escape/click-away closes it.
 * v0.9.28 - Static-cache greeks metadata:
 *          - OptionQuote now carries optional `greeksSource` and
 *            `greeksMissingReason` fields, and ChainMeta/ChainResult can carry a
 *            top-level `greeks` enrichment summary from data/options/{TICKER}.json.
 *          - Static-cache parsing preserves these fields so future greeks-based
 *            analytics can distinguish provider-supplied Cboe delayed greeks
 *            from Black-Scholes model estimates.
 * v0.9.27 - Local-index company names in ticker suggestions:
 *          - data/options/index.json may now include `names: { TICKER: companyName }`.
 *            The local fallback suggestion source reads that map, displays the
 *            company/fund/index name instead of the generic "Ticker from local
 *            index", and also searches names so typing "apple" can suggest AAPL.
 *          - Existing no-options labeling is preserved: a named no-options row
 *            still shows the symbol with "(no options)" while using the stored
 *            company name as the description.
 * v0.9.26 - Provider-aware ticker suggestions + local no-options fallback:
 *          - Replaced the Static-cache-only ticker <select> with a searchable
 *            combobox input for ALL providers. Suggestions are fetched while the
 *            user types and can be picked without auto-loading; Enter still runs
 *            Get dates unless a highlighted suggestion is selected.
 *          - Providers with a native searchable universe now use it: Yahoo,
 *            NASDAQ and CBOE call the companion proxy's new unified
 *            /api/search?provider=<id>&q=... endpoint; DoltHub uses SQL against
 *            option_chain at DOLT_LATEST_DATE. Providers without such an endpoint
 *            fall back to data/options/index.json.
 *          - data/options/index.json fallback now reads BOTH `files` (cached tickers with
 *            options) and `no_options` (valid tickers where the latest scan found
 *            no listed options). no_options rows are visibly labeled
 *            "(no options)" in the suggestion menu and Static fetches now produce
 *            an explicit no-options message instead of a misleading 404.
 * v0.9.25 - FOCUS-ON-CLICK for multi-expiration desks (BDD requested):
 *          - GIVEN 4 expirations loaded and scrolled to the latest (4th),
 *            WHEN user clicks any date bar above (2nd or 3rd) in the sticky pile,
 *            THEN: (1) the CURRENT active expiration (e.g. 4th, the one in view)
 *            is collapsed — chevron flips v -> > — (2) the CLICKED expiration is
 *            expanded (if it was collapsed) and becomes the ONLY expanded one
 *            when many (>1) were expanded (smart exclusive mode per user choice),
 *            otherwise just swaps active <-> clicked, (3) view scrolls to the
 *            vertical middle where the ATM strike is (centerStrike, accounts for
 *            the sticky pile). If the clicked bar is ALREADY expanded, it still
 *            collapses the current active and scrolls to its ATM (scroll-and-
 *            collapse). Clicking the active bar itself still toggles collapse.
 *          - Implementation: rewritten toggleOne() in ChainTable to detect
 *            activeExp vs clicked exp, compute expandedCount, perform exclusive
 *            collapse when >1 expanded, else swap, then centerStrike().
 * v0.9.24 - REMOVE the scroll-driven auto collapse/expand feature entirely (user
 *          request). Collapse/expand is now PURELY MANUAL: per-section header
 *          click and Expand all / Collapse all. Deleted: the `autoMode` state,
 *          `recomputeAuto`, the anchoring useLayoutEffect, and all its refs
 *          (collapsedRef, lastScrollTop, suppressAuto, expandUpIdx,
 *          pendingAnchor); the scroll listener now only tracks the active section
 *          for header highlighting. A fresh Load still resets to fully expanded,
 *          and loading / manually expanding a section still centers its current
 *          strike (centerStrike, unchanged). Removed the now-unused
 *          useLayoutEffect import.
 * v0.9.23 - Fix two expand bugs (both rooted in centerStrike timing):
 *          - BUG: clicking a COLLAPSED header while scrolled down only flipped
 *            the chevron; the section didn't appear. ROOT CAUSE: centerStrike ran
 *            a ONE-SHOT requestAnimationFrame, but an expanding section mounts its
 *            rows a couple of renders later (the `rendered` state flips in an
 *            effect, then staggered rows paint). The rAF found no ATM row and
 *            bailed, so the (now-rendered) desk was never scrolled into view — it
 *            sat above the fold. FIX: centerStrike now RETRIES across frames until
 *            the ATM row exists (and nudges again until the scroll delta is ~0),
 *            so expand reliably lands on the strike whether the section was
 *            already open or just opening.
 *          - BUG: scrolling back UP re-expanded upper sections at the BEGINNING
 *            of their data (and with no visible animation, since it happened off
 *            screen). FIX: the auto UP-expand branch now CENTERS the re-expanded
 *            section on its current strike (via centerStrike) instead of merely
 *            anchoring its bar — symmetric with load / manual-click behavior. A
 *            `suppressAuto` guard stops that programmatic scroll from being read
 *            as a user "scroll down" and re-collapsing what we just opened.
 * v0.9.22 - AUTO scroll-driven collapse/expand for multi-expiration chains:
 *          - When multiple expirations are loaded, scrolling DOWN now auto-
 *            collapses each earlier section once you've fully scrolled past it
 *            (only its pinned header bar remains in the top pile); scrolling UP
 *            auto-expands them again. The collapsed set is always a PREFIX
 *            [0..k-1]; the LAST section never auto-collapses. View is ANCHORED
 *            across each prefix change so the scrollbar doesn't jump; the UP
 *            expand triggers when scrollTop reaches the top with a collapsed
 *            prefix, restoring that section's height so you can keep scrolling up.
 *          - AUTO-MODE lifecycle (per user spec): ON by default right after a
 *            Load (new symbol OR a different set of loaded expirations resets it
 *            to fully-expanded + auto ON). It turns OFF — and stays off until the
 *            next Load — the moment the user takes ANY manual collapse action:
 *            clicking a single header (toggleOne) OR Expand all / Collapse all
 *            (toggleAll). So manual layout is never fought by the scroll logic.
 *          - Clicking a collapsed header still expands it AND jumps to that
 *            section's current (ATM) strike (centerStrike), satisfying "expand →
 *            land on the money, not the top of the data".
 * v0.9.21 - Harden the estimateSpot() TS2802 fix: use Map.prototype.forEach
 *          instead of iterating the Map. v0.9.19 switched to
 *          `Array.from(byStrike.entries())`, but Array.from over a Map iterator
 *          can STILL trip TS2802 under some low-`target` tsconfigs (it consumes
 *          the iteration protocol). `forEach` is a plain method call with no
 *          iteration protocol, so it type-checks under ANY target/downlevel
 *          setting. Re-verified tsc rc=0 at ES5 (downlevelIteration:false) and
 *          ES2020. (If your IDE still shows the error, re-copy main.tsx — the
 *          fix must be present at the `byStrike.forEach(...)` line.)
 * v0.9.20 - Static cache: replace the vague "Bad static data" with ACTIONABLE
 *          diagnostics. The old code did `await res.json().catch(() => null)`,
 *          which swallowed the real cause. Root cause in the wild: a dev/preview
 *          or SPA host serving index.html (200 HTML) for a missing data/options/*.json
 *          instead of a 404 — so res.json() throws and the message was useless
 *          (and the ticker <select> also went blank because index.json failed
 *          the same way). New fetchStaticJson() reads the body as TEXT first and
 *          distinguishes: network error / 404 (not cached) / HTML SPA fallback /
 *          malformed-or-truncated JSON (NaN/Infinity), each with a fix hint.
 *          listTickers() and fetchAll() both use it.
 * v0.9.19 - Fix TS2802 in estimateSpot(): iterating a Map with `for...of`
 *          requires a tsconfig `target` of ES2015+ (or `downlevelIteration`).
 *          Some consuming projects use a lower target, so the direct
 *          `for (const [k, v] of map)` errored in their IDE. Switched to
 *          `Array.from(byStrike.entries())`, which type-checks under ANY target.
 *          (All other Map/Set usages already used Array.from(...) / .has(), so
 *          this was the only offending spot. Verified tsc rc=0 at both ES5 with
 *          downlevelIteration:false and ES2020.)
 * v0.9.18 - Collapse now stays IN VIEW when scrolled down:
 *          - BUG: collapsing a section that was NOT the last expanded one, while
 *            scrolled partway down, flipped its chevron but the section seemed to
 *            vanish. ROOT CAUSE: removing its rows shrank the content below the
 *            fold, so the browser CLAMPED scrollTop and the view jumped, carrying
 *            the just-collapsed bar off-screen. (Collapsing only the LAST expanded
 *            section removes nothing below it, so it appeared to "work fine".)
 *          - FIX: after the close animation settles (~200ms), scrollBarToPinned()
 *            smooth-scrolls the collapsed bar to its pinned slot in the top pile,
 *            so you always see it squashed with the next section right below.
 *            Expanding still centers the current strike (unchanged). Uses
 *            bar.offsetTop against the now `position: relative` scroll container.
 * v0.9.17 - Sticky expiration-bar PILE fix (the "hole" bug):
 *          - ROOT CAUSE: each sticky .od-bar lived inside its own .od-sec block
 *            wrapper, which became the bar's CONTAINING BLOCK and CLIPPED it to
 *            that section's bounds. So when a section scrolled off the top, its
 *            bar left WITH it instead of accumulating in the top pile — leaving a
 *            gap where the previous section's last rows showed through above the
 *            current bar (and multiple date bars failed to stack). FIX: .od-sec is
 *            now `display: contents` (see index.css) so it generates no box; every
 *            bar's containing block becomes the whole .od-desk and the bars
 *            correctly PILE UP as you scroll (earlier expirations stay pinned as
 *            thin collapsed bars above the expanded one).
 *          - Because .od-sec now has no box, the measurement ref moved from the
 *            wrapper onto the sticky BAR element (barRefs), and active-section
 *            tracking was rewritten to find the LAST bar that has reached its
 *            pinned slot (the section whose content is on screen below the pile).
 * v0.9.16 - Always-expanded-on-load + center-strike + per-ticker static index:
 *          - Collapse/expand state is NO LONGER persisted to localStorage
 *            (removed COLLAPSE_KEY / loadCollapsed / saveCollapsed). A freshly
 *            loaded chain ALWAYS starts fully EXPANDED — there is no longer any
 *            case where a stale saved state makes a just-loaded chain appear
 *            collapsed. Collapse is now purely session-ephemeral; switching
 *            symbol resets it to expanded.
 *          - CENTER-STRIKE view: the current (ATM) strike is scrolled to the
 *            vertical middle of the desk (a) right after data loads / the loaded
 *            expiration set changes, and (b) whenever a section is EXPANDED. New
 *            `atmRef` on ExpirationSection registers the ATM row; ChainTable's
 *            centerStrike() accounts for the sticky expiration-bar pile so the
 *            strike lands in the visible center, not under the pinned headers.
 *          - Static-cache provider reads the NEW data/options/index.json shape:
 *            `{ files: { TICKER: updatedISO }, count, generated }` (per-ticker
 *            timestamps). listTickers() now derives the list from sorted keys of
 *            `files`. No backward-compat with the old `{ tickers, updated }`.
 *            (INFRA options-data.py v4: coverage-first (all MISSING tickers, resume
 *            down the cap-ranked list) then rotating REFRESH of the OLDEST files,
 *            so every ticker gets cached before we re-loop — and we never re-loop
 *            only the top-cap names. index.json rebuilt from each file's own
 *            `updated`, so it no longer churns a single global timestamp.)
 * v0.9.15 - DROP the <table>; render the desk as DIV/CSS-GRID rows. Native table
 *          sticky <th> backgrounds go transparent while scrolling in WebKit/Blink
 *          (the persistent "headers see-through on scroll" bug) — no CSS override
 *          reliably fixes it. Switched to block/grid elements (same approach as
 *          the sibling daggerok/csv project) where sticky works flawlessly:
 *          .od-desk > .od-sec > (.od-bar sticky-accumulating + .od-sub sticky-
 *          when-active + .od-drow grid rows). Columns share one grid template
 *          (--od-grid). All prior features preserved: stacking pile, active
 *          highlight (click + scroll), collapse/expand animation, strike-count,
 *          center Strike guide, full-width + adaptive height.
 *          (INFRA, options-data.py v3: working-day freshness — skip today's data
 *          and last-trading-day data on weekends/holidays, re-fetch older files
 *          on trading days; universe deepened to the full US Micro+ cap tiers.)
 * v0.9.14 - Sticky sub-headers STILL see-through on scroll -> forced fix: the
 *          CSS `.table-container table { border-collapse: separate }` was being
 *          overridden by Tailwind Preflight's `table { border-collapse: collapse }`.
 *          Now set border-collapse:separate + border-spacing:0 as an INLINE style
 *          on the <table> (guaranteed to win the cascade), so sticky <th>
 *          backgrounds stay opaque while scrolling.
 * v0.9.13 - Sticky sub-headers no longer see-through on scroll: the desk table
 *          switched from `border-collapse` to `border-collapse: separate` (see
 *          index.css). Collapsed-border tables make WebKit/Blink paint sticky
 *          <th> backgrounds transparent while scrolling; `separate` fixes it so
 *          the Calls|Strike|Puts + column-label rows stay opaque over the rows.
 * v0.9.10 - Real fix for active-highlight-on-click + center Strike guide:
 *          - ROOT CAUSE of the persistent bug: the scroll-tracking effect had
 *            `collapsed` in its deps, so every collapse/expand re-ran
 *            recomputeActive() and instantly overwrote the clicked highlight back
 *            to the top section. Now recomputeActive runs ONLY on real scroll/
 *            resize (deps: [recomputeActive]); toggleOne sets the clicked header
 *            active; a separate effect seeds the initial highlight from the first
 *            section on load. So the highlight follows what you actually click.
 *          - Added a subtle vertical CENTER "Strike" column guide (index.css) so
 *            the eye tracks the middle axis quickly in long chains.
 * v0.9.9 - Active-highlight-on-click fix + even/comfortable columns:
 *          - BUG FIX: `activeExp` (the highlighted header) was purely scroll-
 *            based, so collapsing a LOWER section left the highlight on the top
 *            one. toggleOne() now sets activeExp to the CLICKED expiration; a
 *            later scroll recomputes it normally. Moved the activeExp state up so
 *            toggleOne can reference it.
 *          - COLUMNS: table-layout:fixed + an explicit <colgroup> (6 call cols,
 *            a narrower Strike col, 6 put cols) so columns are EQUAL and stretch
 *            evenly to fill wide screens; a table min-width (index.css) keeps
 *            them comfortable and horizontally scrollable on small screens.
 * v0.9.8 - Full-width desk, adaptive height, controls placement:
 *          - Removed the 2xl width cap on the table (it was centering/capping the
 *            desk while the controls stayed full-width, which both misaligned the
 *            Collapse-all button AND stopped the table from filling). The desk is
 *            now genuinely FULL WIDTH (w-full) and its controls align with it.
 *          - ADAPTIVE HEIGHT: max-h switched to calc(100dvh - 210px) so tall
 *            screens fit more strikes without scrolling (dvh accounts for mobile
 *            browser chrome; smaller offset reclaims vertical space).
 *          - Controls confirmed ABOVE the desk, full width: "N expirations" on
 *            the LEFT, Collapse-all / Expand-all on the RIGHT.
 * v0.9.7 - Whole-header toggle, symmetric collapse animation, ultra-wide cap:
 *          - The ENTIRE expiration bar (chevron + date + strike count) is now a
 *            SINGLE toggle button: clicking anywhere on it collapses/expands that
 *            expiration, and clicking again does the opposite (fixes the bug
 *            where a second click on a collapsed header didn't re-collapse).
 *            Removed the separate "click date to scroll/jump" action and its
 *            arrival-flash (superseded; od-flash/flash-bar no longer used) so the
 *            behavior is uniform across the whole header.
 *          - COLLAPSE is now ANIMATED symmetrically to expand: rows stay mounted
 *            briefly and FADE OUT (od-row-out) before unmounting, mirroring the
 *            open fade-in. New local rendered/closing state drives this.
 *          - ULTRA-WIDE cap: the desk stays full-width on laptops/normal screens
 *            but is capped (2xl:max-w-[1600px], centered) so numeric columns
 *            don't stretch uncomfortably across very large monitors/TVs.
 * v0.9.6 - Header centering fix, uniform style, wide layout, arrival flash:
 *          - BUG FIX: when all sections were collapsed the header content
 *            left-aligned (the colSpan 6|1|6 grid had no body rows to size it).
 *            The expiration bar is now a SINGLE centered colSpan=13 cell, so it
 *            looks & sits IDENTICALLY collapsed or expanded — only the chevron
 *            changes (v / >). Format is now uniform "YYYY-MM-DD  N strikes"
 *            (single space, no "|" divider, no "Expiration" word, no parens).
 *          - WIDE LAYOUT on big screens: <main> is a centered max-w-3xl column on
 *            phones/tablets but goes FULL WIDTH at lg+ (laptops/desktops/TVs) via
 *            lg:max-w-none + responsive padding, so the desk uses all the space.
 *            Mobile/tablet keep the readable narrow column (no zoom-out there).
 *          - ARRIVAL FLASH: jumping to an expiration briefly flashes its bar
 *            (od-flash / flash-bar keyframe, ~1.1s) so the eye catches the landing.
 * v0.9.5 - Active-section highlight, expand-on-date-click, header re-layout:
 *          - The in-view expiration bar gets an `.od-current` highlight (brighter
 *            tint + left indigo accent) so you can see where you are in the pile.
 *          - Clicking the DATE now EXPANDS a collapsed section (animated via the
 *            od-row-in group/label rows); when already expanded it scrolls to it.
 *            The chevron still always toggles collapse.
 *          - Header re-laid out to mirror the columns: [chevron DATE] | [N
 *            strikes], where "|" sits over the Strike column. Removed the word
 *            "Expiration" (all rows are expirations) and the parentheses.
 * v0.9.4 - Clickable pile headers (jump-to-expiration):
 *          - The expiration bar now has TWO targets: the chevron toggles
 *            collapse (as before); clicking the DATE text calls scrollToSection()
 *            which smooth-scrolls the desk so that expiration lands right below
 *            the pinned pile of earlier bars (offset = index * --od-bar). So you
 *            can tap any accumulated header in the top pile to jump to it.
 * v0.9.3 - Staggered rows, live cache stats, stacking sticky headers:
 *          - Staggered fade-in for option rows (od-row-in), CAPPED to the first
 *            STAGGER_ROWS (15) so huge chains (SPY ~13k rows) don't flicker.
 *          - LIVE cache stats: added a cache pub/sub (subscribeCache /
 *            notifyCacheChanged) fired on every store/evict/clear, so Settings →
 *            Cache updates immediately (fixes "stats didn't recalc after Clear").
 *          - NOTE on size (answering a question): SPY genuinely has ~13,690
 *            contracts across ~35 expirations (~3 MB normalized). Because CBOE is
 *            BULK, one "Get dates" caches the WHOLE chain -> that's the 3.03 MB;
 *            not a bug. localStorage ~5 MB, so LRU eviction keeps ~1-2 big
 *            symbols; rounding floats saved only ~1% so it's real data volume.
 *          - STACKING STICKY HEADERS (#4): the desk is now ONE <table> with one
 *            <tbody class="od-sec"> per expiration. Each Expiration bar is
 *            sticky and ACCUMULATES into a pile at the top as you scroll down
 *            (un-piles scrolling up). A scroll tracker marks the in-view section
 *            `.od-active` so only its Calls|Strike|Puts + column labels pin below
 *            the pile; passed sections show just their bar (like collapsed). Per
 *            section index is passed as CSS var --i (see index.css geometry).
 * v0.9.2 - Collapse persistence, always-on strike count, motion polish, UX:
 *          - Collapsed/expanded state per expiration now PERSISTS in
 *            localStorage (COLLAPSE_KEY), keyed by symbol, and re-hydrates on
 *            reload / when switching tickers (loadCollapsed/saveCollapsed).
 *          - The "(N strikes)" count in each expiration header is now shown
 *            ALWAYS (both collapsed and expanded), not only when collapsed.
 *          - MOTION POLISH (index.css): app-wide quick transitions on buttons/
 *            inputs/links, subtle active-press feedback, an accordion "expand"
 *            animation for a section's body, and a prefers-reduced-motion guard.
 *          - Ticker text input and the Static-cache ticker <select> now share
 *            the SAME fixed width (w-44) for a consistent, easy click target.
 *          - After picking an expiration chip, focus jumps to the Load button
 *            (via loadBtnRef) and the selector is a <form>, so pressing Enter
 *            loads immediately without clicking Load.
 * v0.9.1 - Sticky-header opacity fix + centered expiration + collapse feature:
 *          - BUG: dark-mode sticky header used semi-transparent rgba tints
 *            (alpha 0.4/0.6) so scrolled body rows bled through. All header
 *            backgrounds (neutral, Calls/Puts group tints, and the Expiration
 *            row) are now FULLY OPAQUE in both light & dark (index.css).
 *          - BUG: the Expiration row was left-aligned; it is now CENTERED in the
 *            full-width top sticky row.
 *          - FEATURE: each expiration section can be COLLAPSED/expanded (click
 *            its centered header row; a chevron shows state and, when collapsed,
 *            a "(N strikes)" hint). Added a Collapse-all / Expand-all toggle
 *            above the desk. Collapsed sections hide rows 2-3 + body.
 * v0.9.0 - Cache management UI (Settings) + synced infra edits:
 *          - Settings → Cache panel shows live STATS: number of cached data
 *            records, data bytes used vs CACHE_MAX_BYTES (with a usage bar),
 *            settings blob size, and oldest/newest record timestamps.
 *          - THREE clear actions (each two-click confirm):
 *              * Clear data     -> removes only queried-data cache (keeps settings)
 *              * Clear settings -> removes only persisted settings (keeps data),
 *                                  and resets in-memory settings to defaults
 *              * Clear everything -> wipes all "gex.*" localStorage keys
 *            Implemented via cacheStats(), clearCacheData(), clearSettingsStore(),
 *            clearAll(); also clears the in-memory bulkCache where relevant.
 *          - Synced user infra edits: proxy startup log columns aligned to
 *            "Yahoo | / CBOE | / NASDAQ |"; GitHub Action switched to uv +
 *            actions/checkout@v7 + astral-sh/setup-uv with an 8-slot weekday
 *            cron and REQUEST_SLEEP=1.
 *          - NOTE (answering a question): CBOE/NASDAQ/marketdata are BULK — one
 *            "Get dates" request downloads the whole chain (all expirations) and
 *            caches it, so "Load" filters from cache with NO extra network call
 *            (hence no proxy log). Lazy providers (Yahoo/DoltHub) DO log on the
 *            first Load of each expiration, then serve from cache.
 * v0.8.0 - Multi-expiration desk, sticky 3-row header, persistent cache,
 *          local-first ordering, NASDAQ provider, proxy request logging:
 *          - MULTI-EXPIRATION: pick one or MANY expirations (checkbox chips +
 *            All/None); they render stacked EARLIEST→LATEST, each as its own
 *            table section. State moved from a single `selectedExp`/`expQuotes`
 *            to `selectedExps[]` + `expData{exp:quotes}`; loadChain fetches all
 *            selected (bulk = one cached call, lazy = per-exp cached).
 *          - STICKY HEADER FIX: the header is now THREE stacked, non-overlapping
 *            sticky rows — [Expiration] / [Calls|Strike|Puts] / [column labels]
 *            — via fixed-height rows and per-row `top` offsets in index.css
 *            (.od-hrow-1/2/3). Previously both rows used top:0 and clashed.
 *          - PERSISTENT QUERY CACHE (localStorage) with SIZE-AWARE LRU eviction:
 *            every successful query is stored; before writing we evict the
 *            OLDEST records until it fits under CACHE_MAX_BYTES, and on
 *            QuotaExceededError we drop-oldest-and-retry. Survives reloads.
 *          - LOCAL-FIRST ORDERING: on localhost / 127.x / 0.0.0.0 / LAN the
 *            provider list is REVERSED (CBOE, NASDAQ, Yahoo first — you have the
 *            proxy running); on hosted (GitHub Pages) the no-setup order stays.
 *          - NEW PROVIDER "NASDAQ" (proxy, no key): full chain (all expirations)
 *            in one call; parses OCC ids from drillDownURL; spot from lastTrade.
 *          - PROXY LOGGING: the Bun proxy & Worker now log each relay as
 *            "$proxy | $localPath -> $remoteUrl" with a fixed-width proxy column
 *            (CBOE/YAHOO/NASDAQ). Added /api/nasdaq to both proxies.
 * v0.7.0 - Trim to privacy-friendly providers + fix DoltHub + CBOE local proxy:
 *          - REMOVED providers that need an account with sensitive sign-up or a
 *            paid/gated plan (per user request & live re-testing):
 *              * Tradier, Alpaca  -> require brokerage-style sign-up (SSN/ID).
 *              * Polygon/Massive  -> options snapshot NOT in the free plan
 *                (confirmed: "plan lacks the options snapshot").
 *              * Alpha Vantage    -> HISTORICAL_OPTIONS is now premium-gated; the
 *                free key returns the 25/day limit on the FIRST call, so it is
 *                effectively unusable for options. Dropped.
 *          - REMAINING providers (works-first, all no-account or same-origin):
 *            marketdata (AAPL keyless), Static cache, DoltHub, Yahoo(proxy),
 *            CBOE(proxy).
 *          - FIXED DoltHub "hangs then network error": the correlated
 *            `MAX(date)` subquery scanned the 5.63GB DB and timed out (>25s).
 *            Verified the archive is frozen at 2024-11-11, so we now HARDCODE
 *            DOLT_LATEST_DATE and filter by the indexed date -> <1s responses.
 *            Added sqlLit() to escape SQL string literals.
 *          - CBOE can now use a REQUEST-HANDLING PROXY BASE ({base}/api/cboe),
 *            same pattern as Yahoo — so the local Bun server / Worker relays it.
 *            Falls back to the generic CORS-proxy template if no base is set.
 * v0.6.0 - Added Polygon/Massive + DoltHub providers (investigated on request):
 *          - Polygon.io (rebranded Massive.com on 2025-10-30; api.polygon.io
 *            still works) [BULK, free key]. Endpoint
 *            /v3/snapshot/options/{TICKER}?limit=250&apiKey=KEY (paginated via
 *            next_url). Free "Options Basic": 5 req/min, 15-min delayed, no card.
 *            Returns greeks/IV/OI + underlying price + full contract details, so
 *            no OCC parsing needed. apiKey passed as QUERY PARAM to avoid a CORS
 *            preflight. next_url carries a cursor but not the key -> we re-append.
 *          - DoltHub dolthub/options [LAZY, no key]. SQL-over-HTTP:
 *            GET /api/v1alpha1/dolthub/options/master?q=<SQL>. Verified live: the
 *            option_chain table has date/expiration/strike/call_put/bid/ask/vol/
 *            delta/gamma/theta/vega/rho (NO volume/OI, NO spot -> parity est.).
 *            IMPORTANT: it is a FROZEN HISTORICAL ARCHIVE (last date ≈2024-11-11),
 *            excellent for research/backtesting but NOT live. Honors the CBOE
 *            proxy template ({url}) so a Worker /raw can bypass any CORS block.
 *          - PROVIDERS reordered works-first with the two additions:
 *            marketdata, static, dolthub, yahoo, tradier, alpaca, polygon,
 *            alphavantage, cboe.
 * v0.5.0 - Alpaca provider (KEY + SECRET, both in localStorage):
 *          - Added the Alpaca Market Data provider (BULK). Endpoint
 *            data.alpaca.markets/v1beta1/options/snapshots/{SYMBOL}
 *            ?feed=indicative&limit=1000 (paginated via next_page_token, capped).
 *          - Verified live vs a github.io origin: CORS:* on GET AND preflight,
 *            with the two auth headers (APCA-API-KEY-ID / APCA-API-SECRET-KEY)
 *            explicitly allow-listed => works directly from a static site.
 *          - GENERALIZED CREDENTIALS: providers may now require a KEY + SECRET
 *            pair (supportsSecret/keyLabel/secretLabel). Both are persisted per
 *            provider in localStorage (settings.secrets), exactly like the single
 *            token — no backend needed for a personal static app (user's call).
 *          - Settings + onboarding render a second (secret) field when required;
 *            the "Key set" badge now requires BOTH parts for secret providers.
 *          - Free Alpaca "Basic" plan needs feed=indicative (OPRA real-time is
 *            paid, returns 403). Greeks/IV inline; OTM/0DTE may omit greeks; no
 *            spot -> UI estimates via put-call parity.
 *          - getDates() gained a credsOverride param so onboarding can retry with
 *            just-entered creds without waiting for the settings state to commit.
 * v0.4.0 - "Works-first" defaults, deferred loading, cancel, +2 providers:
 *          - DEFAULT is now marketdata.app (AAPL loads with ZERO setup — the
 *            one thing confirmed working out of the box). Providers are ordered
 *            works-first: no-setup → key-required → proxy-required.
 *          - DEFERRED LOADING (no wasted quota on page open): the app no longer
 *            auto-fetches. Flow is explicit and two-step:
 *              1) type a ticker → "Get dates" loads ONLY expirations (+spot),
 *              2) pick an expiration → "Load" fetches that expiration's chain.
 *            For BULK providers the single "Get dates" request already contains
 *            every expiration (cached); "Load"/expiration-switch is then free.
 *          - CANCEL BUTTON: every request is abortable via AbortController; a
 *            visible Cancel appears while loading, so you can bail and switch
 *            provider/ticker. Aborts are shown as a calm notice, not an error.
 *          - NEW PROVIDER "Static cache (data.json)" [BULK, no setup]: reads the
 *            site's OWN ./data/options/{TICKER}.json (produced by the GitHub Action +
 *            scripts/options-data.py, yfinance). 100% CORS-free on GitHub Pages,
 *            no keys. Ships with a ticker picker sourced from ./data/options/index.json.
 *          - NEW PROVIDER "Yahoo (via proxy)" [LAZY, needs proxy base]: calls a
 *            small proxy that handles Yahoo's crumb/cookie flow — either the
 *            local Bun server (scripts/options-local-proxy.ts, default
 *            http://localhost:8787) or a deployed Cloudflare Worker
 *            (scripts/options-cloudflare-proxy.js). Endpoint:
 *            GET {base}/api/options?symbol=X[&date=YYYY-MM-DD].
 *          - Settings gained a "Proxy base URL" field (for Yahoo/worker) and the
 *            existing CBOE CORS-proxy dropdown now also accepts a custom Worker
 *            "/raw?url={url}" template.
 *          - RESEARCH refresh (verified live vs a github.io origin): Finnhub's
 *            /stock/option-chain is now PREMIUM-only (free tier lost it). Alpaca
 *            options have CORS:* but require two keys (id+secret) => browser-
 *            unsafe for a public static site; noted for the Worker path instead.
 * v0.3.0 - Added Tradier Sandbox + bulk/lazy provider modes (was default).
 *          - Verified vs github.io origin: CBOE no CORS (+403 preflight);
 *            Fidelity has no retail API; Yahoo crumb-locked; Google Finance API
 *            discontinued; Barchart no free tier; Nasdaq no CORS. CORS:* winners:
 *            Tradier, marketdata, Alpha Vantage, Twelve Data, Finnhub.
 *          - bulk (one-shot, cached) vs lazy (per-expiration) provider modes;
 *            loadMeta()/loadExpiration() dispatch; asArray() for Tradier quirks.
 * v0.2.0 - Stability & UX overhaul (CORS pain fix): proxies fronting CBOE were
 *          unreliable; made marketdata (AAPL keyless) work, Alpha Vantage as
 *          instant-key, CBOE proxy-only; friendly onboarding + error mapping +
 *          retry + put-call-parity spot estimate + per-provider stored keys.
 * v0.1.0 - Initial baseline: debug system, persistent settings, theme
 *          controller (light/dark/system), DataProvider abstraction, top bar
 *          (brand + API dropdown + theme + gear), ticker search with shake,
 *          expiration strip, Calls|Strike|Puts table, OCC symbol parser.
 * ---------------------------------------------------------------------------
 *
 * COMPANION INFRASTRUCTURE (optional; outside the 3 app source files):
 *   - scripts/options-data.py           yfinance -> data/options/*.json + data/options/index.json
 *   - .github/workflows/update-data.yml   schedules the fetch + commits JSON
 *   - scripts/options-local-proxy.ts          local Bun proxy (Yahoo/NASDAQ/CBOE/search)
 *   - scripts/options-cloudflare-proxy.js    deployable proxy (Yahoo/NASDAQ/CBOE/search/raw)
 *
 * WHY THESE API CHOICES (research summary, keep for future agents):
 *   - Dropdown order is fixed: CACHE, CBOE, NASDAQ, YAHOO.
 *   - CACHE (static): same-origin data/options/*.json -> zero CORS/keys.
 *     DEFAULT selection on hosted/static deploys (GitHub Pages).
 *   - CBOE (via proxy): richest no-key delayed data (greeks/IV/OI/spot).
 *     DEFAULT selection on localhost/LAN when proxy is expected.
 *   - NASDAQ (via proxy): free full-chain, no browser CORS; no IV/greeks in feed.
 *   - YAHOO (via proxy): crumb/cookies handled by companion proxy; lazy per-exp.
 *   - Removed from registry (changelog only): marketdata.app, DoltHub, Tradier,
 *     Alpaca, Alpha Vantage, Polygon/Massive, Finnhub/Twelve Data, etc.
 *
 * DATA FLOW (deferred):
 *   [Get dates] -> loadMeta(symbol) -> ChainMeta{ underlyingPrice, expirations }
 *   [Load]      -> loadExpiration(symbol, exp) -> OptionQuote[] (cached for bulk)
 *               -> (fallback) estimate spot via put-call parity if missing
 *               -> render selected expiration as Calls | Strike | Puts.
 *
 * EXTENSION POINTS (for future features / agents):
 *   - Add a provider: implement DataProvider (bulk or lazy) & push to PROVIDERS.
 *   - Greeks columns / payoff chart: OptionQuote already carries the greeks.
 * ============================================================================
 */

// @ts-ignore -- resolved by the Parcel/Bun build toolchain (see ENVIRONMENT above)
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
// @ts-ignore
import { createRoot } from 'react-dom/client';
import { pickExpirations } from './expiration-select';
import { AttributionFooter, RepoFooter } from './components/AttributionFooter';
import type { ChainSection } from './components/ChainTable';
import { ExpirationChips } from './components/ExpirationChips';
import { type AppTab, TabSwitcher } from './components/TabSwitcher';
import { TopBar } from './components/TopBar';
import { DEFAULT_LANGUAGE, I18nProvider, useI18n } from './i18n';
import { ctxFor, PROVIDERS, suggestTickers } from './providers';
import { getBulk, loadExpiration, loadMeta } from './providers/loader';
import { clearAll, clearCacheData, clearSettingsStore, freshDefaultSettings, hasPersistedSettings, loadSettings, saveSettings } from './settings-store';
import { accentOf, useThemeController } from './theme';
import type { ChainMeta, OptionQuote, Settings, TickerSuggestion } from './types';
import { useGexLevels } from './use-gex-levels';
import { dbg, estimateSpot, friendlyError, isAbortError } from './utils';
import { DeskView } from './views/DeskView';
import { type ChartRange, DEFAULT_RANGE } from './views/chart-range';
import type { GexMetric } from './views/GexView';

// GEX tab is code-split: recharts (~500 KB minified) loads only when the tab
// is first opened, so the Desk's initial bundle stays as small as before.
const GexView = lazy(() => import('./views/GexView').then((m) => ({ default: m.GexView })));
// Chart tab is code-split the same way: lightweight-charts loads on first open.
const ChartView = lazy(() => import('./views/ChartView').then((m) => ({ default: m.ChartView })));

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================

const App: React.FC = () => {
    const { t: tr, lang } = useI18n();
    // Captured once, synchronously, in the same render as the first
    // loadSettings() call below — BEFORE anything in this session can write
    // a fresh settings record. This is the boot-time "is there something to
    // restore" check the restore effect (further down) gates its one-time
    // ticker/expirations fetch on: a brand-new user has no record at all, so
    // this is false and the restore effect does nothing, leaving tickerInput/
    // activeTab/gexMetrics exactly at DEFAULT_SETTINGS (identical to today's
    // first load). `lastTicker`'s VALUE can't be used for this check instead
    // — a returning user who genuinely loaded AAPL looks identical to a
    // brand-new user's default 'AAPL' — only "was a record ever written" is
    // a reliable signal.
    const [hasPersistedState] = useState<boolean>(() => hasPersistedSettings());
    // ---- Settings state (persisted) ----------------------------------------
    const [settings, setSettings] = useState<Settings>(() => loadSettings());
    const patchSettings = useCallback((patch: Partial<Settings>) => {
        setSettings((prev) => {
            const next = { ...prev, ...patch };
            saveSettings(next);
            return next;
        });
    }, []);
    const setToken = useCallback((providerId: string, token: string) => {
        setSettings((prev) => {
            const next = { ...prev, tokens: { ...prev.tokens, [providerId]: token } };
            saveSettings(next);
            return next;
        });
    }, []);
    /** Set (or clear) the API secret for a KEY+SECRET provider (e.g. Alpaca). */
    const setSecret = useCallback((providerId: string, secret: string) => {
        setSettings((prev) => {
            const next = { ...prev, secrets: { ...prev.secrets, [providerId]: secret } };
            saveSettings(next);
            return next;
        });
    }, []);

    useThemeController(settings.theme, settings.colorTheme);
    // Used by the shared expiration-panel Load button (rendered in the same
    // row as TabSwitcher's tab pills, below), mirroring what DeskView used to
    // compute itself.
    const ax = accentOf(settings.colorTheme);

    // Active content tab below TopBar. Persisted in Settings (reversing an
    // earlier phase's deliberate choice to keep this transient — the user
    // now explicitly wants a reload to land back where they were). Lazy-init
    // reads settings.activeTab directly: for a brand-new user that's just
    // DEFAULT_SETTINGS.activeTab ('desk'), identical to the old hardcoded
    // default; for a returning user it's whatever tab they were last on.
    // changeTab (below, near the render) is what actually persists a change.
    const [activeTab, setActiveTab] = useState<AppTab>(() => settings.activeTab);
    const changeTab = useCallback((tab: AppTab) => {
        setActiveTab(tab);
        patchSettings({ activeTab: tab });
    }, [patchSettings]);

    // Proxy health probe (LIVE providers only; CACHE mutes indicators).
    const [proxyOk, setProxyOk] = useState<boolean | null>(null);
    const [proxyChecking, setProxyChecking] = useState(false);
    useEffect(() => {
        if (settings.providerId === 'static') {
            setProxyOk(null);
            setProxyChecking(false);
            return;
        }
        const base = (settings.proxyBase || '').replace(/\/$/, '');
        if (!base) { setProxyOk(false); return; }
        let cancelled = false;
        setProxyChecking(true);
        const ac = new AbortController();
        const timer = window.setTimeout(() => ac.abort(), 4000);
        fetch(`${base}/health`, { signal: ac.signal })
            .then((r) => { if (!cancelled) setProxyOk(r.ok); })
            .catch(() => { if (!cancelled) setProxyOk(false); })
            .finally(() => {
                window.clearTimeout(timer);
                if (!cancelled) setProxyChecking(false);
            });
        return () => { cancelled = true; ac.abort(); window.clearTimeout(timer); };
    }, [settings.providerId, settings.proxyBase]);


    // Sync the i18n context with persisted language changes (and vice versa).
    const { setLang } = useI18n();
    useEffect(() => { setLang(settings.language); }, [settings.language, setLang]);

    const provider = useMemo(
        () => PROVIDERS.find((p) => p.id === settings.providerId) ?? PROVIDERS[0],
        [settings.providerId],
    );

    // ---- Chain data state (DEFERRED loading; nothing fetches on mount) ------
    const [tickerInput, setTickerInput] = useState<string>(settings.lastTicker);
    const [meta, setMeta] = useState<ChainMeta | null>(null);      // set by "Expirations"
    // MULTIPLE selected expirations (set by checkboxes); loaded top→bottom.
    const [selectedExps, setSelectedExps] = useState<string[]>([]);
    // Loaded quotes per expiration: { "YYYY-MM-DD": OptionQuote[] }.
    const [expData, setExpData] = useState<Record<string, OptionQuote[]>>({});
    const [chainSymbol, setChainSymbol] = useState<string>('');    // symbol the table reflects
    const [metaLoading, setMetaLoading] = useState<boolean>(false);
    const [expLoading, setExpLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [notice, setNotice] = useState<string>('');              // calm info (e.g. cancelled)
    const [errorNonce, setErrorNonce] = useState<number>(0);
    // Ticker suggestions: provider-native search when available; otherwise data/options/index.json fallback.
    const [tickerSuggestions, setTickerSuggestions] = useState<TickerSuggestion[]>([]);
    const [tickerSuggestionsLoading, setTickerSuggestionsLoading] = useState<boolean>(false);
    const [tickerSuggestionsOpen, setTickerSuggestionsOpen] = useState<boolean>(false);
    const [activeTickerSuggestion, setActiveTickerSuggestion] = useState<number>(-1);
    // AbortControllers so the Cancel button can stop in-flight requests.
    const metaAbort = useRef<AbortController | null>(null);
    const expAbort = useRef<AbortController | null>(null);
    // Focused after confirming a ticker so Space/Enter triggers Expirations.
    const getDatesBtnRef = useRef<HTMLButtonElement | null>(null);
    // Focused after picking an expiration so Enter immediately triggers Load.
    const loadBtnRef = useRef<HTMLButtonElement | null>(null);

    const anyLoading = metaLoading || expLoading;

    /** Cancel whatever request is in flight. */
    const cancelAll = useCallback(() => {
        metaAbort.current?.abort();
        expAbort.current?.abort();
        setMetaLoading(false);
        setExpLoading(false);
        setNotice('Request cancelled.');
        dbg('cancelAll');
    }, []);

    /** Reset the loaded view when provider or ticker context changes. */
    const resetView = useCallback(() => {
        setMeta(null);
        setExpData({});
        setSelectedExps([]);
        setChainSymbol('');
        setError('');
        setNotice('');
    }, []);

    // Load ticker suggestions as the user types. Provider-native search is used
    // when supported (Yahoo/NASDAQ/CBOE proxy, DoltHub SQL); otherwise, or when
    // the proxy/search request fails, suggestions fall back to data/options/index.json.
    useEffect(() => {
        let cancelled = false;
        const ac = new AbortController();
        const query = tickerInput.trim();
        const delay = query ? 180 : 0; // instant first cached list, debounce typed search
        setActiveTickerSuggestion(-1);
        const timer = window.setTimeout(() => {
            setTickerSuggestionsLoading(true);
            suggestTickers(provider, query, ctxFor(settings, provider, ac.signal))
                .then((items) => {
                    if (cancelled) return;
                    setTickerSuggestions(items);
                })
                .catch((e) => {
                    if (!cancelled && !isAbortError(e)) setTickerSuggestions([]);
                })
                .finally(() => {
                    if (!cancelled) setTickerSuggestionsLoading(false);
                });
        }, delay);
        return () => { cancelled = true; ac.abort(); window.clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provider.id, tickerInput, settings.proxyBase, settings.proxyTemplate, settings.workerUrl]);

    // Reset the view whenever the provider changes (deferred: no auto-fetch).
    useEffect(() => {
        resetView();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provider.id]);

    /**
     * STEP 1 — "Expirations": load ONLY expirations (+ spot). No chain yet.
     * `credsOverride` lets the onboarding pass just-entered key/secret without
     * waiting for the async settings state to commit (avoids a stale-closure race).
     * Returns the fetched ChainMeta on success, or null on any failure/abort/
     * empty-ticker — callers that only fire-and-forget (the Search button,
     * onboarding preview) already ignored the old implicit `undefined`
     * return, so this is purely additive. The restore effect below is the
     * first caller that actually uses the return value: it needs to know
     * whether the SAME fetch path a manual search uses succeeded before it
     * can intersect the persisted expiration selection against real data.
     */
    // Latest selection, read by getDates (a useCallback) when the user switches to another ticker.
    const selectedExpsRef = useRef<string[]>([]);
    selectedExpsRef.current = selectedExps;
    const getDates = useCallback(async (symbol: string, credsOverride?: { token?: string; secret?: string }): Promise<ChainMeta | null> => {
        const sym = symbol.trim().toUpperCase();
        setError('');
        setNotice('');
        if (!sym) {
            setError(tr('error.enterTicker'));
            setErrorNonce((n) => n + 1);
            return null;
        }
        const ac = new AbortController();
        metaAbort.current = ac;
        setMetaLoading(true);
        // Clear any previous chain so the UI reflects the new symbol cleanly.
        setExpData({});
        setChainSymbol('');
        try {
            const ctx = ctxFor(settings, provider, ac.signal);
            if (credsOverride?.token != null) ctx.token = credsOverride.token;
            if (credsOverride?.secret != null) ctx.secret = credsOverride.secret;
            const m = await loadMeta(provider, sym, ctx, settings.vixFuturesPricing);
            if (ac.signal.aborted) return null;
            if (m.expirations.length === 0) throw new Error(tr('error.noContracts', { symbol: sym }));
            setMeta(m);
            // Keep the previous selection when the new ticker has it, else everything inside its
            // date range, else the nearest expiration (pickExpirations, expiration-select.ts).
            const picked = pickExpirations(selectedExpsRef.current, m.expirations);
            setSelectedExps(picked);
            patchSettings({ lastTicker: m.symbol, selectedExps: picked });
            dbg('getDates ok', { expirations: m.expirations.length });
            return m;
        } catch (e: unknown) {
            if (isAbortError(e)) { setNotice(tr('notice.cancelled')); return null; }
            setMeta(null);
            setError(friendlyError(e, provider, lang));
            setErrorNonce((n) => n + 1);
            dbg('getDates error', e);
            return null;
        } finally {
            if (metaAbort.current === ac) { setMetaLoading(false); metaAbort.current = null; }
        }
    }, [provider, settings, patchSettings]);

    /**
     * BOOT-TIME RESTORE (UI-state persistence, user request: "if I refreshed
     * a page or opened after close, is it possible to keep this"). Runs this
     * exact sequence, fully automatically and silently — no confirmation
     * prompt, matching the user's framing of it as something that should
     * "just happen":
     *   1. activeTab/gexMetrics are already restored by this point (their
     *      useState lazy initializers above read straight from `settings`).
     *   2. If `hasPersistedState` is true (a settings record already existed
     *      at mount — see its declaration above), replay the SAME fetch path
     *      a manual ticker search uses (`getDates`, unchanged) for the
     *      persisted `lastTicker`.
     *   3. Once that resolves with real expirations, intersect the persisted
     *      `selectedExps` against them — a stale selection may name
     *      expirations that no longer exist for this ticker today — and
     *      adopt the intersection ONLY if it's non-empty. An empty
     *      intersection falls through to getDates' own default (nearest
     *      expiration), which it already set + persisted before this effect
     *      ever inspects the result.
     *   4. Any failure (bad ticker, network/proxy down, revoked token, ...)
     *      is handled entirely by getDates' own existing try/catch: meta
     *      stays null, an error message is shown, loading never gets stuck
     *      — i.e. the SAME safe/blank fallback a failed manual search
     *      already produces, not a new error path invented for this feature.
     * A brand-new user (hasPersistedState === false) skips step 2 onward
     * entirely: tickerInput/activeTab/gexMetrics are already at
     * DEFAULT_SETTINGS, so the first load is byte-for-byte identical to
     * today's.
     */
    const restoreSession = useCallback(async () => {
        const ticker = settings.lastTicker.trim();
        if (!ticker) return; // defensive; DEFAULT_SETTINGS.lastTicker is never empty in practice
        const persistedExps = settings.selectedExps;
        const m = await getDates(ticker);
        if (!m) return; // getDates already failed safely (error shown, meta stays null)
        const intersected = persistedExps.filter((exp) => m.expirations.includes(exp));
        if (intersected.length > 0) {
            setSelectedExps(intersected);
            patchSettings({ selectedExps: intersected });
        }
        // else: keep getDates' own default (nearest expiration) — already
        // set in state and persisted inside getDates itself.
    }, [getDates, settings.lastTicker, settings.selectedExps, patchSettings]);

    useEffect(() => {
        if (hasPersistedState) void restoreSession();
        // Intentionally run exactly ONCE, right after mount. Not depending on
        // `restoreSession` (which is recreated whenever settings/getDates
        // change) is deliberate — this must never re-fire later in the
        // session, only at boot.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * STEP 2 — "Load": fetch ALL selected expirations (earliest→latest) and
     * store each under expData[expiration]. Bulk providers fetch once (cached)
     * and each call just filters; lazy providers fetch per-expiration (cached).
     */
    const loadChain = useCallback(async () => {
        if (!meta || selectedExps.length === 0) return;
        setError('');
        setNotice('');
        const ac = new AbortController();
        expAbort.current = ac;
        setExpLoading(true);
        const ordered = [...selectedExps].sort(); // earliest -> latest
        const collected: Record<string, OptionQuote[]> = {};
        try {
            for (const exp of ordered) {
                const quotes = await loadExpiration(provider, meta.symbol, exp, ctxFor(settings, provider, ac.signal), settings.vixFuturesPricing);
                if (ac.signal.aborted) return;
                collected[exp] = quotes;
            }
            setExpData(collected);
            setChainSymbol(meta.symbol);
            const total = Object.values(collected).reduce((n, q) => n + q.length, 0);
            if (total === 0) setNotice(tr('notice.noContracts'));
            dbg('loadChain ok', { expirations: ordered.length, total });
        } catch (e: unknown) {
            if (isAbortError(e)) { setNotice(tr('notice.cancelled')); return; }
            setExpData({});
            setError(friendlyError(e, provider, lang));
            setErrorNonce((n) => n + 1);
            dbg('loadChain error', e);
        } finally {
            if (expAbort.current === ac) { setExpLoading(false); expAbort.current = null; }
        }
    }, [provider, settings, meta, selectedExps]);

    // Bulk providers (CACHE/CBOE/NASDAQ) already hold the whole chain in memory, so
    // loading the selected expirations costs nothing: do it whenever the selection
    // changes instead of waiting for the Load button. Desk and GEX then always show
    // the same data, whichever tab the selection was made on, and nothing has to be
    // loaded twice. Lazy providers (YAHOO) fetch per expiration over the network and
    // keep the explicit Load button, which loads the shared `expData` for BOTH tabs.
    const loadChainRef = useRef(loadChain);
    loadChainRef.current = loadChain;
    useEffect(() => {
        if (!meta || selectedExps.length === 0) return;
        expAbort.current?.abort();
        // Bulk data is in memory: load at once. Lazy (YAHOO) waits a moment so a quick run of
        // clicks on several dates becomes one load, and each date is already prefetched (below).
        const wait = provider.mode === 'bulk' ? 0 : 200;
        const timer = setTimeout(() => { void loadChainRef.current(); }, wait);
        return () => clearTimeout(timer);
        // loadChain itself is read through the ref: it is recreated on every settings change.
    }, [provider, meta, selectedExps]);

    // Lazy providers (YAHOO) fetch one expiration per request. As soon as the ticker is found,
    // fetch ALL its expirations in the background (selected ones first, then the rest), into the
    // persistent cache, so clicking any date shows data without a wait. Errors are ignored here:
    // clicking the date retries through loadChain and shows the error there.
    useEffect(() => {
        if (provider.mode !== 'lazy' || !meta) return;
        const ac = new AbortController();
        const ordered = [...meta.expirations].sort((a, b) => Number(selectedExpsRef.current.includes(b)) - Number(selectedExpsRef.current.includes(a)));
        void (async () => {
            for (const exp of ordered) {
                if (ac.signal.aborted) return;
                try { await loadExpiration(provider, meta.symbol, exp, ctxFor(settings, provider, ac.signal), settings.vixFuturesPricing); } catch { /* retried when the date is clicked */ }
            }
        })();
        return () => ac.abort();
        // settings are read once per ticker; a later settings change must not restart the prefetch.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provider, meta]);

    /** Toggle one expiration in the multi-select. The data loads by itself (the effect above), no
     *  Load button. Persists the resulting selection into Settings (selectedExps) so a reload
     *  restores it. */
    const toggleExpiration = useCallback((exp: string) => {
        setSelectedExps((prev) => {
            const next = prev.includes(exp) ? prev.filter((e) => e !== exp) : [...prev, exp];
            patchSettings({ selectedExps: next });
            return next;
        });
    }, [patchSettings]);

    /** Reset button of the expirations panel: back to the default selection, the nearest expiration. */
    const resetExpirations = useCallback(() => {
        if (!meta || meta.expirations.length === 0) return;
        setSelectedExps([meta.expirations[0]]);
        patchSettings({ selectedExps: [meta.expirations[0]] });
    }, [meta, patchSettings]);

    /** Wraps the shared ExpirationChips' "All"/"None" setter so that action
     *  also persists into Settings, same as toggleExpiration above. */
    const setSelectedExpsAndPersist = useCallback((next: string[]) => {
        setSelectedExps(next);
        patchSettings({ selectedExps: next });
    }, [patchSettings]);

    /** Move focus to Expirations (after ticker confirm) so Space/Enter activates it. */
    const focusGetDatesButton = useCallback(() => {
        // rAF: wait for React to commit closed dropdown / updated value.
        requestAnimationFrame(() => loadBtnRef.current?.focus());
    }, []);

    /** Choosing a suggestion (click, or arrows + Enter) loads that ticker right away, with the same
     *  expirations selected as before (see getDates). A ticker without options only shows the notice. */
    const chooseTickerSuggestion = useCallback((s: TickerSuggestion) => {
        setTickerInput(s.symbol);
        setTickerSuggestionsOpen(false);
        setActiveTickerSuggestion(-1);
        if (!s.hasOptions) {
            setNotice(tr('notice.noOptions', { symbol: s.symbol }));
            focusGetDatesButton();
            return;
        }
        setNotice('');
        void getDates(s.symbol);
    }, [focusGetDatesButton, getDates]);

    /** Keyboard navigation for the custom ticker suggestion popover. */
    const onTickerKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            setTickerSuggestionsOpen(false);
            setActiveTickerSuggestion(-1);
            return;
        }
        if (e.key === 'Enter') {
            // Enter loads the highlighted suggestion, or else the typed ticker, right away.
            e.preventDefault();
            if (tickerSuggestionsOpen && activeTickerSuggestion >= 0 && tickerSuggestions[activeTickerSuggestion]) {
                chooseTickerSuggestion(tickerSuggestions[activeTickerSuggestion]);
            } else {
                setTickerSuggestionsOpen(false);
                setActiveTickerSuggestion(-1);
                void getDates(tickerInput);
            }
            return;
        }
        if (!tickerSuggestionsOpen || tickerSuggestions.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveTickerSuggestion((i) => Math.min(i + 1, tickerSuggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveTickerSuggestion((i) => Math.max(i - 1, -1));
        }
    }, [tickerSuggestionsOpen, tickerSuggestions, activeTickerSuggestion, chooseTickerSuggestion, getDates, tickerInput]);

    // Whether the current provider+settings require a key for the typed ticker.
    const showOnboarding = useMemo(() => {
        const sym = tickerInput.trim().toUpperCase() || 'AAPL';
        return provider.needsKeyFor(sym, ctxFor(settings, provider)) && !meta && !metaLoading;
    }, [provider, settings, tickerInput, meta, metaLoading]);

    // ---- Derived table data: one section per loaded expiration -------------
    const sections: ChainSection[] = useMemo(() => {
        const exps = Object.keys(expData).sort(); // earliest -> latest
        return exps.map((expiration) => {
            const callMap = new Map<number, OptionQuote>();
            const putMap = new Map<number, OptionQuote>();
            const strikeSet = new Set<number>();
            for (const q of expData[expiration]) {
                strikeSet.add(q.strike);
                (q.side === 'call' ? callMap : putMap).set(q.strike, q);
            }
            return { expiration, calls: callMap, puts: putMap, strikes: Array.from(strikeSet).sort((a, b) => a - b) };
        });
    }, [expData]);
    const hasRows = sections.some((s) => s.strikes.length > 0);

    const spot = useMemo(() => {
        if (!meta) return null;
        if (meta.underlyingPrice != null) return meta.underlyingPrice;
        // Estimate from the earliest loaded expiration via put-call parity.
        const first = Object.keys(expData).sort()[0];
        return first ? estimateSpot(expData[first], first) : null;
    }, [meta, expData]);
    const spotIsEstimated = meta != null && meta.underlyingPrice == null && spot != null;

    // ---- GEX tab (Phase 3): reuses chain data already held, never fetches ----
    // Bulk providers (CACHE/CBOE/NASDAQ) already hold EVERY expiration in the
    // in-memory bulk cache once "Expirations" succeeds, so the GEX tab can
    // offer all of them. Lazy YAHOO only has what Desk loaded into expData.
    // getBulk is now async (IndexedDB-backed persistent cache), so this can no
    // longer be a plain useMemo — it's an effect + state, same
    // cancelled-flag pattern used for ticker suggestions above. In practice
    // the bulk entry is already sitting in the synchronous in-memory
    // bulkCache (warmed by loadMeta's putBulk call before meta is ever set
    // here), so this resolves within a tick with no visible loading state.
    const [gexQuotesByExp, setGexQuotesByExp] = useState<Record<string, OptionQuote[]>>({});
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!meta) { if (!cancelled) setGexQuotesByExp({}); return; }
            if (provider.mode === 'bulk') {
                const bulk = await getBulk(provider.id, meta.symbol, settings.vixFuturesPricing);
                if (cancelled) return;
                if (bulk) {
                    const byExp: Record<string, OptionQuote[]> = {};
                    for (const q of bulk.quotes) (byExp[q.expiration] ??= []).push(q);
                    setGexQuotesByExp(byExp);
                    return;
                }
            }
            if (!cancelled) setGexQuotesByExp(expData);
        })();
        return () => { cancelled = true; };
    }, [meta, provider, expData, settings.vixFuturesPricing]);
    // The GEX tab reads/writes the SAME `selectedExps` Desk uses (user request:
    // keep the expiration selection in sync between the Desk and GEX tabs,
    // not two independent copies). Desk already defaults a fresh chain's
    // selection to the nearest expiration (setSelectedExps([m.expirations[0]])
    // above), which is exactly the default the GEX tab used to compute
    // separately - so unifying the state needs no extra default logic here.
    // The shared expiration panel (below, in TabSwitcher's row) now offers the
    // FULL `meta.expirations` list on Desk and GEX alike - not the narrower
    // "already loaded" subset this used to compute as `gexExpirations` - since
    // its Load button is right there to fetch whatever's selected. Any
    // selected-but-not-yet-loaded expiration simply contributes no quotes
    // (quotesByExp[exp] ?? [] in useGexLevels); it does not error, just gives
    // an expectedly-incomplete analysis until Load is pressed.
    // Persisted in Settings (gexMetrics); lazy-init reads it directly, same
    // reasoning as `activeTab` above — a brand-new user's settings.gexMetrics
    // is DEFAULT_SETTINGS.gexMetrics (['netGex']), identical to the old
    // hardcoded default. changeGexMetrics (passed to GexView below) persists
    // every toggle.
    const [gexMetrics, setGexMetrics] = useState<GexMetric[]>(() => settings.gexMetrics);
    const changeGexMetrics = useCallback((metrics: GexMetric[]) => {
        setGexMetrics(metrics);
        patchSettings({ gexMetrics: metrics });
    }, [patchSettings]);
    // GexLevels computed ONCE here for the GEX tab's selection and shared by
    // the GEX and Chart tabs (plan 7.7 / 8.2) - no view recomputes them.
    const gex = useGexLevels(spot, spotIsEstimated, gexQuotesByExp, selectedExps, meta?.symbol ?? '', settings.vixFuturesPricing);
    // Chart tab range (plan 8.2), held here so it survives tab switches.
    const [chartRange, setChartRange] = useState<ChartRange>(DEFAULT_RANGE);

    // Onboarding preview: provider demo ticker, else jump to CACHE + AAPL.
    const onboardingPreview = useCallback(() => {
        if (provider.demoSymbol) {
            setTickerInput(provider.demoSymbol);
            getDates(provider.demoSymbol);
        } else {
            patchSettings({ providerId: 'static', lastTicker: 'AAPL' });
            setTickerInput('AAPL');
        }
    }, [provider, getDates, patchSettings]);
    const previewLabel = provider.demoSymbol
        ? tr('onboarding.previewDemo', { symbol: provider.demoSymbol })
        : tr('onboarding.previewCache');

    const showTickerSuggestions = tickerSuggestionsOpen && (tickerSuggestionsLoading || tickerSuggestions.length > 0);

    // ---- Render ------------------------------------------------------------
    // `h-dvh` (NOT `min-h-screen`): a `min-height` is only a FLOOR - it lets this
    // root grow taller than the viewport for free, but never gives the flex
    // chain below a DEFINITE height to redistribute. `flex-grow`/`flex-1` only
    // ever redistributes space that's already bounded from above; with no real
    // cap here, every nested `flex-1 min-h-0` down to ChainTable's own scroll
    // container had nothing to clamp against, so `overflow-auto` never actually
    // engaged (confirmed live: its clientHeight rendered equal to its full,
    // uncapped content height, not the remaining viewport space) - the chain
    // table just grew to fit ALL its rows and the whole page scrolled past one
    // viewport instead of the table scrolling internally. `h-dvh` gives this
    // root a true, dynamic-viewport-aware height (handles mobile browser
    // chrome collapse the same way the old `100dvh` calc intended to), so
    // every `flex-1 min-h-0` descendant now resolves a real pixel height and
    // the innermost `overflow-auto` finally clamps correctly.
    return (
        <div className="h-dvh flex flex-col">
            <TopBar
                settings={settings}
                provider={provider}
                onChange={patchSettings}
                onSetToken={setToken}
                onSetSecret={setSecret}
                onClearData={async () => { await clearCacheData(); resetView(); }}
                onClearSettings={() => {
                    clearSettingsStore();
                    const fresh = freshDefaultSettings();
                    setSettings(fresh);
                    // activeTab/gexMetrics are local state mirrors of Settings
                    // (for the same reason tickerInput mirrors lastTicker) —
                    // "resets in-memory settings to defaults" must reset these too.
                    setActiveTab(fresh.activeTab);
                    setGexMetrics(fresh.gexMetrics);
                    resetView();
                }}
                onClearAll={async () => {
                    await clearAll();
                    const fresh = freshDefaultSettings();
                    setSettings(fresh);
                    setActiveTab(fresh.activeTab);
                    setGexMetrics(fresh.gexMetrics);
                    resetView();
                }}
                tickerInput={tickerInput}
                onTickerInput={setTickerInput}
                onSearch={() => getDates(tickerInput)}
                searching={metaLoading}
                tickerSuggestions={tickerSuggestions}
                tickerSuggestionsOpen={tickerSuggestionsOpen}
                tickerSuggestionsLoading={tickerSuggestionsLoading}
                activeTickerSuggestion={activeTickerSuggestion}
                onTickerFocus={() => setTickerSuggestionsOpen(true)}
                onTickerBlur={() => window.setTimeout(() => setTickerSuggestionsOpen(false), 120)}
                onTickerKeyDown={onTickerKeyDown}
                onChooseSuggestion={chooseTickerSuggestion}
                setActiveTickerSuggestion={setActiveTickerSuggestion}
                setTickerSuggestionsOpen={setTickerSuggestionsOpen}
                proxyOk={proxyOk}
                proxyChecking={proxyChecking}
            />

            {/* flex-1: grows to fill whatever height TopBar (fixed) doesn't use, so the
                footer below is pushed to the bottom of the viewport on a short/empty
                tab (e.g. Chart with no proxy running) instead of floating right under
                a short content block - same visual anchor point as a tall tab like Desk
                with real data loaded, where this div's own content already pushes the
                footer there anyway.
                `flex flex-col` makes this div an actual flex column (not just a flex
                ITEM) so the Desk wrapper below can in turn use its own `flex-1
                min-h-0` to claim exactly the remaining space after TabSwitcher's nav
                row - see ChainTable.tsx's doc comment on `.table-container` for why
                this replaced a hardcoded `100dvh - Npx` calc there.
                `min-h-0` is applied HERE conditionally (only while Desk is the active
                tab) - TWO prior attempts at this, both wrong, found live via
                Playwright measuring the GEX tab:
                  1. No `min-h-0` anywhere on this div: Desk's own `flex-1 min-h-0`
                     chain (hidden wrapper -> `<main>` -> ChainTable) never got a
                     DEFINITE height to size against (this div's automatic min-height
                     was based on the hidden desk wrapper's full, un-clamped content),
                     so ChainTable's `overflow-auto` never engaged at all - its
                     `clientHeight` measured equal to its full, un-clamped
                     `scrollHeight` (the whole multi-thousand-row chain), and the
                     WHOLE PAGE scrolled past one viewport instead of the table
                     scrolling internally.
                  2. `min-h-0` unconditionally: fixed Desk, but `min-h-0` strips a
                     flex item's default `min-height: auto` PROTECTION uniformly for
                     EVERY child of this div, not just the one that wants to shrink -
                     so it also let the root's flex layout shrink GEX/Chart's tab-
                     content block below their own real content height (e.g.
                     GexView's recharts panel + stacked sidebar at narrow widths,
                     which have no `overflow-auto` of their own and were never meant
                     to be clamped). Confirmed live: the footer ended up positioned
                     at THIS div's artificially-shrunk height while GEX's actual
                     content rendered past/over it.
                Conditioning `min-h-0` on `activeTab === 'desk'` gives each tab
                exactly what it needs: while Desk is active, the Desk-only wrapper's
                OWN `min-h-0` (below) can shrink/size ChainTable correctly, and GEX/
                Chart aren't even mounted so stripping protection here is moot; while
                GEX/Chart are active, this div keeps its default `min-height: auto`,
                so their real content height correctly protects them from being
                shrunk (and the Desk wrapper is `display:none`, so its own `min-h-0`
                contributes 0 to this div's automatic minimum either way). `shrink-0`
                below on the nav wrapper and each tab-content block is additional,
                redundant insurance against shrinking - only the Desk wrapper (next)
                actually wants to be shrinkable. */}
            <div className={`flex-1 flex flex-col ${activeTab === 'desk' ? 'min-h-0' : ''}`}>
            <div className="shrink-0">
            <TabSwitcher
                value={activeTab}
                onChange={changeTab}
                colorTheme={settings.colorTheme}
                /* ---- Shared expiration panel (picker + Load) — one copy, used
                    by Desk AND GEX (not Chart - it doesn't act on expirations),
                    rendered in the SAME row as the tab pills, to their right -
                    one horizontal bar: [Desk|GEX|Chart]  [chips... All] [Load].
                    So selecting expirations and fetching them works the same
                    way on either tab (user request: GEX had no Load button of
                    its own, so a lazy YAHOO expiration picked from the GEX tab
                    had no way to actually be fetched). Offers the FULL
                    `meta.expirations` list (not just already-loaded dates -
                    see the gexQuotesByExp comment above); only rendered once a
                    ticker's expirations are loaded (`meta` exists), same gate
                    as the old Desk-only form. A <form> so pressing Enter (once
                    the Load button is focused after picking a date) submits
                    and loads immediately. flex-wrap on TabSwitcher's row (and
                    on this form itself) + the widened chip-strip cap
                    (ExpirationChips, max-w-[70vw]) fix the chip-row overflow
                    bug: at narrow widths the form now wraps to its own line
                    below the tab pills, and the Load button wraps within the
                    form, instead of being clipped past the right edge of the
                    viewport (confirmed live via Playwright before this fix -
                    see ExpirationChips.tsx's doc comment for the measured
                    root cause). ---- */
                endSlot={meta && activeTab !== 'chart' ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5">
                        <ExpirationChips
                            expirations={meta.expirations}
                            selected={selectedExps}
                            onToggle={toggleExpiration}
                            onSetAll={setSelectedExpsAndPersist}
                            colorTheme={settings.colorTheme}
                        />
                        <button
                            ref={loadBtnRef}
                            type="button"
                            onClick={resetExpirations}
                            disabled={meta.expirations.length === 0}
                            title={tr('controls.resetTooltip')}
                            className={'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ' + ax.chipIdle}
                        >
                            {tr('controls.reset')}
                        </button>
                    </div>
                ) : null}
            />
            </div>

            {/* Desk stays MOUNTED while another tab is shown (just hidden), so
                ChainTable's local state (collapsed sections, active expiration,
                scroll position) survives a tab round-trip.
                `flex-1 min-h-0` (NOT a `display`-setting class like `flex`/`block` -
                those would fight the `hidden` attribute's `display: none` at equal
                specificity): while visible, this claims the remaining vertical space
                in the flex column above so DeskView's <main> can resolve `h-full`
                against a real pixel height, letting ChainTable size its own scroll
                region via flex instead of a hardcoded dvh calc. While hidden,
                `display: none` drops it from layout entirely as before - flex-1/
                min-h-0 don't touch `display`, so they never override `hidden`. */}
            <div hidden={activeTab !== 'desk'} className="flex-1 min-h-0">
                <DeskView
                    settings={settings}
                    provider={provider}
                    meta={meta}
                    loadChain={loadChain}
                    getDates={getDates}
                    tickerInput={tickerInput}
                    metaLoading={metaLoading}
                    expLoading={expLoading}
                    anyLoading={anyLoading}
                    cancelAll={cancelAll}
                    chainSymbol={chainSymbol}
                    spot={spot}
                    spotIsEstimated={spotIsEstimated}
                    notice={notice}
                    error={error}
                    showOnboarding={showOnboarding}
                    setToken={setToken}
                    setSecret={setSecret}
                    onboardingPreview={onboardingPreview}
                    previewLabel={previewLabel}
                    sections={sections}
                    hasRows={hasRows}
                />
            </div>
            {/* `grow` + flex-col (2026-10-07): the wrapper takes the leftover height so
                GexView's <main> (flex-1) and its chart (flex-1, min-h-[420px]) fill the
                space down to the footer on every viewport, the footer sits at the same
                place as on Desk and Chart. With `shrink-0` kept, a taller-than-viewport
                GEX still overflows the page naturally instead of being squeezed.
                shrink-0: GEX has no internal scroll region of its own (unlike Desk's
                ChainTable), so it must stay OUT of the flex column's default
                flex-shrink:1 and just overflow the page naturally when its content
                (chart + stacked sidebar at narrow widths) is taller than the
                viewport - see this file's "GOTCHA" comment above `.shrink-0` on the
                nav wrapper for the bug this fixes (confirmed live: without
                shrink-0, GEX's own content was squeezed by the flex layout and
                rendered past/behind the footer instead of pushing it down). */}
            {activeTab === 'gex' && (
                <div className="flex shrink-0 grow flex-col">
                <Suspense fallback={null}>
                    <GexView
                        settings={settings}
                        provider={provider}
                        symbol={meta?.symbol ?? ''}
                        spot={gex.spot}
                        spotIsEstimated={gex.spotIsEstimated}
                        quotes={gex.quotes}
                        levels={gex.levels}
                        isFuturesPriced={gex.isFuturesPriced}
                        selectedExps={selectedExps}
                        metrics={gexMetrics}
                        setMetrics={changeGexMetrics}
                    />
                </Suspense>
                </div>
            )}
            {/* shrink-0: same reasoning as GEX's wrapper just above. */}
            {activeTab === 'chart' && (
                <div className="shrink-0">
                <Suspense fallback={null}>
                    <ChartView
                        settings={settings}
                        symbol={meta?.symbol ?? ''}
                        levels={gex.levels}
                        isFuturesPriced={gex.isFuturesPriced}
                        levelExpCount={selectedExps.length}
                        range={chartRange}
                        setRange={setChartRange}
                    />
                </Suspense>
                </div>
            )}
            </div>

            {/* lightweight-charts attribution (Apache-2.0 NOTICE + link) ONLY on the
                Chart tab (the only one that actually loads/renders that library - see
                AttributionFooter.tsx's own doc comment); every other tab shows a plain
                link back to this project's own GitHub repo instead. */}
            {activeTab === 'chart' ? <AttributionFooter /> : <RepoFooter />}
        </div>
    );
};

// ============================================================================
// BOOTSTRAP
// ============================================================================

const rootElement = document.getElementById('root');
if (rootElement) createRoot(rootElement).render(<React.StrictMode><I18nProvider initial={DEFAULT_LANGUAGE}><App /></I18nProvider></React.StrictMode>);
else console.error('Failed to find root element.');
