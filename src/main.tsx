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
 * 3. SINGLE-FILE CONTINUITY: Keep the core APP architecture self-contained in
 *    this file. (Optional INFRASTRUCTURE lives outside the 3 source files — see
 *    "COMPANION INFRASTRUCTURE" below — and is not required for the app to run.)
 * ============================================================================
 *
 * ============================================================================
 * AGENTIC AI DOCUMENTATION & SYSTEM ARCHITECTURE  (main.tsx)
 * ============================================================================
 *
 * PROJECT: Options Desk
 * ENVIRONMENT: Bun scripts, Parcel build, React, TypeScript, TailwindCSS v4
 *
 * ---------------------------------------------------------------------------
 * CHANGELOG (append newest at top; keep history accurate):
 * ---------------------------------------------------------------------------
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
 *            Emerald Ledger (`fundamentals`) and Indigo Desk (`options-desk`).
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
 *              * Clear everything -> wipes all "options-desk.*" localStorage keys
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
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
// @ts-ignore
import { createRoot } from 'react-dom/client';

// ============================================================================
// I18N — English / Russian translations. Inlined for single-file continuity
// (formerly src/i18n.tsx). All app TypeScript lives in this file.
// ============================================================================

type Language = 'en' | 'ru';
const DEFAULT_LANGUAGE: Language = 'en';
const LANGUAGES: Language[] = ['en', 'ru'];

/** Distinct flag emoji per language for the language switcher (ru/en icons). */
const LANG_FLAGS: Record<Language, string> = { en: '🇺🇸', ru: '🇷🇺' };

const translations: Record<Language, Record<string, string>> = {
    en: {
        'app.brand': 'Option Desk',
        'app.title': 'Options Desk',

        'topBar.api': 'API',
        'topBar.settings': 'Settings',
        'topBar.debug': 'Debug',
        'topBar.proxy': 'Proxy status',
        'topBar.proxyDisabled': 'disabled in CACHE mode',
        'topBar.cache': 'CACHE (static)',
        'topBar.live': 'LIVE (proxy)',
        'topBar.search': 'Search / load',
        'topBar.ticker': 'Ticker',
        'topBar.language': 'Language',

        'language.en': 'English',
        'language.ru': 'Русский',
        'language.icon': '🌐',

        'theme.light': 'Light',
        'theme.system': 'System',
        'theme.dark': 'Dark',

        'settings.title': 'Settings',
        'settings.provider': 'Data provider',
        'settings.providerHint': 'Also available in the heading for quick access.',
        'settings.theme': 'Theme',
        'settings.themeHint': 'Also available in the heading for quick access.',
        'settings.colorTheme': 'Color palette',
        'settings.colorThemeHint': 'Shared with Fundamentals for a consistent merge-ready UI.',
        'colorTheme.fundamentals': 'Emerald Ledger',
        'colorTheme.options-desk': 'Indigo Desk',
        'settings.language': 'Language',
        'settings.languageHint': 'Also available in the heading for quick access.',
        'settings.apiKey': 'API key',
        'settings.apiSecret': 'API secret',
        'settings.getKey': 'Get a free key',
        'settings.keyHint': 'Stored only in your browser (localStorage).',
        'settings.proxyBase': 'Proxy base URL',
        'settings.proxyBaseHint': 'Run bun ./scripts/options-local-proxy.ts locally, or deploy scripts/options-cloudflare-proxy.js.',
        'settings.proxyBasePlaceholder': 'http://localhost:8787 or https://name.you.workers.dev',
        'settings.corsProxy': 'CORS proxy',
        'settings.corsProxyHint': 'Public proxies can be flaky — switch if one fails, or use your own Worker.',
        'settings.workerUrl': 'Worker URL',
        'settings.workerUrlPlaceholder': 'https://name.you.workers.dev',

        'settings.deskColumns': 'Desk columns',
        'settings.deskColumns.calls': 'Calls',
        'settings.deskColumns.puts': 'Puts',
        'settings.deskColumns.openInterest': 'Open interest (OI)',
        'settings.deskColumns.volume': 'Volume',
        'settings.deskColumns.iv': 'Implied volatility (IV)',
        'settings.deskColumns.delta': 'Delta Δ',
        'settings.deskColumns.gamma': 'Gamma Γ',
        'settings.deskColumns.theta': 'Theta Θ',
        'settings.deskColumns.vega': 'Vega',
        'settings.deskColumns.rho': 'Rho ρ',
        'settings.deskColumns.lambda': 'Lambda λ',
        'settings.deskColumns.vanna': 'Vanna',
        'settings.deskColumns.vomma': 'Vomma',
        'settings.deskColumns.charm': 'Charm',
        'settings.deskColumns.speed': 'Speed',
        'settings.deskColumns.zomma': 'Zomma',
        'settings.deskColumns.color': 'Color',
        'settings.deskColumns.bid': 'Bid',
        'settings.deskColumns.mid': 'Mid',
        'settings.deskColumns.ask': 'Ask',
        'settings.deskColumns.note': 'Bid / Mid / Ask and Strike stay visible. Rho is disabled by default.',

        'deskColumns.header.openInterest': 'OI',
        'deskColumns.header.volume': 'Vol',
        'deskColumns.header.iv': 'IV',
        'deskColumns.header.delta': 'Δ',
        'deskColumns.header.gamma': 'Γ',
        'deskColumns.header.theta': 'Θ',
        'deskColumns.header.vega': 'Vega',
        'deskColumns.header.rho': 'ρ',
        'deskColumns.header.lambda': 'λ',
        'deskColumns.header.vanna': 'Vanna',
        'deskColumns.header.vomma': 'Vomma',
        'deskColumns.header.charm': 'Charm',
        'deskColumns.header.speed': 'Speed',
        'deskColumns.header.zomma': 'Zomma',
        'deskColumns.header.color': 'Color',
        'deskColumns.header.bid': 'Bid',
        'deskColumns.header.mid': 'Mid',
        'deskColumns.header.ask': 'Ask',

        'settings.cache': 'Cache',
        'settings.cache.records': 'Data records',
        'settings.cache.dataSize': 'Data size',
        'settings.cache.settingsSize': 'Settings size',
        'settings.cache.oldest': 'Oldest record',
        'settings.cache.newest': 'Newest record',
        'settings.cache.clearData': 'Clear data',
        'settings.cache.clearDataHint': 'Downloaded query results only',
        'settings.cache.clearSettings': 'Clear settings',
        'settings.cache.clearSettingsHint': 'Provider / theme / color palette / language / keys / proxy / columns',
        'settings.cache.clearAll': 'Clear everything',
        'settings.cache.clearAllHint': 'Data + settings (full reset)',
        'settings.cache.confirm': 'Confirm?',
        'settings.cache.confirmHelp': 'Click “Confirm?” again to proceed, or click away to cancel.',

        'setupBadge.noSetup': 'No setup',
        'setupBadge.freeKey': 'Free key',
        'setupBadge.keySet': 'Key set',
        'setupBadge.needsProxy': 'Needs proxy',

        'providerDescription.static':
            'Local static cache — same-origin data/options/{TICKER}.json (GitHub Action + yfinance + CBOE/BS greeks). ' +
            'No proxy, no keys. Best default on GitHub Pages. Only cached tickers are listed.',
        'providerDescription.yahoo':
            'Yahoo Finance via proxy (/api/options) — crumb/cookie handled by scripts/options-local-proxy.ts or Cloudflare Worker. ' +
            'Lazy per-expiration. No provider greeks; client Black-Scholes fills them when IV is present.',
        'providerDescription.nasdaq':
            'NASDAQ option chain via proxy (/api/nasdaq) — full chain one call (bid/ask/last/volume/OI). ' +
            'No IV/greeks in feed (higher-order stay empty). Needs Proxy base URL.',
        'providerDescription.cboe':
            'CBOE delayed options via proxy (/api/cboe) — equities & indices, greeks/IV/OI + spot. ' +
            'Default on localhost when proxy is available. Needs Proxy base URL.',

        'onboarding.title': 'One quick step: add your free {{provider}} {{keys}}',
        'onboarding.description': '{{hint}}',
        'onboarding.getKey': 'Get a free key',
        'onboarding.save': 'Save {{keys}} & load',
        'onboarding.saved': 'Credentials already saved — just search a ticker above.',
        'onboarding.keys': 'keys',
        'onboarding.key': 'key',
        'onboarding.previewDemo': 'or get {{symbol}}’s dates now (no key needed)',
        'onboarding.previewCache': 'or switch to CACHE (AAPL static data)',

        'controls.tickerPlaceholder': 'Ticker or company (e.g. AAPL, Tesla, SPX)',
        'controls.expirations': 'Expirations',
        'controls.loading': 'Loading…',
        'controls.load': 'Load',
        'controls.loadCount': 'Load ({{count}})',
        'controls.all': 'All',
        'controls.none': 'None',
        'controls.cancel': 'Cancel',
        'controls.searching': 'Searching tickers…',

        'chain.expirations': 'expiration',
        'chain.expirationsPlural': 'expirations',
        'chain.collapseAll': 'Collapse all',
        'chain.expandAll': 'Expand all',
        'chain.calls': 'Calls',
        'chain.puts': 'Puts',
        'chain.strike': 'Strike',
        'chain.strikeSymbol': '$',
        'chain.strikes': '{{count}} strikes',

        'spot.label': 'Spot',
        'spot.estimated': '(est.)',
        'spot.delayed': '· delayed · {{provider}}',

        'loading.expirations': 'Fetching expirations…',
        'loading.chain': 'Loading chain…',

        'notice.cancelled': 'Request cancelled.',
        'notice.noOptions': '“{{symbol}}” is a valid ticker, but the latest local index marks it as (no options).',
        'notice.noContracts': 'No contracts returned for the selected expiration(s).',
        'notice.enterTicker': 'Enter a ticker and press',
        'notice.toBegin': 'to begin.',
        'notice.pickExp': 'Pick one or more expirations and press',
        'notice.toFetch': 'to fetch the chain.',

        'error.enterTicker': 'Enter a ticker symbol.',
        'error.noContracts': 'No option contracts found for “{{symbol}}”.',
        'error.providerBulk': 'Provider misconfigured (bulk without fetchAll).',
        'error.providerLazy': 'Provider misconfigured (lazy without fetchMeta).',
        'error.friendly.networkProxy':
            'Could not reach the proxy. To fix this:\n\n' +
            '1. Clone the repo: git clone https://github.com/daggerok/options-desk.git\n' +
            '2. Install dependencies: bun install -E\n' +
            '3. Run the proxy: bun ./scripts/options-local-proxy.ts\n' +
            '4. Set Proxy base URL in Settings to http://localhost:8787\n\n' +
            'Or deploy scripts/options-cloudflare-proxy.js and set the Worker URL instead.\n\n' +
            'See docs/README.en.md for detailed instructions.',
        'error.friendly.networkCors':
            'Network/CORS error reaching the proxy. Try a different CORS proxy in Settings, or use CACHE (static data).',
        'error.friendly.networkGeneric':
            'Network error — could not reach the data provider. Check your connection and try again.',
        'error.friendly.unexpectedJson':
            'The provider returned an unexpected (non-JSON) response — often a proxy error page. Switch the proxy or provider in Settings.',
        'error.friendly.generic': 'Something went wrong while loading option data.',

        'retry': 'Retry',
        'expired': 'expired',
        'noOptions': '(no options)',
        'tickerFromIndex': 'Ticker from local index',
        'validTickerFromIndex': 'Valid ticker from local index',
    },
    ru: {
        'app.brand': 'Option Desk',
        'app.title': 'Options Desk',

        'topBar.api': 'API',
        'topBar.settings': 'Настройки',
        'topBar.debug': 'Отладка',
        'topBar.proxy': 'Статус прокси',
        'topBar.proxyDisabled': 'отключено в режиме CACHE',
        'topBar.cache': 'CACHE (статика)',
        'topBar.live': 'LIVE (прокси)',
        'topBar.search': 'Поиск / загрузка',
        'topBar.ticker': 'Тикер',
        'topBar.language': 'Язык',

        'language.en': 'English',
        'language.ru': 'Русский',
        'language.icon': '🌐',

        'theme.light': 'Светлая',
        'theme.system': 'Системная',
        'theme.dark': 'Тёмная',

        'settings.title': 'Настройки',
        'settings.provider': 'Провайдер данных',
        'settings.providerHint': 'Также доступен в шапке для быстрого доступа.',
        'settings.theme': 'Тема',
        'settings.themeHint': 'Также доступна в шапке для быстрого доступа.',
        'settings.colorTheme': 'Цветовая палитра',
        'settings.colorThemeHint': 'Общая с Fundamentals — единый UI при будущем слиянии.',
        'colorTheme.fundamentals': 'Изумрудный Ledger',
        'colorTheme.options-desk': 'Индиго Desk',
        'settings.language': 'Язык',
        'settings.languageHint': 'Также доступен в шапке для быстрого доступа.',
        'settings.apiKey': 'API ключ',
        'settings.apiSecret': 'API секрет',
        'settings.getKey': 'Получить бесплатный ключ',
        'settings.keyHint': 'Хранится только в браузере (localStorage).',
        'settings.proxyBase': 'Базовый URL прокси',
        'settings.proxyBaseHint': 'Запусти bun ./scripts/options-local-proxy.ts локально или задеплой scripts/options-cloudflare-proxy.js.',
        'settings.proxyBasePlaceholder': 'http://localhost:8787 или https://name.you.workers.dev',
        'settings.corsProxy': 'CORS прокси',
        'settings.corsProxyHint': 'Публичные прокси могут быть нестабильны — переключайся при сбоях или используй свой Worker.',
        'settings.workerUrl': 'URL Worker',
        'settings.workerUrlPlaceholder': 'https://name.you.workers.dev',

        'settings.deskColumns': 'Колонки доски',
        'settings.deskColumns.calls': 'Коллы',
        'settings.deskColumns.puts': 'Путы',
        'settings.deskColumns.openInterest': 'Открытый интерес (ОИ)',
        'settings.deskColumns.volume': 'Объём',
        'settings.deskColumns.iv': 'Подразумеваемая волатильность (IV)',
        'settings.deskColumns.delta': 'Дельта Δ',
        'settings.deskColumns.gamma': 'Гамма Γ',
        'settings.deskColumns.theta': 'Тета Θ',
        'settings.deskColumns.vega': 'Вега',
        'settings.deskColumns.rho': 'Ро ρ',
        'settings.deskColumns.lambda': 'Лямбда λ',
        'settings.deskColumns.vanna': 'Ванна',
        'settings.deskColumns.vomma': 'Вомма',
        'settings.deskColumns.charm': 'Чарм',
        'settings.deskColumns.speed': 'Спид',
        'settings.deskColumns.zomma': 'Зомма',
        'settings.deskColumns.color': 'Колор',
        'settings.deskColumns.bid': 'Бид (спрос)',
        'settings.deskColumns.mid': 'Мид (середина)',
        'settings.deskColumns.ask': 'Аск (предложение)',
        'settings.deskColumns.note': 'Бид / Мид / Аск и Страйк всегда видны. Ро отключён по умолчанию.',

        'deskColumns.header.openInterest': 'ОИ',
        'deskColumns.header.volume': 'Объём',
        'deskColumns.header.iv': 'IV',
        'deskColumns.header.delta': 'Δ',
        'deskColumns.header.gamma': 'Γ',
        'deskColumns.header.theta': 'Θ',
        'deskColumns.header.vega': 'Вега',
        'deskColumns.header.rho': 'ρ',
        'deskColumns.header.lambda': 'λ',
        'deskColumns.header.vanna': 'Ванна',
        'deskColumns.header.vomma': 'Вомма',
        'deskColumns.header.charm': 'Чарм',
        'deskColumns.header.speed': 'Спид',
        'deskColumns.header.zomma': 'Зомма',
        'deskColumns.header.color': 'Колор',
        'deskColumns.header.bid': 'Бид',
        'deskColumns.header.mid': 'Мид',
        'deskColumns.header.ask': 'Аск',

        'settings.cache': 'Кэш',
        'settings.cache.records': 'Записей данных',
        'settings.cache.dataSize': 'Размер данных',
        'settings.cache.settingsSize': 'Размер настроек',
        'settings.cache.oldest': 'Самая старая запись',
        'settings.cache.newest': 'Самая новая запись',
        'settings.cache.clearData': 'Очистить данные',
        'settings.cache.clearDataHint': 'Только загруженные результаты запросов',
        'settings.cache.clearSettings': 'Очистить настройки',
        'settings.cache.clearSettingsHint': 'Провайдер / тема / палитра / язык / ключи / прокси / колонки',
        'settings.cache.clearAll': 'Очистить всё',
        'settings.cache.clearAllHint': 'Данные + настройки (полный сброс)',
        'settings.cache.confirm': 'Подтвердить?',
        'settings.cache.confirmHelp': 'Нажми «Подтвердить?» ещё раз, чтобы продолжить, или клни вне кнопки для отмены.',

        'setupBadge.noSetup': 'Без настройки',
        'setupBadge.freeKey': 'Бесплатный ключ',
        'setupBadge.keySet': 'Ключ задан',
        'setupBadge.needsProxy': 'Нужен прокси',

        'providerDescription.static':
            'Локальный статический кэш — same-origin data/options/{TICKER}.json (GitHub Action + yfinance + CBOE/BS греки). ' +
            'Без прокси и ключей. Лучший default для GitHub Pages. Показываются только закэшированные тикеры.',
        'providerDescription.yahoo':
            'Yahoo Finance через прокси (/api/options) — crumb/cookie обрабатывают scripts/options-local-proxy.ts или Cloudflare Worker. ' +
            'Lazy по expiration. Нет провайдерских греков; клиентский Black-Scholes считает их при наличии IV.',
        'providerDescription.nasdaq':
            'Цепочка NASDAQ через прокси (/api/nasdaq) — полная цепочка за один запрос (bid/ask/last/volume/OI). ' +
            'Нет IV/греков в фиде (higher-order остаются пустыми). Нужен Proxy base URL.',
        'providerDescription.cboe':
            'CBOE delayed options через прокси (/api/cboe) — акции и индексы, греки/IV/OI + spot. ' +
            'Default на localhost, если прокси доступен. Нужен Proxy base URL.',

        'onboarding.title': 'Один простой шаг: добавь бесплатный {{keys}} для {{provider}}',
        'onboarding.description': '{{hint}}',
        'onboarding.getKey': 'Получить бесплатный ключ',
        'onboarding.save': 'Сохранить {{keys}} и загрузить',
        'onboarding.saved': 'Ключи уже сохранены — просто введи тикер выше.',
        'onboarding.keys': 'ключи',
        'onboarding.key': 'ключ',
        'onboarding.previewDemo': 'или получить даты для {{symbol}} прямо сейчас (без ключа)',
        'onboarding.previewCache': 'или переключиться на CACHE (статичные данные AAPL)',

        'controls.tickerPlaceholder': 'Тикер или компания (например, AAPL, Tesla, SPX)',
        'controls.expirations': 'Экспирации',
        'controls.loading': 'Загрузка…',
        'controls.load': 'Загрузить',
        'controls.loadCount': 'Загрузить ({{count}})',
        'controls.all': 'Все',
        'controls.none': 'Нет',
        'controls.cancel': 'Отмена',
        'controls.searching': 'Ищем тикеры…',

        'chain.expirations': 'экспирация',
        'chain.expirationsPlural': 'экспираций',
        'chain.collapseAll': 'Свернуть все',
        'chain.expandAll': 'Развернуть все',
        'chain.calls': 'Коллы',
        'chain.puts': 'Путы',
        'chain.strike': 'Страйк',
        'chain.strikeSymbol': '$',
        'chain.strikes': '{{count}} страйков',

        'spot.label': 'Спот',
        'spot.estimated': '(оценка)',
        'spot.delayed': '· с задержкой · {{provider}}',

        'loading.expirations': 'Загружаем экспирации…',
        'loading.chain': 'Загружаем цепочку…',

        'notice.cancelled': 'Запрос отменён.',
        'notice.noOptions': '«{{symbol}}» — валидный тикер, но последний локальный индекс помечает его как (no options).',
        'notice.noContracts': 'По выбранным экспирациям не вернулось контрактов.',
        'notice.enterTicker': 'Введи тикер и нажми',
        'notice.toBegin': 'для начала.',
        'notice.pickExp': 'Выбери одну или несколько экспираций и нажми',
        'notice.toFetch': 'и цепочка загрузится.',

        'error.enterTicker': 'Введи тикер.',
        'error.noContracts': 'Для «{{symbol}}» не найдено опционных контрактов.',
        'error.providerBulk': 'Провайдер настроен неверно (bulk без fetchAll).',
        'error.providerLazy': 'Провайдер настроен неверно (lazy без fetchMeta).',
        'error.friendly.networkProxy':
            'Не удалось достучаться до прокси. Чтобы исправить:\n\n' +
            '1. Клонируй репозиторий: git clone https://github.com/daggerok/options-desk.git\n' +
            '2. Установи зависимости: bun install -E\n' +
            '3. Запусти прокси: bun ./scripts/options-local-proxy.ts\n' +
            '4. Укажи Proxy base URL в настройках: http://localhost:8787\n\n' +
            'Или задеплой scripts/options-cloudflare-proxy.js и укажи URL Worker.\n\n' +
            'Подробности — в docs/README.en.md.',
        'error.friendly.networkCors':
            'Ошибка сети/CORS при обращении к прокси. Попробуй другой CORS-прокси в настройках или используй CACHE (статичные данные).',
        'error.friendly.networkGeneric':
            'Сетевая ошибка — не удалось достучаться до провайдера данных. Проверь соединение и попробуй снова.',
        'error.friendly.unexpectedJson':
            'Провайдер вернул неожиданный (не-JSON) ответ — часто это страница ошибки прокси. Переключи прокси или провайдера в настройках.',
        'error.friendly.generic': 'Что-то пошло не так при загрузке данных об опционах.',

        'retry': 'Повторить',
        'expired': 'истёк',
        'noOptions': '(нет опционов)',
        'tickerFromIndex': 'Тикер из локального индекса',
        'validTickerFromIndex': 'Валидный тикер из локального индекса',
    },
};

function translate(key: string, lang: Language, params?: Record<string, string | number>): string {
    const dict = translations[lang] ?? translations[DEFAULT_LANGUAGE];
    let text = dict[key] ?? translations[DEFAULT_LANGUAGE][key] ?? key;
    if (params) {
        Object.entries(params).forEach(([k, v]) => {
            text = text.split(`{{${k}}}`).join(String(v));
        });
    }
    return text;
}

function providerDescription(providerId: string, lang: Language): string {
    return translate(`providerDescription.${providerId}`, lang);
}

interface I18nContextValue {
    lang: Language;
    t: (key: string, params?: Record<string, string | number>) => string;
    setLang: (lang: Language) => void;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const I18nProvider: React.FC<{ initial: Language; children: React.ReactNode }> = ({ initial, children }) => {
    const [lang, setLang] = useState<Language>(LANGUAGES.includes(initial) ? initial : DEFAULT_LANGUAGE);
    useEffect(() => {
        document.documentElement.lang = lang;
        document.documentElement.dir = 'ltr';
    }, [lang]);

    const t = useCallback(
        (key: string, params?: Record<string, string | number>) => translate(key, lang, params),
        [lang],
    );

    return <I18nContext.Provider value={{ lang, t, setLang }}>{children}</I18nContext.Provider>;
};

function useI18n(): I18nContextValue {
    const ctx = useContext(I18nContext);
    if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
    return ctx;
}

// ============================================================================
// DEBUG SYSTEM
// ============================================================================

/**
 * Debug mode is controlled by the `?debug=true` URL parameter.
 * When active, verbose logs are emitted for boot-restore, fetch lifecycle, etc.
 * When inactive, `dbg()` is a no-op with effectively zero runtime cost.
 */
const DEBUG_ENABLED: boolean = (() => {
    try {
        return new URLSearchParams(window.location.search).get('debug') === 'true';
    } catch { return false; }
})();

/** Conditional debug logger — no-op unless `?debug=true` is in the URL. */
function dbg(...args: unknown[]): void {
    if (DEBUG_ENABLED) console.log('[DBG]', ...args);
}

if (DEBUG_ENABLED) {
    console.log(
        '%c[DEBUG MODE ACTIVE]%c Add ?debug=true to URL to enable. Remove to disable.',
        'color: #fff; background: #e11d48; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
        'color: #6b7280;',
    );
}

/** Error thrown/detected when a request is intentionally cancelled by the user. */
function isAbortError(e: unknown): boolean {
    return e instanceof DOMException ? e.name === 'AbortError'
        : (e instanceof Error && e.name === 'AbortError');
}

// ============================================================================
// DOMAIN TYPES
// ============================================================================

/** Source of greeks stored on a quote. `black-scholes` is a model estimate.
 *  Legacy static files may still carry `marketdata` / `dolthub` tags. */
type GreeksSource = 'cboe' | 'black-scholes' | 'marketdata' | 'dolthub' | null;

/** Top-level greeks enrichment summary written by scripts/options-data.py. */
interface GreeksSummary {
    enabled?: boolean;
    primarySource?: string | null;
    fallbackSource?: string | null;
    riskFreeRate?: number | null;
    dividendYield?: number | null;
    total?: number;
    cboeMatched?: number;
    computed?: number;
    missing?: number;
    cboeContracts?: number;
}

/** A single normalized option contract quote (provider-agnostic shape). */
interface OptionQuote {
    /** OCC-style option symbol, e.g. "AAPL260717C00110000". */
    symbol: string;
    /** ISO expiration date "YYYY-MM-DD". */
    expiration: string;
    /** Contract side. */
    side: 'call' | 'put';
    /** Strike price in dollars. */
    strike: number;
    bid: number | null;
    ask: number | null;
    /** Convenience mid = (bid+ask)/2 when both present. */
    mid: number | null;
    last: number | null;
    volume: number | null;
    openInterest: number | null;
    /** Implied volatility as a decimal (0.25 = 25%), when provided. */
    iv: number | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    /** Rho: sensitivity to interest rates (per 1pp rate change). */
    rho?: number | null;
    /** Lambda (Ω): leverage = delta * spot / option price. */
    lambda?: number | null;
    /** 2nd-order: dDelta/dVol (or dVega/dSpot). */
    vanna?: number | null;
    /** 2nd-order: dVega/dVol (volga). */
    vomma?: number | null;
    /** 2nd-order: dDelta/dTime (delta decay). */
    charm?: number | null;
    /** 3rd-order: dGamma/dSpot. */
    speed?: number | null;
    /** 3rd-order: dGamma/dVol. */
    zomma?: number | null;
    /** 3rd-order: dGamma/dTime. */
    color?: number | null;
    /** Where greeks came from, if known (cboe / black-scholes / …). */
    greeksSource?: GreeksSource;
    /** Why greeks are still missing after enrichment, if known. */
    greeksMissingReason?: string | null;
}

/** Lightweight chain metadata (expirations + spot) — the cheap first fetch. */
interface ChainMeta {
    symbol: string;
    /** Spot price of the underlying, when the provider supplies it (else null). */
    underlyingPrice: number | null;
    /** Sorted unique list of ISO expirations available. */
    expirations: string[];
    /** Optional greeks enrichment summary for static-cache files. */
    greeks?: GreeksSummary;
}

/** Full chain result for a symbol (used internally by BULK providers). */
interface ChainResult extends ChainMeta {
    /** All contracts across all expirations. */
    quotes: OptionQuote[];
}

/** Runtime context handed to a provider so it can honor user settings. */
interface ProviderContext {
    /** CORS proxy template; "{url}" is replaced with the encoded target URL. */
    proxyTemplate: string;
    /** Base URL of a request-handling proxy (Yahoo/worker), e.g. localhost:8787. */
    proxyBase: string;
    /** Optional/required API token or key (provider-specific). */
    token: string;
    /** Optional/required API secret, for providers needing a KEY + SECRET pair
     *  (e.g. Alpaca: APCA-API-KEY-ID + APCA-API-SECRET-KEY). Stored locally. */
    secret: string;
    /** Abort signal so any in-flight request can be cancelled by the user. */
    signal?: AbortSignal;
}

/** How much setup a provider needs before it can serve the requested symbol. */
type SetupKind = 'none' | 'key' | 'proxy';

/**
 * How a provider delivers data:
 *  - 'bulk': one request returns the entire chain (cached; per-expiration views
 *            are filtered from cache -> no extra requests).
 *  - 'lazy': list expirations first, then fetch each expiration on demand
 *            (required by APIs whose chain endpoint needs an expiration param).
 */
type ProviderMode = 'bulk' | 'lazy';

/** Pluggable data source contract. Add new sources by implementing this. */
interface DataProvider {
    id: string;
    /** Short label shown in the top-bar dropdown. */
    label: string;
    /** One-line human description shown in Settings / onboarding. */
    description: string;
    /** Delivery strategy (see ProviderMode). */
    mode: ProviderMode;
    /** Setup requirement classification (drives badges & onboarding). */
    setup: SetupKind;
    /** Whether this provider accepts an API key/token. */
    supportsToken: boolean;
    /**
     * Whether this provider ALSO needs a secret (KEY + SECRET pair), e.g. Alpaca
     * (APCA-API-KEY-ID + APCA-API-SECRET-KEY). Both are stored in localStorage,
     * exactly like the single token — no server needed for a personal static app.
     */
    supportsSecret?: boolean;
    /** Placeholder label for the key field (defaults to "key"). */
    keyLabel?: string;
    /** Placeholder label for the secret field (when supportsSecret). */
    secretLabel?: string;
    /** Whether this provider is routed through the CORS proxy template. */
    needsProxy: boolean;
    /** Whether this provider needs a request-handling proxy base URL (Yahoo). */
    needsProxyBase?: boolean;
    /** URL where the user can obtain a free key (for the onboarding link). */
    keyUrl?: string;
    /** Symbol that works with NO key (demo), if any (e.g. AAPL / IBM). */
    demoSymbol?: string;
    /** Extra human hint for the onboarding card (e.g. "no funded account"). */
    keyHint?: string;
    /** True if, given settings, this provider needs a key to serve `symbol`. */
    needsKeyFor: (symbol: string, ctx: ProviderContext) => boolean;

    // -- BULK providers implement this (returns the whole chain in one shot) --
    fetchAll?: (symbol: string, ctx: ProviderContext) => Promise<ChainResult>;

    // -- LAZY providers implement these two --------------------------------
    fetchMeta?: (symbol: string, ctx: ProviderContext) => Promise<ChainMeta>;
    fetchExpiration?: (symbol: string, expiration: string, ctx: ProviderContext) => Promise<OptionQuote[]>;

    /** Optional: list of tickers this provider can serve (Static cache uses it). */
    listTickers?: (ctx: ProviderContext) => Promise<string[]>;

    /**
     * Optional provider-native ticker suggestions / symbol search.
     * Providers that expose their own search endpoint (Yahoo/NASDAQ/CBOE proxy,
     * DoltHub SQL) implement this. Providers without one fall back to the local
     * data/options/index.json manifest, including tickers known to have no options.
     */
    suggestTickers?: (query: string, ctx: ProviderContext) => Promise<TickerSuggestion[]>;
}

/** A normalized ticker search suggestion shown under the ticker input. */
interface TickerSuggestion {
    /** Display/submission symbol. For CBOE indices the user-facing symbol is SPX; the provider maps it to _SPX internally. */
    symbol: string;
    /** Optional company / index / instrument name for full-text search context. */
    name?: string;
    /** Optional exchange label (NASDAQ, NYSE, CBOE, etc.). */
    exchange?: string;
    /** Human label for the source of this suggestion (Provider / Local index). */
    source: string;
    /** False only when data/options/index.json explicitly says the ticker exists but has no listed options. */
    hasOptions: boolean;
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

/** Normalize a value that an API may return as either an array or a single
 *  object (Tradier does this for singletons) into a proper array. */
function asArray<T>(v: T | T[] | null | undefined): T[] {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
}

/**
 * Parse an OCC-style option symbol into its components.
 * Format: ROOT + YYMMDD + (C|P) + STRIKE*1000 (8 digits, zero-padded).
 * Example: "AAPL260717C00110000" -> exp 2026-07-17, call, strike 110.
 * Returns null if the symbol does not match.
 */
function parseOccSymbol(sym: string): { expiration: string; side: 'call' | 'put'; strike: number } | null {
    const m = /^[.\-A-Z0-9]*?(\d{6})([CP])(\d{8})$/.exec(sym);
    if (!m) return null;
    const [, yymmdd, cp, strikeRaw] = m;
    const yy = Number(yymmdd.slice(0, 2));
    const mm = yymmdd.slice(2, 4);
    const dd = yymmdd.slice(4, 6);
    // OCC dates are 21st-century; 2000 + yy is correct for the foreseeable future.
    const expiration = `20${String(yy).padStart(2, '0')}-${mm}-${dd}`;
    const side = cp === 'C' ? 'call' : 'put';
    const strike = Number(strikeRaw) / 1000;
    return { expiration, side, strike };
}

/** Compute a mid price from bid/ask when both are usable, else null. */
function computeMid(bid: number | null, ask: number | null): number | null {
    if (bid == null || ask == null || bid <= 0 || ask <= 0) return null;
    return (bid + ask) / 2;
}

/** Coerce arbitrary JSON numbers to `number | null` (treats 0 as valid). */
function num(v: unknown): number | null {
    const n = typeof v === 'string' ? Number(v) : (v as number);
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Format a number for display; missing data renders as an empty cell. */
function fmt(v: number | null | undefined, digits = 2): string {
    if (v == null || !Number.isFinite(v)) return '';
    return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Format an integer-ish value (volume / OI) with thousands separators. */
function fmtInt(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '';
    return Math.round(v).toLocaleString();
}

/** Format implied volatility (decimal) as a percentage string. */
function fmtPct(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '';
    return `${(v * 100).toFixed(1)}%`;
}

/** Format greeks; missing values stay visually empty, while real zero prints as 0.0000. */
function fmtGreek(v: number | null | undefined, digits = 4): string {
    if (v == null || !Number.isFinite(v)) return '';
    return v.toFixed(digits);
}

/** Convert a "YYYY-MM-DD" date to unix seconds (UTC midnight). */
function isoToUnix(iso: string): number {
    return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 1000);
}

/**
 * Build a proxied URL from the user's proxy template.
 * The template must contain "{url}", which is replaced by the URL-encoded target.
 */
function proxied(target: string, template: string): string {
    if (!template || !template.includes('{url}')) return target;
    return template.replace('{url}', encodeURIComponent(target));
}

/**
 * Estimate the underlying spot via put-call parity for providers that do not
 * return it. At the strike where |callMid - putMid| is smallest, the underlying
 * is approximately: S ≈ K + (callMid - putMid). Returns null if not derivable.
 */
function estimateSpot(quotes: OptionQuote[], expiration: string): number | null {
    const byStrike = new Map<number, { c?: number; p?: number }>();
    for (const q of quotes) {
        if (q.expiration !== expiration) continue;
        const mid = q.mid ?? q.last;
        if (mid == null) continue;
        const slot = byStrike.get(q.strike) ?? {};
        if (q.side === 'call') slot.c = mid; else slot.p = mid;
        byStrike.set(q.strike, slot);
    }
    let bestDiff = Infinity;
    let bestSpot: number | null = null;
    // NOTE: use Map.prototype.forEach rather than `for...of byStrike` (or even
    // `for...of byStrike.entries()` / `Array.from(byStrike.entries())`). Any form
    // that ITERATES a Map goes through the iteration protocol, which TypeScript
    // rejects with TS2802 unless the consuming tsconfig has `target` >= ES2015 or
    // the `downlevelIteration` flag. `forEach` is a plain method call — no
    // iteration protocol — so it type-checks under ANY target/tsconfig.
    byStrike.forEach(({ c, p }, strike) => {
        if (c == null || p == null) return;
        const diff = Math.abs(c - p);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestSpot = strike + (c - p); // put-call parity approximation
        }
    });
    dbg('estimateSpot', { expiration, bestSpot });
    return bestSpot;
}

// ---------------------------------------------------------------------------
// Client-side Black-Scholes greeks — SINGLE SOURCE OF TRUTH for model math
// ---------------------------------------------------------------------------
// scripts/options-data.py may attach provider Cboe 1st-order only. All model work
// (missing 1st-order + λ + 2nd/3rd-order) happens here after every provider
// fetch, including CACHE. Do not reintroduce BS in Python — that duplicates this.
// Conventions: theta per calendar day; vega/rho per 1 vol-point / 1pp rate.
const BS_RISK_FREE_RATE = 0.045;
const BS_DIVIDEND_YIELD = 0.0;
const HIGHER_ORDER_GREEK_KEYS = ['lambda', 'vanna', 'vomma', 'charm', 'speed', 'zomma', 'color'] as const;

function normPdf(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Error function — Abramowitz & Stegun 7.1.26 (max abs error ~1.5e-7). */
function erf(x: number): number {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
        - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
    return sign * y;
}

/** Standard normal CDF Φ(x) = ½ (1 + erf(x/√2)), matching Python math.erfc path. */
function normCdf(x: number): number {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Years to expiration (calendar), +1 day floor — same rule as options-data.py. */
function yearsToExpiration(expiration: string, now: Date = new Date()): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiration || ''));
    if (!m) return null;
    const expUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((expUtc - todayUtc) / 86_400_000) + 1;
    if (days <= 0) return null;
    return Math.max(days / 365.0, 1.0 / 365.0);
}

type BsGreeks = {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
    lambda: number;
    vanna: number;
    vomma: number;
    charm: number;
    speed: number;
    zomma: number;
    color: number;
};

/**
 * Model-estimated greeks for one quote. Returns null + reason when inputs are
 * insufficient (missing spot/strike/IV/expiration). Does not mutate `q`.
 */
function blackScholesGreeks(
    q: Pick<OptionQuote, 'side' | 'strike' | 'expiration' | 'iv' | 'last' | 'mid' | 'bid' | 'ask'>,
    spot: number,
    riskFree: number = BS_RISK_FREE_RATE,
    dividendYield: number = BS_DIVIDEND_YIELD,
): { greeks: BsGreeks; reason: null } | { greeks: null; reason: string } {
    const s = num(spot);
    const k = num(q.strike);
    const sigma = num(q.iv);
    if (s == null || s <= 0) return { greeks: null, reason: 'missing_spot' };
    if (k == null || k <= 0) return { greeks: null, reason: 'missing_strike' };
    if (sigma == null || sigma <= 0) return { greeks: null, reason: 'missing_iv' };
    const t = yearsToExpiration(q.expiration);
    if (t == null || t <= 0) return { greeks: null, reason: 'expired' };

    try {
        const sqrtT = Math.sqrt(t);
        const d1 = (Math.log(s / k) + (riskFree - dividendYield + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
        const d2 = d1 - sigma * sqrtT;
        const discQ = Math.exp(-dividendYield * t);
        const discR = Math.exp(-riskFree * t);
        const pdf = normPdf(d1);
        const gamma = discQ * pdf / (s * sigma * sqrtT);
        const vega = s * discQ * pdf * sqrtT / 100.0;
        const isPut = q.side === 'put';

        let delta: number;
        let thetaYear: number;
        let rho: number;
        let theoPrice: number;
        let charmRaw: number;
        if (isPut) {
            delta = discQ * (normCdf(d1) - 1.0);
            thetaYear = (-(s * discQ * pdf * sigma) / (2.0 * sqrtT)
                + riskFree * k * discR * normCdf(-d2)
                - dividendYield * s * discQ * normCdf(-d1));
            rho = -k * t * discR * normCdf(-d2) / 100.0;
            theoPrice = k * discR * normCdf(-d2) - s * discQ * normCdf(-d1);
            charmRaw = -dividendYield * discQ * normCdf(-d1)
                - discQ * pdf * (2 * (riskFree - dividendYield) * t - d2 * sigma * sqrtT) / (2 * t * sigma * sqrtT);
        } else {
            delta = discQ * normCdf(d1);
            thetaYear = (-(s * discQ * pdf * sigma) / (2.0 * sqrtT)
                - riskFree * k * discR * normCdf(d2)
                + dividendYield * s * discQ * normCdf(d1));
            rho = k * t * discR * normCdf(d2) / 100.0;
            theoPrice = s * discQ * normCdf(d1) - k * discR * normCdf(d2);
            charmRaw = dividendYield * discQ * normCdf(d1)
                - discQ * pdf * (2 * (riskFree - dividendYield) * t - d2 * sigma * sqrtT) / (2 * t * sigma * sqrtT);
        }

        let optPrice = num(q.last);
        if (optPrice == null || optPrice <= 0) optPrice = num(q.mid);
        if (optPrice == null || optPrice <= 0) {
            const bid = num(q.bid);
            const ask = num(q.ask);
            if (bid != null && ask != null && bid > 0 && ask > 0) optPrice = (bid + ask) / 2;
        }
        if (optPrice == null || optPrice <= 0) optPrice = theoPrice;

        const lambda = optPrice > 0 ? (delta * s / optPrice) : 0;
        const vanna = -discQ * pdf * d2 / sigma / 100.0;
        const vegaRaw = s * discQ * pdf * sqrtT;
        const vomma = vegaRaw * d1 * d2 / sigma / 10000.0;
        const charm = charmRaw / 365.0;
        const speed = -gamma * (1.0 + d1 / (sigma * sqrtT)) / s;
        const zomma = gamma * (d1 * d2 - 1.0) / sigma / 100.0;
        const colorRaw = -gamma * (2 * dividendYield * t + 1.0
            + (2 * (riskFree - dividendYield) * t - d2 * sigma * sqrtT) * d1 / (sigma * sqrtT)) / (2 * t);
        const color = colorRaw / 365.0;

        const greeks: BsGreeks = {
            delta,
            gamma,
            theta: thetaYear / 365.0,
            vega,
            rho,
            lambda,
            vanna,
            vomma,
            charm,
            speed,
            zomma,
            color,
        };
        for (const k of Object.keys(greeks) as (keyof BsGreeks)[]) {
            if (!Number.isFinite(greeks[k])) return { greeks: null, reason: 'model_error' };
        }
        return { greeks, reason: null };
    } catch {
        return { greeks: null, reason: 'model_error' };
    }
}

function hasFirstOrderGreeks(q: OptionQuote): boolean {
    return num(q.delta) != null && num(q.gamma) != null;
}

function hasHigherOrderGreeks(q: OptionQuote): boolean {
    return HIGHER_ORDER_GREEK_KEYS.some((k) => num(q[k] as number | null | undefined) != null);
}

/**
 * Enrich one quote with model greeks without clobbering provider-supplied values.
 * - Already has 1st + higher-order → leave as-is (static cache pre-enrichment).
 * - Has 1st-order (CBOE/marketdata/DoltHub) → fill only missing ρ/λ/2nd/3rd.
 * - Has IV but no 1st-order (Yahoo) → fill full BS set, tag black-scholes.
 * - No IV and no 1st-order (NASDAQ) → leave empty with missing reason when useful.
 */
function enrichQuoteWithModelGreeks(q: OptionQuote, spot: number | null): OptionQuote {
    if (spot == null || !(spot > 0)) {
        if (!hasFirstOrderGreeks(q) && !q.greeksMissingReason) {
            return { ...q, greeksMissingReason: 'missing_spot' };
        }
        return q;
    }
    if (hasFirstOrderGreeks(q) && hasHigherOrderGreeks(q)) return q;

    const { greeks: calc, reason } = blackScholesGreeks(q, spot);
    if (!calc) {
        if (!hasFirstOrderGreeks(q) && !q.greeksMissingReason) {
            return { ...q, greeksMissingReason: reason };
        }
        return q;
    }

    if (hasFirstOrderGreeks(q)) {
        // Keep provider delta/gamma/theta/vega; only backfill missing fields.
        return {
            ...q,
            rho: q.rho ?? calc.rho,
            lambda: q.lambda ?? calc.lambda,
            vanna: q.vanna ?? calc.vanna,
            vomma: q.vomma ?? calc.vomma,
            charm: q.charm ?? calc.charm,
            speed: q.speed ?? calc.speed,
            zomma: q.zomma ?? calc.zomma,
            color: q.color ?? calc.color,
            greeksSource: q.greeksSource ?? 'black-scholes',
            greeksMissingReason: q.greeksMissingReason ?? null,
        };
    }

    return {
        ...q,
        delta: calc.delta,
        gamma: calc.gamma,
        theta: calc.theta,
        vega: calc.vega,
        rho: calc.rho,
        lambda: calc.lambda,
        vanna: calc.vanna,
        vomma: calc.vomma,
        charm: calc.charm,
        speed: calc.speed,
        zomma: calc.zomma,
        color: calc.color,
        greeksSource: 'black-scholes',
        greeksMissingReason: null,
    };
}

/** Resolve a usable spot for enrichment: explicit underlying, else parity estimate. */
function resolveEnrichmentSpot(quotes: OptionQuote[], underlyingPrice: number | null | undefined): number | null {
    const s = num(underlyingPrice);
    if (s != null && s > 0) return s;
    const exps: string[] = [];
    const seen: Record<string, true> = {};
    for (const q of quotes) {
        if (q.expiration && !seen[q.expiration]) {
            seen[q.expiration] = true;
            exps.push(q.expiration);
        }
    }
    exps.sort();
    for (let i = 0; i < exps.length; i++) {
        const est = estimateSpot(quotes, exps[i]);
        if (est != null && est > 0) return est;
    }
    return null;
}

/** Enrich an array of quotes; returns same array reference if nothing changed. */
function enrichQuotesWithModelGreeks(quotes: OptionQuote[], underlyingPrice: number | null | undefined): OptionQuote[] {
    if (!quotes.length) return quotes;
    const spot = resolveEnrichmentSpot(quotes, underlyingPrice);
    let changed = false;
    const out = quotes.map((q) => {
        const next = enrichQuoteWithModelGreeks(q, spot);
        if (next !== q) changed = true;
        return next;
    });
    return changed ? out : quotes;
}

/** Attach model greeks + a light summary onto a bulk ChainResult. */
function enrichChainResult(result: ChainResult): ChainResult {
    const quotes = enrichQuotesWithModelGreeks(result.quotes, result.underlyingPrice);
    if (quotes === result.quotes && result.greeks) return result;

    let computed = 0;
    let missing = 0;
    let providerFirst = 0;
    for (const q of quotes) {
        if (q.greeksSource === 'black-scholes') computed += 1;
        else if (hasFirstOrderGreeks(q)) providerFirst += 1;
        if (!hasFirstOrderGreeks(q)) missing += 1;
    }
    const greeks: GreeksSummary = {
        ...(result.greeks || {}),
        enabled: true,
        fallbackSource: result.greeks?.fallbackSource ?? 'black-scholes',
        riskFreeRate: result.greeks?.riskFreeRate ?? BS_RISK_FREE_RATE,
        dividendYield: result.greeks?.dividendYield ?? BS_DIVIDEND_YIELD,
        total: quotes.length,
        computed: result.greeks?.computed ?? computed,
        missing: result.greeks?.missing ?? missing,
        // Preserve static-cache cboeMatched when present; else count non-BS first-order.
        cboeMatched: result.greeks?.cboeMatched ?? providerFirst,
    };
    return { ...result, quotes, greeks };
}

/**
 * Map raw fetch/parse failures to a friendly, actionable message.
 * Keeps the UI human-readable instead of leaking stack traces or JSON parse
 * errors like "Unexpected token '<'".
 */
function friendlyError(e: unknown, provider: DataProvider, lang: Language): string {
    const msg = (e instanceof Error ? e.message : String(e)) || '';
    if (/^[A-Z].*[.?!]$/.test(msg) && msg.length < 240 && !msg.includes('Unexpected token')) {
        return msg;
    }
    if (msg.includes('Failed to fetch') || msg.toLowerCase().includes('networkerror')) {
        if (provider.needsProxyBase) {
            return translate('error.friendly.networkProxy', lang);
        }
        return provider.needsProxy
            ? translate('error.friendly.networkCors', lang)
            : translate('error.friendly.networkGeneric', lang);
    }
    if (msg.includes('Unexpected token') || msg.toLowerCase().includes('json')) {
        return translate('error.friendly.unexpectedJson', lang);
    }
    return msg || translate('error.friendly.generic', lang);
}

// ============================================================================
// DATA PROVIDERS
// ============================================================================

/**
 * Fetch a same-origin static JSON file with DIAGNOSTIC error handling.
 *
 * Why this exists: the naive `await res.json()` throws an opaque SyntaxError when
 * the server returns something that ISN'T JSON — and the #1 real-world cause of
 * "Bad static data" is a dev/preview or SPA host that serves the app's own
 * index.html (a 200 HTML page) for a missing `data/options/*.json` path instead of a
 * 404. Reading the body as TEXT first lets us detect that case (and truncated /
 * malformed files) and raise an ACTIONABLE message telling the user exactly what
 * to fix, rather than a vague failure.
 *
 * @param url    same-origin path to the JSON file
 * @param signal AbortSignal for cancellation
 * @param label  optional ticker/name for nicer error messages (else derived)
 */
async function fetchStaticJson(url: string, signal?: AbortSignal, label?: string): Promise<any> {
    const name = label ?? url;
    let res: Response;
    try {
        res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
    } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
        throw new Error(`Could not load ${url} (network error). Is the site served over http(s), not file://?`);
    }
    if (res.status === 404) {
        throw new Error(
            `"${name}" is not in the static cache (data/${name}.json → 404). ` +
            `Pick a cached ticker from the list, or run scripts/options-data.py to add it.`,
        );
    }
    if (!res.ok) {
        throw new Error(`Static file ${url} failed to load (HTTP ${res.status}).`);
    }
    const text = await res.text();
    const trimmed = text.trimStart();
    // A server that falls back to the SPA shell returns HTML, not JSON.
    if (trimmed.startsWith('<')) {
        throw new Error(
            `Expected JSON at ${url} but got an HTML page. The server is likely ` +
            `serving index.html for missing files (SPA fallback) — make sure the ` +
            `data/ folder is deployed alongside the app and reachable at this path.`,
        );
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            `Static file ${url} is not valid JSON (it may be truncated or contain ` +
            `NaN/Infinity). Re-run scripts/options-data.py to rebuild it.`,
        );
    }
}

/** Local manifest shape normalized from data/options/index.json for ticker suggestions. */
interface StaticTickerManifest {
    options: string[];
    noOptions: string[];
    /** Optional TICKER -> company / fund / index name, stored in data/options/index.json. */
    names: Record<string, string>;
}

/** In-memory copy of data/options/index.json so typing in the ticker box stays instant. */
let staticTickerManifestCache: StaticTickerManifest | null = null;

/** Normalize any provider/search symbol into the uppercase value the app submits. */
function normalizeTickerSymbol(s: unknown): string {
    return String(s ?? '').trim().toUpperCase();
}

/** True when `sym` looks like a ticker-ish identifier rather than arbitrary text. */
function looksLikeTicker(sym: string): boolean {
    return /^[.^_\-A-Z0-9]{1,16}$/.test(sym);
}

/**
 * Read data/options/index.json and normalize BOTH known-with-options (`files`) and
 * known-without-options (`no_options`). The latter is deliberately preserved for
 * suggestions so a user can see "XYZ (no options)" while typing and understand
 * that the ticker is valid but the latest cache scan found no listed contracts.
 */
async function loadStaticTickerManifest(ctx: ProviderContext): Promise<StaticTickerManifest> {
    if (staticTickerManifestCache) return staticTickerManifestCache;
    const j: any = await fetchStaticJson('data/options/index.json', ctx.signal);
    // v13: `files` is a sorted ticker list. Legacy v4–v12 used { TICKER: updatedISO }.
    const rawFiles = j?.files;
    const fileSymbols: string[] = Array.isArray(rawFiles)
        ? rawFiles.map(normalizeTickerSymbol)
        : (rawFiles && typeof rawFiles === 'object' ? Object.keys(rawFiles).map(normalizeTickerSymbol) : []);
    const noRaw = j?.no_options;
    const noOptions = Array.isArray(noRaw)
        ? noRaw.map(normalizeTickerSymbol)
        : (noRaw && typeof noRaw === 'object' ? Object.keys(noRaw).map(normalizeTickerSymbol) : []);
    const rawNames = j?.names && typeof j.names === 'object' ? j.names : {};
    const names: Record<string, string> = {};
    Object.keys(rawNames).forEach((sym) => {
        const key = normalizeTickerSymbol(sym);
        const value = String(rawNames[sym] ?? '').trim();
        if (key && value) names[key] = value;
    });
    staticTickerManifestCache = {
        options: fileSymbols.filter(Boolean).sort(),
        noOptions: noOptions.filter(Boolean).sort(),
        names,
    };
    return staticTickerManifestCache;
}

/** Rank a local-index match: exact ticker > ticker prefix > company prefix > substring; no match => null. */
function localTickerRank(query: string, symbol: string, name = ''): number | null {
    const q = normalizeTickerSymbol(query);
    const n = name.toUpperCase();
    if (!q) return 50;
    if (symbol === q) return 0;
    if (symbol.startsWith(q)) return 10 + Math.min(symbol.length, 20);
    if (n.startsWith(q)) return 35 + Math.min(symbol.length, 20);
    const symbolAt = symbol.indexOf(q);
    if (symbolAt >= 0) return 70 + symbolAt + Math.min(symbol.length, 20);
    const nameAt = n.indexOf(q);
    return nameAt >= 0 ? 100 + nameAt + Math.min(symbol.length, 20) : null;
}

/** Build suggestions from the local static manifest, including "(no options)" rows. */
function staticTickerSuggestionsFromManifest(query: string, manifest: StaticTickerManifest, limit = 24): TickerSuggestion[] {
    const out: Array<TickerSuggestion & { _rank: number }> = [];
    const add = (symbol: string, hasOptions: boolean) => {
        if (!looksLikeTicker(symbol)) return;
        const name = manifest.names[symbol] || '';
        const rank = localTickerRank(query, symbol, name);
        if (rank == null) return;
        out.push({ symbol, name: name || undefined, source: 'Local index', hasOptions, _rank: rank + (hasOptions ? 0 : 25) });
    };
    manifest.options.forEach((s) => add(s, true));
    manifest.noOptions.forEach((s) => add(s, false));
    return out
        .sort((a, b) => a._rank - b._rank || a.symbol.localeCompare(b.symbol))
        .slice(0, limit)
        .map(({ _rank, ...s }) => s);
}

/** Convenience wrapper for fallback suggestions from data/options/index.json. */
async function staticTickerSuggestions(query: string, ctx: ProviderContext, limit = 24): Promise<TickerSuggestion[]> {
    const manifest = await loadStaticTickerManifest(ctx);
    return staticTickerSuggestionsFromManifest(query, manifest, limit);
}

/** Deduplicate and cap provider-native suggestions before rendering. */
function dedupeTickerSuggestions(items: TickerSuggestion[], limit = 24): TickerSuggestion[] {
    const seen = new Set<string>();
    const out: TickerSuggestion[] = [];
    items.forEach((item) => {
        const symbol = normalizeTickerSymbol(item.symbol);
        if (!symbol || seen.has(symbol)) return;
        seen.add(symbol);
        out.push({ ...item, symbol, hasOptions: item.hasOptions !== false });
    });
    return out.slice(0, limit);
}

/**
 * Provider-native suggestion request with local-index fallback. If a provider has
 * no dedicated search/list endpoint, or its proxy is unavailable, the UI still
 * suggests tickers from data/options/index.json and labels `no_options` entries.
 */
async function suggestTickers(provider: DataProvider, query: string, ctx: ProviderContext, limit = 24): Promise<TickerSuggestion[]> {
    if (provider.suggestTickers) {
        try {
            const suggestions = await provider.suggestTickers(query, ctx);
            if (suggestions.length > 0) return dedupeTickerSuggestions(suggestions, limit);
        } catch (e: unknown) {
            if (isAbortError(e)) throw e;
            dbg('provider suggestions failed; falling back to local index', { provider: provider.id, error: String(e) });
        }
    }
    return staticTickerSuggestions(query, ctx, limit);
}

/**
 * Static cache provider (BULK, no setup — best for GitHub Pages).
 * Reads the site's OWN files (same-origin => zero CORS, zero keys):
 *   ./data/options/index.json     -> { files: ["<TICKER>", ...],
 *                              count, names?, no_options? }
 *                            (v0.9.16: the manifest now records EACH ticker's own
 *                            `updated` timestamp instead of a single global
 *                            `updated` that churned on every run. The ticker list
 *                            is the sorted keys of `files`. No legacy shape kept.
 *                            `names` powers local company-name suggestions;
 *                            `no_options` is surfaced as "(no options)".)
 *   ./data/options/{TICKER}.json  -> ChainResult-like payload (see scripts/options-data.py)
 * Data is refreshed by the GitHub Action. Greeks may be null (yfinance source).
 */
const staticProvider: DataProvider = {
    id: 'static',
    label: 'CACHE',
    description:
        'Local static cache — same-origin data/options/{TICKER}.json (GitHub Action + yfinance + CBOE/BS greeks). ' +
        'No proxy, no keys. Best default on GitHub Pages. Only cached tickers are listed.',
    mode: 'bulk',
    setup: 'none',
    supportsToken: false,
    needsProxy: false,
    demoSymbol: undefined,
    needsKeyFor() { return false; },
    async listTickers(ctx) {
        try {
            // Reuse the robust JSON fetch so a mis-served index.json (e.g. SPA
            // HTML fallback) fails cleanly to an empty list instead of throwing.
            // v0.9.43 shape: { files: [TICKER, ...] } (legacy map keys still OK).
            const manifest = await loadStaticTickerManifest(ctx);
            return manifest.options;
        } catch { return []; }
    },
    async suggestTickers(query, ctx) {
        // Static cache uses the local manifest directly and includes the
        // `no_options` skiplist as visible "(no options)" suggestions.
        return staticTickerSuggestions(query, ctx);
    },
    async fetchAll(symbol, ctx) {
        const raw = symbol.toUpperCase().replace(/^[_.]/, '');
        const manifest = await loadStaticTickerManifest(ctx).catch(() => null);
        if (manifest?.noOptions.includes(raw)) {
            throw new Error(`"${raw}" is a valid ticker, but data/options/index.json marks it as (no options) in the latest static-cache scan.`);
        }
        // fetchStaticJson reads the body as TEXT first, so we can tell apart the
        // real failure modes (404, HTML SPA fallback, malformed JSON) and report
        // an ACTIONABLE message instead of a vague "Bad static data".
        const j: any = await fetchStaticJson(`data/options/${encodeURIComponent(raw)}.json`, ctx.signal, raw);
        if (!j || !Array.isArray(j.quotes)) {
            throw new Error(
                `Static file data/${raw}.json loaded but has no "quotes" array. ` +
                `The file may be truncated or in an old format — re-run scripts/options-data.py to rebuild it.`,
            );
        }
        const quotes: OptionQuote[] = j.quotes.map((q: any) => ({
            symbol: String(q.symbol ?? ''),
            expiration: String(q.expiration ?? ''),
            side: q.side === 'put' ? 'put' : 'call',
            strike: num(q.strike) ?? 0,
            bid: num(q.bid),
            ask: num(q.ask),
            mid: num(q.mid) ?? computeMid(num(q.bid), num(q.ask)),
            last: num(q.last),
            volume: num(q.volume),
            openInterest: num(q.openInterest),
            iv: num(q.iv),
            delta: num(q.delta),
            gamma: num(q.gamma),
            theta: num(q.theta),
            vega: num(q.vega),
            rho: num(q.rho),
            lambda: num(q.lambda),
            vanna: num(q.vanna),
            vomma: num(q.vomma),
            charm: num(q.charm),
            speed: num(q.speed),
            zomma: num(q.zomma),
            color: num(q.color),
            greeksSource: q.greeksSource === 'cboe' || q.greeksSource === 'black-scholes' || q.greeksSource === 'marketdata' || q.greeksSource === 'dolthub'
                ? q.greeksSource
                : null,
            greeksMissingReason: q.greeksMissingReason == null ? null : String(q.greeksMissingReason),
        }));
        const expirations = asArray<string>(j.expirations).length
            ? asArray<string>(j.expirations).map(String)
            : Array.from(new Set(quotes.map((q) => q.expiration).filter(Boolean))).sort();
        const greeks = j.greeks && typeof j.greeks === 'object' ? j.greeks as GreeksSummary : undefined;
        return { symbol: raw, underlyingPrice: num(j.underlyingPrice), expirations, quotes, greeks };
    },
};

/**
 * Query the companion proxy's unified suggestion endpoint. The local Bun proxy
 * and Cloudflare Worker both expose /api/search?provider=<id>&q=<text>, returning
 * normalized `{ suggestions: TickerSuggestion[] }`. If the proxy is unavailable,
 * callers fall back to data/options/index.json via suggestTickers().
 */
async function proxyTickerSuggestions(providerId: 'yahoo' | 'nasdaq' | 'cboe', query: string, ctx: ProviderContext): Promise<TickerSuggestion[]> {
    const q = query.trim();
    if (!q) return [];
    const base = (ctx.proxyBase || '').replace(/\/$/, '');
    if (!base) throw new Error('Proxy base URL is not configured for provider-native ticker search.');
    const url = `${base}/api/search?provider=${encodeURIComponent(providerId)}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctx.signal });
    if (!res.ok) throw new Error(`Ticker search proxy failed (HTTP ${res.status}).`);
    const json: any = await res.json().catch(() => null);
    const rows = Array.isArray(json?.suggestions) ? json.suggestions : [];
    return rows.map((r: any) => ({
        symbol: normalizeTickerSymbol(r.symbol),
        name: r.name ? String(r.name) : undefined,
        exchange: r.exchange ? String(r.exchange) : undefined,
        source: r.source ? String(r.source) : providerId.toUpperCase(),
        hasOptions: r.hasOptions !== false,
    })).filter((s: TickerSuggestion) => s.symbol && looksLikeTicker(s.symbol));
}

/**
 * Yahoo (via proxy) provider (LAZY, needs a proxy base URL).
 * The proxy (scripts/options-local-proxy.ts locally, or scripts/options-cloudflare-proxy.js
 * deployed) handles Yahoo's crumb/cookie flow and re-exposes CORS:*.
 * Endpoint: GET {base}/api/options?symbol=X[&date=YYYY-MM-DD]
 *   -> Yahoo optionChain JSON: result[0].expirationDates (unix), quote price,
 *      and options[0].calls/puts for the requested expiration.
 */
const yahooProvider: DataProvider = {
    id: 'yahoo',
    label: 'YAHOO',
    description:
        'Yahoo Finance via proxy (/api/options) — crumb/cookie handled by scripts/options-local-proxy.ts or Cloudflare Worker. ' +
        'Lazy per-expiration. No provider greeks; client Black-Scholes fills them when IV is present.',
    mode: 'lazy',
    setup: 'proxy',
    supportsToken: false,
    needsProxy: false,
    needsProxyBase: true,
    demoSymbol: undefined,
    needsKeyFor() { return false; },
    async suggestTickers(query, ctx) {
        // Provider-native full-text symbol search via the same companion proxy
        // that already handles Yahoo's CORS/crumb flow for option chains.
        return proxyTickerSuggestions('yahoo', query, ctx);
    },
    async fetchMeta(symbol, ctx) {
        const raw = symbol.toUpperCase().replace(/^[.]/, '');
        const base = (ctx.proxyBase || '').replace(/\/$/, '');
        if (!base) throw new Error('Set a Proxy base URL in Settings (e.g. http://localhost:8787).');
        const url = `${base}/api/options?symbol=${encodeURIComponent(raw)}`;
        dbg('yahoo fetchMeta', { raw, url });
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctx.signal });
        const j: any = await res.json().catch(() => null);
        const result = j?.optionChain?.result?.[0];
        if (!result) {
            const err = j?.optionChain?.error?.description || j?.error;
            throw new Error(err ? `Yahoo: ${err}` : `No option data for "${raw}". Check the symbol / proxy.`);
        }
        const expirations = asArray<number>(result.expirationDates)
            .map((ts) => new Date(ts * 1000).toISOString().slice(0, 10))
            .sort();
        const underlyingPrice = num(result?.quote?.regularMarketPrice);
        return { symbol: raw, underlyingPrice, expirations };
    },
    async fetchExpiration(symbol, expiration, ctx) {
        const raw = symbol.toUpperCase().replace(/^[.]/, '');
        const base = (ctx.proxyBase || '').replace(/\/$/, '');
        if (!base) throw new Error('Set a Proxy base URL in Settings (e.g. http://localhost:8787).');
        const url = `${base}/api/options?symbol=${encodeURIComponent(raw)}&date=${isoToUnix(expiration)}`;
        dbg('yahoo fetchExpiration', { raw, expiration, url });
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctx.signal });
        const j: any = await res.json().catch(() => null);
        const opt = j?.optionChain?.result?.[0]?.options?.[0];
        if (!opt) throw new Error('Yahoo returned no contracts for this expiration.');

        const map = (row: any, side: 'call' | 'put'): OptionQuote => {
            const bid = num(row.bid);
            const ask = num(row.ask);
            return {
                symbol: String(row.contractSymbol ?? ''),
                expiration,
                side,
                strike: num(row.strike) ?? 0,
                bid,
                ask,
                mid: computeMid(bid, ask),
                last: num(row.lastPrice),
                volume: num(row.volume),
                openInterest: num(row.openInterest),
                iv: num(row.impliedVolatility), // decimal
                delta: null, gamma: null, theta: null, vega: null, // Yahoo has no greeks
            };
        };
        return [
            ...asArray<any>(opt.calls).map((r) => map(r, 'call')),
            ...asArray<any>(opt.puts).map((r) => map(r, 'put')),
        ];
    },
};


/**
 * NASDAQ provider (BULK — free, no key, needs a proxy; no CORS of its own).
 * Endpoint (via proxy): {base}/api/nasdaq?symbol=AAPL[&assetclass=stocks|etf|index]
 * - NASDAQ returns the FULL chain (all expirations) in one call, as a table of
 *   rows where each row carries BOTH the call and put for a strike, plus a
 *   `drillDownURL` that embeds the OCC contract id (…aapl--260708c00225000).
 *   We parse expiry/side/strike from that OCC id, and read spot from
 *   data.lastTrade ("LAST TRADE: $313.39 (AS OF …)").
 * - No greeks in this feed; bid/ask/last/volume/openInterest per side. "--" and
 *   "N/A" are treated as null.
 * - Needs a proxy base ({base}/api/nasdaq) — same pattern as Yahoo/CBOE.
 */
/** Parse "$313.39" (or "LAST TRADE: $313.39 (AS OF …)") into a number|null. */
function parseNasdaqSpot(s: unknown): number | null {
    const m = /([0-9][0-9,]*\.?[0-9]*)/.exec(String(s ?? ''));
    return m ? num(m[1].replace(/,/g, '')) : null;
}
/** NASDAQ uses "--"/"N/A"/"" for missing cells; coerce those to null. */
function nq(v: unknown): number | null {
    const s = String(v ?? '').trim();
    if (!s || s === '--' || s.toUpperCase() === 'N/A') return null;
    return num(s.replace(/,/g, ''));
}
const nasdaqProvider: DataProvider = {
    id: 'nasdaq',
    label: 'NASDAQ',
    description:
        'NASDAQ option chain via proxy (/api/nasdaq) — full chain one call (bid/ask/last/volume/OI). ' +
        'No IV/greeks in feed (higher-order stay empty). Needs Proxy base URL.',
    mode: 'bulk',
    setup: 'proxy',
    supportsToken: false,
    needsProxy: true,       // generic CORS-proxy fallback allowed
    needsProxyBase: true,   // recommended path: {base}/api/nasdaq
    demoSymbol: 'AAPL',
    needsKeyFor() { return false; },
    async suggestTickers(query, ctx) {
        // NASDAQ's own autocomplete is proxied server-side and searched by both
        // ticker and company name; if unavailable, the app falls back to index.json.
        return proxyTickerSuggestions('nasdaq', query, ctx);
    },
    async fetchAll(symbol, ctx) {
        const raw = symbol.toUpperCase().replace(/^[_.]/, '');
        const base = (ctx.proxyBase || '').replace(/\/$/, '');
        // Direct NASDAQ URL (used only if routed via a generic {url} CORS proxy).
        const direct = `https://api.nasdaq.com/api/quote/${encodeURIComponent(raw)}/option-chain?assetclass=stocks&limit=10000&fromdate=all`;
        const url = base
            ? `${base}/api/nasdaq?symbol=${encodeURIComponent(raw)}`
            : proxied(direct, ctx.proxyTemplate);
        if (!base && (!ctx.proxyTemplate || ctx.proxyTemplate === '{url}')) {
            throw new Error('NASDAQ needs a proxy. Set the Proxy base URL in Settings (run scripts/options-local-proxy.ts, default http://localhost:8787), or pick a CORS proxy.');
        }
        dbg('nasdaq fetchAll', { raw, url });

        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctx.signal });
        if (!res.ok) throw new Error(`NASDAQ proxy request failed (HTTP ${res.status}). Check the Proxy base URL in Settings, or switch provider.`);
        const text = await res.text();
        let json: any;
        try { json = JSON.parse(text); }
        catch { throw new Error('The proxy returned a non-JSON page for NASDAQ. Check the Proxy base URL / CORS proxy in Settings.'); }

        const data = json?.data;
        const rows: any[] = data?.table?.rows;
        if (!data || !Array.isArray(rows)) {
            const em = json?.status?.bCodeMessage?.[0]?.errorMessage || json?.message;
            throw new Error(em ? `NASDAQ: ${em}` : `No option data for "${raw}". Check the ticker symbol.`);
        }

        const quotes: OptionQuote[] = [];
        for (const r of rows) {
            const strike = nq(r.strike);
            if (strike == null) continue; // skip "expirygroup" separator rows
            // Derive expiration from the OCC id embedded in drillDownURL.
            const parsed = parseOccSymbol(String(r.drillDownURL || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
            const expiration = parsed?.expiration ?? '';
            if (!expiration) continue;
            const cBid = nq(r.c_Bid), cAsk = nq(r.c_Ask);
            const pBid = nq(r.p_Bid), pAsk = nq(r.p_Ask);
            quotes.push({
                symbol: `${raw}C${strike}@${expiration}`,
                expiration, side: 'call', strike,
                bid: cBid, ask: cAsk, mid: computeMid(cBid, cAsk),
                last: nq(r.c_Last), volume: nq(r.c_Volume), openInterest: nq(r.c_Openinterest),
                iv: null, delta: null, gamma: null, theta: null, vega: null,
            });
            quotes.push({
                symbol: `${raw}P${strike}@${expiration}`,
                expiration, side: 'put', strike,
                bid: pBid, ask: pAsk, mid: computeMid(pBid, pAsk),
                last: nq(r.p_Last), volume: nq(r.p_Volume), openInterest: nq(r.p_Openinterest),
                iv: null, delta: null, gamma: null, theta: null, vega: null,
            });
        }
        if (quotes.length === 0) throw new Error(`No option data for "${raw}". Check the ticker symbol.`);
        const expirations = Array.from(new Set(quotes.map((q) => q.expiration).filter(Boolean))).sort();
        return { symbol: raw, underlyingPrice: parseNasdaqSpot(data.lastTrade), expirations, quotes };
    },
};

/**
 * CBOE provider (BULK — free, no key, ALL equities + indices, richest data).
 * Cash indices are prefixed with "_" (_SPX, _VIX...). CBOE's CDN sends NO CORS
 * header, so the browser CANNOT call it directly — it must be relayed. Two ways:
 *   1) A request-handling proxy base (RECOMMENDED): the local Bun server
 *      (scripts/options-local-proxy.ts also serves /api/cboe) or the Cloudflare Worker.
 *      Set "Proxy base URL" in Settings; we call {base}/api/cboe?symbol=XXX.
 *   2) A generic CORS proxy template ({url}) as a fallback (public ones flaky).
 */
const cboeProvider: DataProvider = {
    id: 'cboe',
    label: 'CBOE',
    description:
        'CBOE delayed options via proxy (/api/cboe) — equities & indices, greeks/IV/OI + spot. ' +
        'Default on localhost when proxy is available. Needs Proxy base URL.',
    mode: 'bulk',
    setup: 'proxy',
    supportsToken: false,
    needsProxy: true,       // shows the CORS-proxy dropdown (fallback path)
    needsProxyBase: true,   // shows the Proxy base URL field (recommended path)
    needsKeyFor() { return false; },
    async suggestTickers(query, ctx) {
        // CBOE's symbol book is a large no-CORS JSON file, so the proxy searches
        // it server-side and returns a small normalized suggestion list.
        return proxyTickerSuggestions('cboe', query, ctx);
    },
    async fetchAll(symbol, ctx) {
        const INDEX_SET = new Set(['SPX', 'VIX', 'NDX', 'RUT', 'DJX', 'XSP', 'OEX', 'VXN']);
        const raw = symbol.toUpperCase().replace(/^[_.]/, '');
        const cboeSym = INDEX_SET.has(raw) ? `_${raw}` : raw;
        const target = `https://cdn.cboe.com/api/global/delayed_quotes/options/${cboeSym}.json`;

        // Prefer a request-handling proxy base ({base}/api/cboe) if configured;
        // otherwise fall back to the generic CORS-proxy template.
        const base = (ctx.proxyBase || '').replace(/\/$/, '');
        const url = base
            ? `${base}/api/cboe?symbol=${encodeURIComponent(cboeSym)}`
            : proxied(target, ctx.proxyTemplate);
        if (!base && (!ctx.proxyTemplate || ctx.proxyTemplate === '{url}')) {
            throw new Error('CBOE needs a proxy. Set the Proxy base URL in Settings (run scripts/options-local-proxy.ts, default http://localhost:8787), or pick a CORS proxy.');
        }

        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctx.signal });
        if (!res.ok) throw new Error(`CBOE proxy request failed (HTTP ${res.status}). Check the Proxy base URL / CORS proxy in Settings, or switch provider.`);
        const text = await res.text();
        let json: any;
        try { json = JSON.parse(text); }
        catch { throw new Error('The proxy returned a non-JSON page. Check the Proxy base URL / CORS proxy in Settings, or use CACHE (static data).'); }
        const data = json?.data;
        if (!data || !Array.isArray(data.options)) throw new Error(`No option data for "${raw}". Check the ticker symbol.`);
        const quotes: OptionQuote[] = [];
        for (const o of data.options) {
            const parsed = parseOccSymbol(String(o.option ?? ''));
            if (!parsed) continue;
            const bid = num(o.bid);
            const ask = num(o.ask);
            quotes.push({
                symbol: String(o.option),
                expiration: parsed.expiration,
                side: parsed.side,
                strike: parsed.strike,
                bid, ask, mid: computeMid(bid, ask),
                last: num(o.last_trade_price),
                volume: num(o.volume),
                openInterest: num(o.open_interest),
                iv: num(o.iv), delta: num(o.delta), gamma: num(o.gamma), theta: num(o.theta), vega: num(o.vega), rho: num(o.rho),
            });
        }
        const expirations = Array.from(new Set(quotes.map((q) => q.expiration))).sort();
        return { symbol: raw, underlyingPrice: num(data.current_price) ?? num(data.close), expirations, quotes };
    },
};

/**
 * Provider registry — only four sources, fixed dropdown order everywhere:
 *   CACHE  = same-origin static data/options/*.json (no proxy)
 *   CBOE   = delayed options via proxy /api/cboe
 *   NASDAQ = full chain via proxy /api/nasdaq
 *   YAHOO  = option chain via proxy /api/options (lazy)
 *
 * Order never changes: CACHE, CBOE, NASDAQ, YAHOO.
 * Host only picks the DEFAULT selection:
 *   - localhost / LAN              -> CBOE (proxy expected)
 *   - GitHub Pages / hosted static -> CACHE (no proxy required)
 */
const PROVIDERS: DataProvider[] = [
    staticProvider,  // CACHE
    cboeProvider,    // CBOE
    nasdaqProvider,  // NASDAQ
    yahooProvider,   // YAHOO
];

/** Live proxy providers only (no CACHE). Used when CACHE/LIVE toggle is LIVE. */
const LIVE_PROVIDERS: DataProvider[] = PROVIDERS.filter((p) => p.id !== 'static');

/**
 * Are we running locally (localhost / 127.* / 0.0.0.0 / *.local / private LAN)?
 * Local -> default CBOE; hosted (e.g. GitHub Pages) -> default CACHE.
 */
function isLocalHost(): boolean {
    try {
        const h = window.location.hostname;
        return (
            h === 'localhost' || h === '0.0.0.0' || h === '::1' || h.endsWith('.local') ||
            /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(h)
        );
    } catch { return false; }
}

/** Default provider id for this host — not the same as dropdown order. */
function defaultProviderId(): string {
    return isLocalHost() ? 'cboe' : 'static';
}

/** Curated public CORS proxies for CBOE. "{url}" = encoded target URL. */
const PROXY_PRESETS: { label: string; template: string }[] = [
    { label: 'AllOrigins (raw)', template: 'https://api.allorigins.win/raw?url={url}' },
    { label: 'Corsproxy.io', template: 'https://corsproxy.io/?url={url}' },
    { label: 'Codetabs', template: 'https://api.codetabs.com/v1/proxy/?quest={url}' },
    { label: 'Your Worker (/raw?url=)', template: '{worker}/raw?url={url}' },
    { label: 'None (direct — will fail unless host allows CORS)', template: '{url}' },
];

// ============================================================================
// PERSISTENT QUERY CACHE (localStorage, size-aware LRU eviction)
// ============================================================================

/**
 * Every successful query is stored in localStorage so it survives reloads and
 * lets us serve from cache without spending another request. Because
 * localStorage is small (~5 MB) and can throw QuotaExceededError, we track the
 * approximate byte size and, BEFORE writing, evict the LEAST-RECENTLY-USED
 * (oldest `ts`) records until the new entry fits under CACHE_MAX_BYTES. If a
 * write still throws quota, we evict-and-retry until it succeeds or the cache
 * is empty. (Per the requirement: when storage would be exceeded, drop the
 * oldest records first, then store.)
 */
const CACHE_PREFIX = 'options-desk.cache.'; // one localStorage key per entry
const CACHE_INDEX_KEY = 'options-desk.cache.index.v1'; // {key: {ts,size}} map
const CACHE_MAX_BYTES = 4_000_000; // stay well under the ~5 MB localStorage cap

/**
 * Tiny pub/sub so the Settings → Cache stats update LIVE (no manual refresh)
 * whenever anything writes/clears the cache. React components subscribe with
 * useCacheVersion(); every mutation calls notifyCacheChanged().
 */
const cacheListeners = new Set<() => void>();
function notifyCacheChanged(): void { cacheListeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } }); }
function subscribeCache(fn: () => void): () => void { cacheListeners.add(fn); return () => cacheListeners.delete(fn); }

interface CacheMeta { ts: number; size: number; }
type CacheIndex = Record<string, CacheMeta>;

function cacheLoadIndex(): CacheIndex {
    try { return JSON.parse(localStorage.getItem(CACHE_INDEX_KEY) || '{}'); }
    catch { return {}; }
}
function cacheSaveIndex(ix: CacheIndex): void {
    try { localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(ix)); } catch { /* ignore */ }
}
function cacheTotalBytes(ix: CacheIndex): number {
    let n = 0;
    for (const k in ix) n += ix[k].size;
    return n;
}
/** Remove a single cache entry (both its data key and its index record). */
function cacheDrop(ix: CacheIndex, key: string): void {
    try { localStorage.removeItem(CACHE_PREFIX + key); } catch { /* ignore */ }
    delete ix[key];
}
/** Evict oldest-first until total + `incoming` fits under CACHE_MAX_BYTES. */
function cacheEvictToFit(ix: CacheIndex, incoming: number): void {
    if (incoming > CACHE_MAX_BYTES) return; // a single huge entry: caller handles
    const byOldest = Object.keys(ix).sort((a, b) => ix[a].ts - ix[b].ts);
    let i = 0;
    while (cacheTotalBytes(ix) + incoming > CACHE_MAX_BYTES && i < byOldest.length) {
        dbg('cache evict (size)', byOldest[i]);
        cacheDrop(ix, byOldest[i]);
        i++;
    }
}
/** Read a cached JSON value by key (updates its LRU timestamp on hit). */
function cacheGet<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + key);
        if (raw == null) return null;
        const ix = cacheLoadIndex();
        if (ix[key]) { ix[key].ts = Date.now(); cacheSaveIndex(ix); } // touch LRU
        return JSON.parse(raw) as T;
    } catch { return null; }
}
/**
 * Write a cached JSON value. Evicts oldest entries first if needed, and retries
 * on QuotaExceededError by dropping more oldest entries until it fits.
 */
function cacheSet(key: string, value: unknown): void {
    let payload: string;
    try { payload = JSON.stringify(value); } catch { return; }
    const size = payload.length + key.length + 32; // rough byte estimate
    const ix = cacheLoadIndex();
    // Replacing an existing key frees its old size first.
    if (ix[key]) cacheDrop(ix, key);
    cacheEvictToFit(ix, size);

    for (let attempt = 0; attempt < 50; attempt++) {
        try {
            localStorage.setItem(CACHE_PREFIX + key, payload);
            ix[key] = { ts: Date.now(), size };
            cacheSaveIndex(ix);
            notifyCacheChanged(); // live-update stats
            return;
        } catch {
            // Quota still exceeded — drop the oldest remaining entry and retry.
            const oldest = Object.keys(ix).sort((a, b) => ix[a].ts - ix[b].ts)[0];
            if (!oldest) { dbg('cache: cannot fit even after full eviction'); notifyCacheChanged(); return; }
            dbg('cache evict (quota retry)', oldest);
            cacheDrop(ix, oldest);
            cacheSaveIndex(ix);
        }
    }
}

/**
 * Format a byte count as a human string (B / KB / MB).
 */
function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Snapshot of cache usage for the Settings → Cache stats panel. */
interface CacheStats {
    entries: number;      // number of cached query records
    bytes: number;        // approx bytes used by cached data (from the index)
    maxBytes: number;     // configured soft cap (CACHE_MAX_BYTES)
    oldest: number | null;// ts of the oldest record (ms) or null
    newest: number | null;// ts of the newest record (ms) or null
    settingsBytes: number;// approx bytes used by the settings blob
}

/** Compute current cache statistics (data entries + settings size). */
function cacheStats(): CacheStats {
    const ix = cacheLoadIndex();
    const keys = Object.keys(ix);
    let oldest: number | null = null;
    let newest: number | null = null;
    for (const k of keys) {
        const ts = ix[k].ts;
        if (oldest == null || ts < oldest) oldest = ts;
        if (newest == null || ts > newest) newest = ts;
    }
    let settingsBytes = 0;
    try { settingsBytes = (localStorage.getItem(SETTINGS_KEY) || '').length; } catch { /* ignore */ }
    return {
        entries: keys.length,
        bytes: cacheTotalBytes(ix),
        maxBytes: CACHE_MAX_BYTES,
        oldest,
        newest,
        settingsBytes,
    };
}

/**
 * CLEAR DATA — remove only the QUERIED DATA cache (everything we downloaded when
 * fetching chains), leaving user settings intact. Also clears the in-memory
 * bulk cache so the next query re-fetches fresh.
 */
function clearCacheData(): void {
    const ix = cacheLoadIndex();
    for (const k of Object.keys(ix)) {
        try { localStorage.removeItem(CACHE_PREFIX + k); } catch { /* ignore */ }
    }
    try { localStorage.removeItem(CACHE_INDEX_KEY); } catch { /* ignore */ }
    // Defensive sweep: drop any stray cache-prefixed keys not in the index.
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
        }
    } catch { /* ignore */ }
    bulkCache.clear();
    notifyCacheChanged(); // live-update stats
    dbg('cache: cleared DATA');
}

/**
 * CLEAR SETTINGS — remove only the persisted settings (provider/theme/keys/
 * proxy/lastTicker), leaving the queried data cache intact. The app reverts to
 * DEFAULT_SETTINGS on next load / next read.
 */
function clearSettingsStore(): void {
    try { localStorage.removeItem(SETTINGS_KEY); } catch { /* ignore */ }
    notifyCacheChanged(); // live-update stats (settings size)
    dbg('cache: cleared SETTINGS');
}

/**
 * CLEAR ALL — wipe EVERYTHING this app stored in localStorage (data + settings +
 * any legacy/older-versioned keys under our namespace).
 */
function clearAll(): void {
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith('options-desk.')) localStorage.removeItem(k);
        }
    } catch { /* ignore */ }
    bulkCache.clear();
    notifyCacheChanged(); // live-update stats
    dbg('cache: cleared ALL');
}

// ============================================================================
// PROVIDER DISPATCH + CACHE
// ============================================================================

/**
 * In-memory cache for BULK providers (fast within a session), keyed by
 * `${providerId}:${SYMBOL}`. Backed by the persistent localStorage cache above
 * so results also survive reloads.
 */
const bulkCache = new Map<string, ChainResult>();
const bulkKey = (providerId: string, symbol: string) => `${providerId}:${symbol.toUpperCase()}`;

/** True when a bulk ChainResult already has model/higher-order greeks on quotes. */
function chainLooksEnriched(result: ChainResult): boolean {
    const qs = result.quotes;
    if (!qs.length) return true;
    // Sample a few rows — static cache & post-enrichment results fill higher-order.
    for (let i = 0; i < qs.length && i < 12; i++) {
        if (hasHigherOrderGreeks(qs[i]) || qs[i].greeksSource === 'black-scholes') return true;
    }
    // If every sampled row has no IV and no first-order, enrichment cannot help
    // (e.g. NASDAQ) — treat as "done" so we don't re-walk on every cache hit.
    let canModel = false;
    for (let i = 0; i < qs.length && i < 24; i++) {
        if (num(qs[i].iv) != null || hasFirstOrderGreeks(qs[i])) { canModel = true; break; }
    }
    return !canModel;
}

/** Get a bulk result from memory, then persistent cache; re-enrich stale cache. */
function getBulk(providerId: string, symbol: string): ChainResult | null {
    const k = bulkKey(providerId, symbol);
    const mem = bulkCache.get(k);
    if (mem) {
        if (chainLooksEnriched(mem)) return mem;
        const fixed = enrichChainResult(mem);
        bulkCache.set(k, fixed);
        cacheSet(k, fixed);
        return fixed;
    }
    const disk = cacheGet<ChainResult>(k);
    if (disk) {
        const fixed = chainLooksEnriched(disk) ? disk : enrichChainResult(disk);
        bulkCache.set(k, fixed);
        if (fixed !== disk) cacheSet(k, fixed);
        return fixed;
    }
    return null;
}
/** Store a bulk result (always model-enriched) in memory + persistent cache. */
function putBulk(providerId: string, result: ChainResult): void {
    const enriched = enrichChainResult(result);
    const k = bulkKey(providerId, enriched.symbol);
    bulkCache.set(k, enriched);
    cacheSet(k, enriched);
}
/** Cache key for a single lazy expiration. */
const lazyKey = (providerId: string, symbol: string, exp: string) =>
    `${providerId}:${symbol.toUpperCase()}:${exp}`;

/** Load chain metadata (expirations + spot) for the active provider. */
async function loadMeta(provider: DataProvider, symbol: string, ctx: ProviderContext): Promise<ChainMeta> {
    if (provider.mode === 'bulk') {
        if (!provider.fetchAll) throw new Error('Provider misconfigured (bulk without fetchAll).');
        const result = await provider.fetchAll(symbol, ctx);
        putBulk(provider.id, result);
        const cached = getBulk(provider.id, result.symbol) ?? enrichChainResult(result);
        return { symbol: cached.symbol, underlyingPrice: cached.underlyingPrice, expirations: cached.expirations, greeks: cached.greeks };
    }
    if (!provider.fetchMeta) throw new Error('Provider misconfigured (lazy without fetchMeta).');
    const meta = await provider.fetchMeta(symbol, ctx);
    // Persist meta so expirations survive reloads (cheap; keyed with ":meta").
    cacheSet(lazyKey(provider.id, meta.symbol, 'meta'), meta);
    return meta;
}

/** Load the quotes for one expiration for the active provider (cached + enriched). */
async function loadExpiration(provider: DataProvider, symbol: string, expiration: string, ctx: ProviderContext): Promise<OptionQuote[]> {
    if (provider.mode === 'bulk') {
        const cached = getBulk(provider.id, symbol);
        const result = cached ?? (provider.fetchAll ? await provider.fetchAll(symbol, ctx) : null);
        if (result && !cached) putBulk(provider.id, result);
        const final = getBulk(provider.id, symbol) ?? (result ? enrichChainResult(result) : null);
        return (final?.quotes ?? []).filter((q) => q.expiration === expiration);
    }
    if (!provider.fetchExpiration) throw new Error('Provider misconfigured (lazy without fetchExpiration).');
    // Serve a lazy expiration from the persistent cache when available.
    const key = lazyKey(provider.id, symbol, expiration);
    const hit = cacheGet<OptionQuote[]>(key);
    if (hit) {
        dbg('cache hit (lazy)', key);
        // Re-enrich legacy cache entries that predate client-side BS.
        if (hit.some((q) => hasHigherOrderGreeks(q) || q.greeksSource === 'black-scholes')) return hit;
        const meta = cacheGet<ChainMeta>(lazyKey(provider.id, symbol, 'meta'));
        const enriched = enrichQuotesWithModelGreeks(hit, meta?.underlyingPrice ?? null);
        if (enriched !== hit) cacheSet(key, enriched);
        return enriched;
    }
    const quotes = await provider.fetchExpiration(symbol, expiration, ctx);
    const meta = cacheGet<ChainMeta>(lazyKey(provider.id, symbol, 'meta'));
    const enriched = enrichQuotesWithModelGreeks(quotes, meta?.underlyingPrice ?? null);
    cacheSet(key, enriched);
    return enriched;
}

// ============================================================================
// SETTINGS STORE (persisted in localStorage)
// ============================================================================

type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Shared color palettes across daggerok apps (fundamentals + options-desk).
 * Each product keeps its native default; the other palette is selectable so a
 * future merge ships with both UIs already consistent.
 *  - options-desk  → Indigo Desk     (indigo accents, slate-900 dark surface)  [default here]
 *  - fundamentals  → Emerald Ledger (emerald accents, slate-950 dark surface)
 */
type ColorThemeId = 'fundamentals' | 'options-desk';
const COLOR_THEME_IDS: ColorThemeId[] = ['fundamentals', 'options-desk'];
const DEFAULT_COLOR_THEME: ColorThemeId = 'options-desk';

function normalizeColorTheme(v: unknown): ColorThemeId {
    return v === 'fundamentals' ? 'fundamentals' : DEFAULT_COLOR_THEME;
}

interface SideColumnSettings {
    openInterest: boolean;
    volume: boolean;
    iv: boolean;
    delta: boolean;
    gamma: boolean;
    theta: boolean;
    vega: boolean;
    rho: boolean;
    // higher-order greeks
    lambda: boolean;
    vanna: boolean;
    vomma: boolean;
    charm: boolean;
    speed: boolean;
    zomma: boolean;
    color: boolean;
}

interface DeskColumnSettings {
    calls: SideColumnSettings;
    puts: SideColumnSettings;
}

interface Settings {
    providerId: string;
    language: Language;
    theme: ThemeMode;
    /** Shared product color palette (Emerald Ledger / Indigo Desk). */
    colorTheme: ColorThemeId;
    proxyTemplate: string;
    /** Base URL of the request-handling proxy (Yahoo/worker). */
    proxyBase: string;
    /** Optional Cloudflare Worker origin, substituted into {worker} templates. */
    workerUrl: string;
    /** Per-provider API keys, so switching providers keeps each key. */
    tokens: Record<string, string>;
    /** Per-provider API secrets (for KEY+SECRET providers like Alpaca). */
    secrets: Record<string, string>;
    /** Column groups shown in the options desk. Greeks are enabled by default. */
    deskColumns: DeskColumnSettings;
    lastTicker: string;
}

const SETTINGS_KEY = 'options-desk.settings.v5';

const DEFAULT_SETTINGS: Settings = {
    // Host-aware default selection; dropdown order stays CACHE, CBOE, NASDAQ, YAHOO.
    providerId: defaultProviderId(),
    language: DEFAULT_LANGUAGE,
    theme: 'system',
    colorTheme: DEFAULT_COLOR_THEME,
    proxyTemplate: PROXY_PRESETS[0].template,
    proxyBase: 'http://localhost:8787',    // local Bun Yahoo proxy default
    workerUrl: '',
    tokens: {},
    secrets: {},
    deskColumns: {
        calls: { openInterest: true, volume: true, iv: true, delta: true, gamma: true, theta: true, vega: true, rho: false, lambda: false, vanna: false, vomma: false, charm: false, speed: false, zomma: false, color: false },
        puts: { openInterest: true, volume: true, iv: true, delta: true, gamma: true, theta: true, vega: true, rho: false, lambda: false, vanna: false, vomma: false, charm: false, speed: false, zomma: false, color: false },
    },
    lastTicker: 'AAPL',
};

/** Fresh settings object with the current host default (not a shared mutable ref). */
function freshDefaultSettings(): Settings {
    return { ...DEFAULT_SETTINGS, providerId: defaultProviderId() };
}

/** Load settings from localStorage, merged over defaults (forward-compatible). */
function loadSettings(): Settings {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return freshDefaultSettings();
        const parsed = JSON.parse(raw);
        const hostDefault = defaultProviderId();
        const merged: Settings = {
            ...DEFAULT_SETTINGS,
            ...parsed,
            language: (parsed.language && LANGUAGES.includes(parsed.language) ? parsed.language : DEFAULT_LANGUAGE) as Language,
            colorTheme: normalizeColorTheme(parsed.colorTheme),
            tokens: { ...DEFAULT_SETTINGS.tokens, ...(parsed.tokens || {}) },
            secrets: { ...DEFAULT_SETTINGS.secrets, ...(parsed.secrets || {}) },
            deskColumns: {
                calls: { ...DEFAULT_SETTINGS.deskColumns.calls, ...((parsed.deskColumns as any)?.calls || {}) },
                puts: { ...DEFAULT_SETTINGS.deskColumns.puts, ...((parsed.deskColumns as any)?.puts || {}) },
            },
        };
        // Drop removed providers (marketdata, dolthub, …) → fall back to host default.
        if (!PROVIDERS.some((p) => p.id === merged.providerId)) {
            merged.providerId = hostDefault;
        }
        return merged;
    } catch {
        return freshDefaultSettings();
    }
}

/** Persist settings to localStorage (best-effort; ignores quota errors). */
function saveSettings(s: Settings): void {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/**
 * Build the ProviderContext for a provider from settings.
 * Resolves the {worker} placeholder in the CBOE proxy template using workerUrl.
 */
function ctxFor(settings: Settings, provider: DataProvider, signal?: AbortSignal): ProviderContext {
    const template = settings.proxyTemplate.replace('{worker}', (settings.workerUrl || '').replace(/\/$/, ''));
    return {
        proxyTemplate: template,
        proxyBase: settings.proxyBase,
        token: settings.tokens[provider.id] || '',
        secret: settings.secrets[provider.id] || '',
        signal,
    };
}

// ============================================================================
// THEME CONTROLLER (hook)
// ============================================================================

/**
 * Applies the chosen theme by toggling the `.dark` class on <html>.
 * For 'system', it subscribes to the OS color-scheme media query and updates
 * live if the user flips their system theme while the app is open.
 */
function useThemeController(theme: ThemeMode, colorTheme: ColorThemeId = DEFAULT_COLOR_THEME): void {
    useEffect(() => {
        const root = document.documentElement;
        const mql = window.matchMedia('(prefers-color-scheme: dark)');
        const apply = () => {
            const isDark = theme === 'dark' || (theme === 'system' && mql.matches);
            root.classList.toggle('dark', isDark);
            root.dataset.palette = colorTheme;
            dbg('theme applied', { theme, colorTheme, isDark });
        };
        apply();
        if (theme === 'system') {
            mql.addEventListener('change', apply);
            return () => mql.removeEventListener('change', apply);
        }
        return undefined;
    }, [theme, colorTheme]);
}

// ============================================================================
// SMALL PRESENTATIONAL COMPONENTS
// ============================================================================

/** Inline SVG icons (no external assets — preview-safe, per project rules). */
const Icon = {
    Gear: (p: { className?: string }) => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round" className={p.className}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    ),
    Sun: (p: { className?: string }) => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round" className={p.className}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
    ),
    Moon: (p: { className?: string }) => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round" className={p.className}>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
    ),
    Monitor: (p: { className?: string }) => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round" className={p.className}>
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
        </svg>
    ),
    Search: (p: { className?: string }) => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round" className={p.className}>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
        </svg>
    ),
    Key: (p: { className?: string }) => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round" className={p.className}>
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" />
        </svg>
    ),
    External: (p: { className?: string }) => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round" className={p.className}>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
        </svg>
    ),
    X: (p: { className?: string }) => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" className={p.className}>
            <path d="M18 6 6 18M6 6l12 12" />
        </svg>
    ),
};

/** Small pill that communicates how much setup a provider needs. */
const SetupBadge: React.FC<{ provider: DataProvider; hasKey: boolean }> = ({ provider, hasKey }) => {
    const { t } = useI18n();
    let text = '';
    let cls = '';
    if (provider.setup === 'none') { text = t('setupBadge.noSetup'); cls = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'; }
    else if (provider.setup === 'key') { text = hasKey ? t('setupBadge.keySet') : t('setupBadge.freeKey'); cls = hasKey ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400'; }
    else { text = t('setupBadge.needsProxy'); cls = 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'; }
    return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{text}</span>;
};

/**
 * Compact theme picker: shows only the current theme icon. Clicking it toggles a
 * small animated menu with the other themes; Escape/click-away closes it.
 */

/** Resolve accent Tailwind classes for the selected shared color palette. */
function accentOf(colorTheme: ColorThemeId) {
    const isFund = colorTheme === 'fundamentals';
    return {
        brand: isFund ? 'bg-emerald-600' : 'bg-indigo-600',
        brandSoft: isFund
            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
            : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400',
        btn: isFund ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700',
        focusRing: isFund ? 'focus:ring-emerald-500' : 'focus:ring-indigo-500',
        focusRingOffset: isFund
            ? 'focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1 dark:focus:ring-offset-slate-900'
            : 'focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 dark:focus:ring-offset-slate-900',
        open: isFund
            ? 'scale-105 border-emerald-500 bg-emerald-50 text-emerald-600 shadow-sm dark:bg-emerald-950/40 dark:text-emerald-400'
            : 'scale-105 border-indigo-500 bg-indigo-50 text-indigo-600 shadow-sm dark:bg-indigo-950/40 dark:text-indigo-400',
        menuHover: isFund
            ? 'hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300'
            : 'hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300',
        menuActive: isFund
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
        link: isFund
            ? 'text-emerald-600 hover:underline dark:text-emerald-400'
            : 'text-indigo-600 hover:underline dark:text-indigo-400',
        borderHover: isFund
            ? 'hover:border-emerald-300 dark:hover:border-emerald-700'
            : 'hover:border-indigo-300 dark:hover:border-indigo-700',
        accentInput: isFund ? 'accent-emerald-600' : 'accent-indigo-600',
        openBorder: isFund
            ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
            : 'border-indigo-500 text-indigo-600 dark:text-indigo-400',
        chipActive: isFund
            ? 'border-emerald-500 bg-emerald-600 text-white shadow-sm'
            : 'border-indigo-500 bg-indigo-600 text-white shadow-sm',
        chipIdle: 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 ' +
            (isFund ? 'hover:border-emerald-400 hover:-translate-y-px' : 'hover:border-indigo-400 hover:-translate-y-px'),
        greek: isFund
            ? 'text-emerald-600 dark:text-emerald-300'
            : 'text-indigo-600 dark:text-indigo-300',
        mid: isFund
            ? 'font-medium text-teal-600 dark:text-teal-400'
            : 'font-medium text-emerald-600 dark:text-emerald-400',
        pulse: isFund ? 'text-emerald-500' : 'text-indigo-500',
        headerBg: isFund
            ? 'bg-white/80 dark:bg-slate-950/80'
            : 'bg-white/80 dark:bg-slate-900/80',
        suggestHover: isFund
            ? 'hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
            : 'hover:bg-indigo-50 dark:hover:bg-indigo-950/40',
        suggestActive: isFund
            ? 'bg-emerald-50 dark:bg-emerald-950/40'
            : 'bg-indigo-50 dark:bg-indigo-950/40',
        atm: isFund
            ? 'text-emerald-700 dark:text-emerald-300'
            : 'text-indigo-700 dark:text-indigo-300',
        expHover: isFund
            ? 'hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400'
            : 'hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400',
    } as const;
}

const ThemeSwitch: React.FC<{ value: ThemeMode; onChange: (theme: ThemeMode) => void; colorTheme?: ColorThemeId }> = ({ value, onChange, colorTheme = DEFAULT_COLOR_THEME }) => {
    const { t } = useI18n();
    const ax = accentOf(colorTheme);
    const options: { id: ThemeMode; icon: React.FC<{ className?: string }>; title: string }[] = [
        { id: 'light', icon: Icon.Sun, title: t('theme.light') },
        { id: 'system', icon: Icon.Monitor, title: t('theme.system') },
        { id: 'dark', icon: Icon.Moon, title: t('theme.dark') },
    ];
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const current = options.find((o) => o.id === value) ?? options[1];
    const CurrentIcon = current.icon;
    const choices = options.filter((o) => o.id !== value);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        const onPointer = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('mousedown', onPointer);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('mousedown', onPointer);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                title={`${current.title} theme`}
                aria-label={`${current.title} theme`}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={
                    'flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-150 ' +
                    (open
                        ? ax.open
                        : 'border-slate-300 dark:border-slate-700 text-slate-500 hover:-translate-y-px hover:text-slate-800 dark:hover:text-slate-200')
                }
            >
                <CurrentIcon className="h-4 w-4 transition-transform duration-150" />
            </button>
            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-10 z-50 w-36 origin-top-right animate-fade-in rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/10"
                >
                    {choices.map((o) => {
                        const IconCmp = o.icon;
                        return (
                            <button
                                key={o.id}
                                type="button"
                                role="menuitem"
                                onClick={() => { onChange(o.id); setOpen(false); }}
                                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 transition-all duration-150 dark:text-slate-200 ${ax.menuHover}`}
                            >
                                <IconCmp className="h-4 w-4" />
                                <span>{o.title}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};


/**
 * Compact color-palette switcher (Emerald Ledger / Indigo Desk).
 * Shared with fundamentals so both apps can preview each other's skin.
 */
const ColorThemeSwitch: React.FC<{ value: ColorThemeId; onChange: (c: ColorThemeId) => void }> = ({ value, onChange }) => {
    const { t } = useI18n();
    const ax = accentOf(value);
    const options: { id: ColorThemeId; swatch: string; title: string }[] = [
        { id: 'options-desk', swatch: 'bg-indigo-500', title: t('colorTheme.options-desk') },
        { id: 'fundamentals', swatch: 'bg-emerald-500', title: t('colorTheme.fundamentals') },
    ];
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const current = options.find((o) => o.id === value) ?? options[0];
    const choices = options.filter((o) => o.id !== value);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        const onPointer = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('mousedown', onPointer);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('mousedown', onPointer);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                title={current.title}
                aria-label={current.title}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={
                    'flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-150 ' +
                    (open
                        ? ax.open
                        : 'border-slate-300 dark:border-slate-700 text-slate-500 hover:-translate-y-px hover:text-slate-800 dark:hover:text-slate-200')
                }
            >
                <span className={`h-3.5 w-3.5 rounded-full ${current.swatch} ring-2 ring-white dark:ring-slate-900`} />
            </button>
            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-10 z-50 w-44 origin-top-right animate-fade-in rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/10"
                >
                    {choices.map((o) => (
                        <button
                            key={o.id}
                            type="button"
                            role="menuitem"
                            onClick={() => { onChange(o.id); setOpen(false); }}
                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 transition-all duration-150 dark:text-slate-200 ${ax.menuHover}`}
                        >
                            <span className={`h-3.5 w-3.5 rounded-full ${o.swatch}`} />
                            <span>{o.title}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * Compact language switcher: shows a globe icon + current language code.
 * Clicking it toggles a small animated menu; Escape/click-away closes it.
 */
const LanguageSwitch: React.FC<{ value: Language; onChange: (l: Language) => void; colorTheme?: ColorThemeId }> = ({ value, onChange, colorTheme = DEFAULT_COLOR_THEME }) => {
    const { t } = useI18n();
    const ax = accentOf(colorTheme);
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        const onPointer = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('mousedown', onPointer);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('mousedown', onPointer);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                title={t('topBar.language')}
                aria-label={t('topBar.language')}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={
                    'flex h-8 items-center gap-1 rounded-lg border px-1.5 transition-all duration-150 ' +
                    (open
                        ? ax.open
                        : 'border-slate-300 dark:border-slate-700 text-slate-500 hover:-translate-y-px hover:text-slate-800 dark:hover:text-slate-200')
                }
            >
                <span className="text-base leading-none" aria-hidden="true">{LANG_FLAGS[value]}</span>
                <span className="text-xs font-semibold uppercase">{value}</span>
            </button>
            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-10 z-50 w-36 origin-top-right animate-fade-in rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/10"
                >
                    {LANGUAGES.map((l) => (
                        <button
                            key={l}
                            type="button"
                            role="menuitem"
                            onClick={() => { onChange(l); setOpen(false); }}
                            className={
                                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-all duration-150 ' +
                                (l === value
                                    ? ax.menuActive
                                    : 'text-slate-700 dark:text-slate-200 ' + ax.menuHover)
                            }
                        >
                            <span className="text-base leading-none" aria-hidden="true">{LANG_FLAGS[l]}</span>
                            <span>{t(`language.${l}`)}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

// ============================================================================
// SETTINGS PANEL (popover opened by the gear button)
// ============================================================================

const SettingsPanel: React.FC<{
    settings: Settings;
    provider: DataProvider;
    onChange: (patch: Partial<Settings>) => void;
    onSetToken: (providerId: string, token: string) => void;
    onSetSecret: (providerId: string, secret: string) => void;
    /** Cache actions (return the fresh stats to refresh the panel). */
    onClearData: () => void;
    onClearSettings: () => void;
    onClearAll: () => void;
    onClose: () => void;
    /** When true, render body only (no absolute popover chrome) — used inside fundamentals-style settings card. */
    embedded?: boolean;
}> = ({ settings, provider, onChange, onSetToken, onSetSecret, onClearData, onClearSettings, onClearAll, onClose, embedded = false }) => {
    const { t, lang } = useI18n();
    const ax = accentOf(settings.colorTheme);
    const currentToken = settings.tokens[provider.id] || '';
    const currentSecret = settings.secrets[provider.id] || '';
    // Cache stats — recompute on any cache mutation (LIVE, no manual refresh):
    // subscribe to the cache pub/sub so fetching or clearing updates the numbers
    // immediately while the panel is open.
    const [statsNonce, setStatsNonce] = useState(0);
    useEffect(() => subscribeCache(() => setStatsNonce((n) => n + 1)), []);
    const stats = useMemo(() => cacheStats(), [statsNonce]);
    const pct = stats.maxBytes > 0 ? Math.min(100, Math.round((stats.bytes / stats.maxBytes) * 100)) : 0;
    const fmtTs = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : '—');
    // Two-step confirm for destructive actions (armed button id).
    const [armed, setArmed] = useState<string>('');
    const bump = () => setStatsNonce((n) => n + 1);
    return (
        <>
            {/* Click-away backdrop (standalone popover only) */}
            {!embedded && <div className="fixed inset-0 z-40" onClick={onClose} />}
            <div
                className={embedded
            ? "themed-scroll max-h-[50vh] overflow-auto space-y-3"
            : "themed-scroll absolute right-0 top-11 z-50 max-h-[80vh] w-80 origin-top-right animate-fade-in overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-xl"}
                role={embedded ? undefined : 'dialog'}
                aria-label={embedded ? undefined : t('settings.title')}
            >
                {!embedded && (
                  <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{t('settings.title')}</h2>
                )}

                <p className="mb-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {providerDescription(provider.id, lang)}
                </p>

                {/* API key (and optional secret) — for token-capable providers. */}
                {provider.supportsToken && (
                    <div className="mb-3">
                        <div className="mb-1 flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                {provider.keyLabel || t('settings.apiKey')}
                            </span>
                            {provider.keyUrl && (
                                <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer"
                                   className={`inline-flex items-center gap-1 text-[11px] font-semibold ${ax.link}`}>
                                    {t('settings.getKey')} <Icon.External className="h-3 w-3" />
                                </a>
                            )}
                        </div>
                        <input
                            type="password"
                            value={currentToken}
                            placeholder={provider.keyLabel || t('settings.apiKey')}
                            onChange={(e) => onSetToken(provider.id, e.target.value.trim())}
                            className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                        />
                        {/* Secret field — only for KEY+SECRET providers (e.g. Alpaca). */}
                        {provider.supportsSecret && (
                            <>
                                <span className="mb-1 mt-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
                                    {provider.secretLabel || t('settings.apiSecret')}
                                </span>
                                <input
                                    type="password"
                                    value={currentSecret}
                                    placeholder={provider.secretLabel || t('settings.apiSecret')}
                                    onChange={(e) => onSetSecret(provider.id, e.target.value.trim())}
                                    className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                                />
                            </>
                        )}
                        <span className="mt-1 block text-[11px] text-slate-400">
                            {provider.keyHint || t('settings.keyHint')}
                        </span>
                    </div>
                )}

                {/* Proxy base URL — for request-handling proxies (Yahoo/worker). */}
                {provider.needsProxyBase && (
                    <label className="mb-3 block">
                        <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.proxyBase')}</span>
                        <input
                            type="text"
                            value={settings.proxyBase}
                            placeholder={t('settings.proxyBasePlaceholder')}
                            onChange={(e) => onChange({ proxyBase: e.target.value.trim() })}
                            className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                        />
                        <span className="mt-1 block text-[11px] text-slate-400">
                            {t('settings.proxyBaseHint')}
                        </span>
                    </label>
                )}

                {/* CORS proxy — only for providers that need it (CBOE). */}
                {provider.needsProxy && (
                    <>
                        <label className="mb-2 block">
                            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.corsProxy')}</span>
                            <select
                                value={settings.proxyTemplate}
                                onChange={(e) => onChange({ proxyTemplate: e.target.value })}
                                className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                            >
                                {PROXY_PRESETS.map((p) => (
                                    <option key={p.template} value={p.template}>{p.label}</option>
                                ))}
                            </select>
                            <span className="mt-1 block text-[11px] text-slate-400">
                                {t('settings.corsProxyHint')}
                            </span>
                        </label>
                        {settings.proxyTemplate.includes('{worker}') && (
                            <label className="mb-1 block">
                                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.workerUrl')}</span>
                                <input
                                    type="text"
                                    value={settings.workerUrl}
                                    placeholder={t('settings.workerUrlPlaceholder')}
                                    onChange={(e) => onChange({ workerUrl: e.target.value.trim() })}
                                    className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                                />
                            </label>
                        )}
                    </>
                )}

                {/* ---- Desk columns: per-side, per-column toggles -------- */}
                <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-3">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('settings.deskColumns')}</h3>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                        {(['calls', 'puts'] as const).map((side) => (
                            <div key={side}>
                                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                                    {t(`settings.deskColumns.${side}`)}
                                </div>
                                <div className="space-y-1">
                                    {([
                                        { id: 'openInterest', label: t('settings.deskColumns.openInterest') },
                                        { id: 'volume', label: t('settings.deskColumns.volume') },
                                        { id: 'iv', label: t('settings.deskColumns.iv') },
                                        { id: 'delta', label: t('settings.deskColumns.delta') },
                                        { id: 'gamma', label: t('settings.deskColumns.gamma') },
                                        { id: 'theta', label: t('settings.deskColumns.theta') },
                                        { id: 'vega', label: t('settings.deskColumns.vega') },
                                        { id: 'rho', label: t('settings.deskColumns.rho') },
                                        // higher-order greeks
                                        { id: 'lambda', label: t('settings.deskColumns.lambda') },
                                        { id: 'vanna', label: t('settings.deskColumns.vanna') },
                                        { id: 'vomma', label: t('settings.deskColumns.vomma') },
                                        { id: 'charm', label: t('settings.deskColumns.charm') },
                                        { id: 'speed', label: t('settings.deskColumns.speed') },
                                        { id: 'zomma', label: t('settings.deskColumns.zomma') },
                                        { id: 'color', label: t('settings.deskColumns.color') },
                                    ] as const).map((c) => (
                                        <label key={c.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                                            <input
                                                type="checkbox"
                                                checked={(settings.deskColumns as any)[side][c.id]}
                                                onChange={(e) => onChange({ deskColumns: { ...settings.deskColumns, [side]: { ...(settings.deskColumns as any)[side], [c.id]: e.target.checked } } })}
                                                className={`h-3.5 w-3.5 ${ax.accentInput}`}
                                            />
                                            <span>{c.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">{t('settings.deskColumns.note')}</p>
                </div>

                {/* ---- Cache: stats + clear actions --------------------------- */}
                <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-3">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('settings.cache')}</h3>

                    {/* Stats */}
                    <div className="mb-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <div className="flex items-center justify-between">
                            <span>{t('settings.cache.records')}</span>
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{stats.entries}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>{t('settings.cache.dataSize')}</span>
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{fmtBytes(stats.bytes)} / {fmtBytes(stats.maxBytes)} ({pct}%)</span>
                        </div>
                        {/* Usage bar */}
                        <div className="my-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                            <div className={'h-full rounded-full ' + (pct > 85 ? 'bg-rose-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex items-center justify-between">
                            <span>{t('settings.cache.settingsSize')}</span>
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{fmtBytes(stats.settingsBytes)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>{t('settings.cache.oldest')}</span>
                            <span className="font-medium text-slate-600 dark:text-slate-300">{fmtTs(stats.oldest)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>{t('settings.cache.newest')}</span>
                            <span className="font-medium text-slate-600 dark:text-slate-300">{fmtTs(stats.newest)}</span>
                        </div>
                    </div>

                    {/* Clear actions — each needs a second click to confirm. */}
                    {([
                        { id: 'data', label: t('settings.cache.clearData'), hint: t('settings.cache.clearDataHint'), run: onClearData },
                        { id: 'settings', label: t('settings.cache.clearSettings'), hint: t('settings.cache.clearSettingsHint'), run: onClearSettings },
                        { id: 'all', label: t('settings.cache.clearAll'), hint: t('settings.cache.clearAllHint'), run: onClearAll },
                    ] as const).map((a) => (
                        <div key={a.id} className="mb-1.5 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{a.label}</div>
                                <div className="truncate text-[10px] text-slate-400">{a.hint}</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (armed === a.id) { a.run(); setArmed(''); bump(); }
                                    else { setArmed(a.id); }
                                }}
                                onBlur={() => setArmed((cur) => (cur === a.id ? '' : cur))}
                                className={
                                    'shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ' +
                                    (armed === a.id
                                        ? 'border-rose-500 bg-rose-600 text-white hover:bg-rose-700'
                                        : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-rose-400 hover:text-rose-600 dark:hover:text-rose-400')
                                }
                            >
                                {armed === a.id ? t('settings.cache.confirm') : a.label}
                            </button>
                        </div>
                    ))}
                    {armed && <p className="mt-1 text-[10px] text-rose-500">{t('settings.cache.confirmHelp')}</p>}
                </div>

                {!embedded && (<>
                {/* ---- Heading fast-access controls (must live at the end of the settings menu) ---- */}
                <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-3 space-y-3">
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('topBar.settings')}</h3>
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.provider')}</span>
                        <select
                            value={settings.providerId}
                            onChange={(e) => onChange({ providerId: e.target.value })}
                            disabled={settings.providerId === 'static'}
                            className={
                                'w-full rounded-lg border px-2 py-1.5 text-sm outline-none focus:ring-2 ' +
                                (settings.providerId === 'static'
                                    ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-600'
                                    : `border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 ${ax.focusRing}`)
                            }
                        >
                            {(settings.providerId === 'static' ? PROVIDERS.filter((p) => p.id === 'static') : LIVE_PROVIDERS).map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
                        </select>
                        <span className="mt-1 block text-[11px] text-slate-400">{t('settings.providerHint')}</span>
                    </label>
                    <div>
                        <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.theme')}</span>
                        <ThemeSwitch value={settings.theme} onChange={(theme) => onChange({ theme })} colorTheme={settings.colorTheme} />
                        <span className="mt-1 block text-[11px] text-slate-400">{t('settings.themeHint')}</span>
                    </div>
                    <div>
                        <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.colorTheme')}</span>
                        <ColorThemeSwitch value={settings.colorTheme} onChange={(colorTheme) => onChange({ colorTheme })} />
                        <span className="mt-1 block text-[11px] text-slate-400">{t('settings.colorThemeHint')}</span>
                    </div>
                    <div>
                        <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.language')}</span>
                        <LanguageSwitch value={settings.language} onChange={(l) => onChange({ language: l })} colorTheme={settings.colorTheme} />
                        <span className="mt-1 block text-[11px] text-slate-400">{t('settings.languageHint')}</span>
                    </div>
                </div></>)}
            </div>
        </>
    );
};

// ============================================================================
// TOP BAR
// ============================================================================

/**
 * Top navigation bar. Layout per product spec:
 *   [ left: brand "Option Desk" ] ................ [ API dropdown | theme | gear ]
 */

/** Segmented control — same visual language as fundamentals header pills. */
type PillOption = string | { k: string; l: string };
const Pill = ({
    value,
    options,
    onChange,
    dark,
    title,
    accentActive,
    disabled,
}: {
    value: string;
    options: PillOption[];
    onChange: (k: string) => void;
    dark: boolean;
    title?: string;
    /** Active fill classes, e.g. "bg-indigo-600 text-white shadow-sm" */
    accentActive: string;
    disabled?: boolean;
}) => (
    <div
        title={title}
        className={`flex-shrink-0 flex items-center rounded-lg p-0.5 border ${
            dark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'
        } ${disabled ? 'opacity-50' : ''}`}
    >
        {options.map((opt) => {
            const k = typeof opt === 'string' ? opt : opt.k;
            const l = typeof opt === 'string' ? opt : opt.l;
            return (
                <button
                    key={k}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(k)}
                    className={`px-2.5 py-1 rounded-md text-sm font-bold leading-none transition-all ${
                        value === k
                            ? accentActive
                            : dark
                                ? 'text-slate-400 hover:text-slate-200'
                                : 'text-slate-500 hover:text-slate-700'
                    } ${disabled ? 'cursor-not-allowed hover:text-slate-400' : ''}`}
                >
                    {l}
                </button>
            );
        })}
    </div>
);

const TopBar: React.FC<{
    settings: Settings;
    provider: DataProvider;
    onChange: (patch: Partial<Settings>) => void;
    onSetToken: (providerId: string, token: string) => void;
    onSetSecret: (providerId: string, secret: string) => void;
    onClearData: () => void;
    onClearSettings: () => void;
    onClearAll: () => void;
    tickerInput: string;
    onTickerInput: (v: string) => void;
    onSearch: () => void;
    searching?: boolean;
    tickerSuggestions: TickerSuggestion[];
    tickerSuggestionsOpen: boolean;
    tickerSuggestionsLoading: boolean;
    activeTickerSuggestion: number;
    onTickerFocus: () => void;
    onTickerBlur: () => void;
    onTickerKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    onChooseSuggestion: (s: TickerSuggestion) => void;
    setActiveTickerSuggestion: (i: number) => void;
    setTickerSuggestionsOpen: (v: boolean) => void;
    proxyOk: boolean | null;
    proxyChecking: boolean;
}> = ({
    settings, provider, onChange, onSetToken, onSetSecret, onClearData, onClearSettings, onClearAll,
    tickerInput, onTickerInput, onSearch, searching,
    tickerSuggestions, tickerSuggestionsOpen, tickerSuggestionsLoading, activeTickerSuggestion,
    onTickerFocus, onTickerBlur, onTickerKeyDown, onChooseSuggestion, setActiveTickerSuggestion, setTickerSuggestionsOpen,
    proxyOk, proxyChecking,
}) => {
    const [openSettings, setOpenSettings] = useState(false);
    const [showDebug, setShowDebug] = useState(false);
    const { t, lang, setLang } = useI18n();
    const hasKey = !!(settings.tokens[provider.id]) &&
        (!provider.supportsSecret || !!(settings.secrets[provider.id]));
    const ax = accentOf(settings.colorTheme);
    const isCache = settings.providerId === 'static';
    const isDark = settings.theme === 'dark' || (
        settings.theme === 'system' &&
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
    );
    // Resolve effective dark for class tokens (subscribe via theme controller already on html)
    const [dark, setDarkLocal] = useState(isDark);
    useEffect(() => {
        const root = document.documentElement;
        const sync = () => setDarkLocal(root.classList.contains('dark'));
        sync();
        const obs = new MutationObserver(sync);
        obs.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, [settings.theme]);

    const debugRef = useRef<HTMLDivElement | null>(null);
    const settingsRef = useRef<HTMLDivElement | null>(null);
    const showTickerSuggestions = tickerSuggestionsOpen && (tickerSuggestionsLoading || tickerSuggestions.length > 0);

    useEffect(() => {
        const h = (e: MouseEvent) => {
            const n = e.target as Node;
            if (debugRef.current && !debugRef.current.contains(n)) setShowDebug(false);
            if (settingsRef.current && !settingsRef.current.contains(n)) setOpenSettings(false);
        };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, []);

    // ---- fundamentals-identical surface tokens ----
    const bg = dark ? 'bg-slate-950/95 text-slate-100' : 'bg-white/95 text-slate-900';
    const bdr = dark ? 'border-slate-800' : 'border-slate-200';
    const card = dark
        ? 'bg-slate-800 border-slate-600 text-slate-100'
        : 'bg-white border-slate-200 text-slate-900 shadow-sm';
    const inp = dark
        ? `bg-slate-800 border-slate-700 ${settings.colorTheme === 'fundamentals' ? 'text-emerald-400' : 'text-indigo-400'}`
        : `bg-slate-50 border-slate-300 ${settings.colorTheme === 'fundamentals' ? 'text-emerald-700' : 'text-indigo-700'}`;
    const mt = dark ? 'text-slate-400' : 'text-slate-500';
    const t1 = dark ? 'text-slate-100' : 'text-slate-800';
    const t2 = dark ? 'text-slate-300' : 'text-slate-600';
    const sugBg = dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200 shadow-lg';
    const sugH = dark ? 'bg-slate-700' : 'bg-slate-100';
    const sugH2 = dark ? 'hover:bg-slate-700/50' : 'hover:bg-slate-50';
    const pillActive = settings.colorTheme === 'fundamentals'
        ? 'bg-emerald-500 text-white shadow-sm'
        : 'bg-indigo-600 text-white shadow-sm';
    const focusBorder = settings.colorTheme === 'fundamentals'
        ? 'focus:border-emerald-500'
        : 'focus:border-indigo-500';
    const btn = settings.colorTheme === 'fundamentals'
        ? 'bg-emerald-500 hover:bg-emerald-400'
        : 'bg-indigo-600 hover:bg-indigo-500';
    const chipActiveDark = settings.colorTheme === 'fundamentals'
        ? 'bg-slate-700 text-emerald-400'
        : 'bg-slate-700 text-indigo-400';
    const chipActiveLight = settings.colorTheme === 'fundamentals'
        ? 'bg-slate-200 text-emerald-700'
        : 'bg-slate-200 text-indigo-700';
    const statusOk = settings.colorTheme === 'fundamentals' ? 'text-emerald-500' : 'text-indigo-500';
    const textAccent = dark
        ? (settings.colorTheme === 'fundamentals' ? 'text-emerald-400' : 'text-indigo-400')
        : (settings.colorTheme === 'fundamentals' ? 'text-emerald-700' : 'text-indigo-700');
    const sun = 'text-yellow-400';

    const proxyDotCls = isCache
        ? 'bg-slate-400/50 dark:bg-slate-600/50'
        : proxyChecking
            ? 'bg-yellow-400 animate-pulse'
            : proxyOk
                ? (settings.colorTheme === 'fundamentals' ? 'bg-emerald-500' : 'bg-indigo-500')
                : 'bg-red-500';
    const proxyStatusCls = !isCache && proxyOk ? statusOk : (!isCache && proxyOk === false ? 'text-red-500' : mt);
    const proxyStatusLabel = isCache ? '● n/a' : proxyChecking ? '● …' : proxyOk ? '● online' : '● offline';

    const setThemeMode = (mode: ThemeMode) => onChange({ theme: mode });
    const toggleDark = () => setThemeMode(dark ? 'light' : 'dark');

    return (
        <div className={`sticky top-0 z-50 ${bg} backdrop-blur-md border-b ${bdr}`}>
            <div className="px-4 xl:px-8">
                <div className="flex items-center gap-2 sm:gap-3 py-3">
                    {/* 1. Debug — same as fundamentals ⌘ */}
                    <div className="relative flex-shrink-0" ref={debugRef}>
                        <button
                            type="button"
                            onClick={() => setShowDebug((v) => !v)}
                            title={t('topBar.debug')}
                            aria-label={t('topBar.debug')}
                            aria-expanded={showDebug}
                            className={`text-xs px-2 py-1.5 rounded-lg transition-colors ${
                                showDebug
                                    ? dark ? chipActiveDark : chipActiveLight
                                    : dark
                                        ? 'text-slate-600 hover:text-slate-400 hover:bg-slate-800'
                                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            ⌘
                        </button>
                        {showDebug && (
                            <div
                                role="dialog"
                                aria-label={t('topBar.debug')}
                                className={`absolute left-0 top-full mt-2 w-[min(92vw,22rem)] z-[60] ${card} border rounded-xl shadow-xl p-3 space-y-3`}
                            >
                                <div className={`font-bold text-sm ${t1}`}>⌘ {t('topBar.debug')}</div>
                                <div className={`text-[10px] font-bold uppercase tracking-wide ${mt}`}>Overview</div>
                                <div className={`rounded-lg border ${bdr} divide-y ${bdr}`}>
                                    <div className="flex items-start justify-between gap-3 px-3 py-2">
                                        <span className={`text-xs ${mt}`}>Provider</span>
                                        <span className={`text-xs font-mono text-right ${t1}`}>{provider.label}</span>
                                    </div>
                                    <div className="grid grid-cols-2 divide-x divide-inherit">
                                        <div className="px-3 py-2">
                                            <div className={`text-[10px] ${mt}`}>Mode</div>
                                            <div className={`text-xs font-mono font-semibold ${t1}`}>{isCache ? 'CACHE' : 'LIVE'}</div>
                                        </div>
                                        <div className="px-3 py-2">
                                            <div className={`text-[10px] ${mt}`}>Proxy</div>
                                            <div className={`text-xs font-mono font-semibold ${proxyStatusCls}`}>{proxyStatusLabel}</div>
                                        </div>
                                    </div>
                                    <div className="px-3 py-2">
                                        <div className={`text-[10px] ${mt}`}>proxyBase</div>
                                        <div className={`mt-1 text-[10px] font-mono break-all ${t2}`}>{settings.proxyBase || '—'}</div>
                                    </div>
                                    <div className="px-3 py-2">
                                        <div className={`text-[10px] ${mt}`}>Ticker</div>
                                        <div className={`text-xs font-mono font-semibold ${t1}`}>{tickerInput || '—'}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 2. Proxy dots — fundamentals size/spacing */}
                    <div
                        className="flex gap-1.5 flex-shrink-0"
                        data-proxy-indicators={isCache ? 'disabled' : 'live'}
                        title={isCache ? `${t('topBar.proxy')} (${t('topBar.cache')} — ${t('topBar.proxyDisabled')})` : t('topBar.proxy')}
                        aria-label={t('topBar.proxy')}
                    >
                        <div className={`h-2.5 w-2.5 rounded-full ${proxyDotCls}`} />
                        <div className={`h-2.5 w-2.5 rounded-full ${proxyDotCls}`} />
                    </div>

                    {/* 3. Ticker — fundamentals mono input */}
                    <div className="flex-1 min-w-0 relative" title={t('topBar.ticker')}>
                        <input
                            type="text"
                            value={tickerInput}
                            onChange={(e) => {
                                onTickerInput(e.target.value.toUpperCase());
                                setTickerSuggestionsOpen(true);
                            }}
                            onFocus={(e) => { onTickerFocus(); e.currentTarget.select(); }}
                            onClick={(e) => e.currentTarget.select()}
                            onBlur={onTickerBlur}
                            onKeyDown={onTickerKeyDown}
                            placeholder={t('controls.tickerPlaceholder')}
                            spellCheck={false}
                            autoCapitalize="characters"
                            role="combobox"
                            aria-expanded={showTickerSuggestions}
                            aria-label={t('topBar.ticker')}
                            className={`w-full ${inp} border rounded-lg px-3 py-2 font-mono font-bold text-sm focus:outline-none ${focusBorder} transition-colors uppercase`}
                        />
                        {showTickerSuggestions && (
                            <div className={`absolute top-full left-0 right-0 mt-1 ${sugBg} border rounded-lg overflow-hidden z-50 max-w-xl`}>
                                {tickerSuggestionsLoading && tickerSuggestions.length === 0 ? (
                                    <div className={`px-3 py-2 text-xs ${mt}`}>{t('controls.searching')}</div>
                                ) : tickerSuggestions.map((s, i) => (
                                    <button
                                        key={`${s.source}:${s.symbol}:${i}`}
                                        type="button"
                                        onMouseDown={(e) => { e.preventDefault(); onChooseSuggestion(s); }}
                                        onMouseEnter={() => setActiveTickerSuggestion(i)}
                                        className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                                            i === activeTickerSuggestion ? sugH : sugH2
                                        }`}
                                    >
                                        <span className={`font-mono font-bold text-sm w-14 flex-shrink-0 ${textAccent}`}>
                                            {s.symbol}
                                        </span>
                                        <span className={`text-xs truncate ${t2}`}>
                                            {s.name || (s.hasOptions ? t('tickerFromIndex') : t('validTickerFromIndex'))}
                                            {!s.hasOptions ? ` ${t('noOptions')}` : ''}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 4. Search — fundamentals solid accent button */}
                    <button
                        type="button"
                        onClick={onSearch}
                        disabled={!!searching}
                        title={t('topBar.search')}
                        aria-label={t('topBar.search')}
                        className={`flex-shrink-0 flex items-center ${btn} text-white font-bold px-3 sm:px-4 py-2 rounded-lg text-sm transition-all active:scale-95 disabled:opacity-40`}
                    >
                        {searching ? (
                            <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4" aria-hidden>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                            </svg>
                        )}
                    </button>

                    {/* 5. Provider — greys out when CACHE (same pill shell feel via native select styled) */}
                    <div className="hidden sm:block flex-shrink-0 w-[7.25rem]">
                        <select
                            value={settings.providerId}
                            onChange={(e) => onChange({ providerId: e.target.value })}
                            disabled={isCache}
                            data-provider-select={isCache ? 'disabled' : 'live'}
                            title={isCache ? `${t('settings.provider')} (${t('topBar.proxyDisabled')})` : t('settings.provider')}
                            className={`box-border w-full max-w-full rounded-lg border px-2 py-1.5 text-sm font-bold outline-none transition-colors ${
                                isCache
                                    ? dark
                                        ? 'border-slate-700 bg-slate-800/50 text-slate-500 cursor-not-allowed'
                                        : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                                    : dark
                                        ? 'border-slate-700 bg-slate-800 text-slate-100'
                                        : 'border-slate-200 bg-slate-100 text-slate-800'
                            }`}
                        >
                            {(isCache ? PROVIDERS.filter((p) => p.id === 'static') : LIVE_PROVIDERS).map((p) => (
                                <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* 6. CACHE / LIVE — fundamentals Pill */}
                    <div title={isCache ? t('topBar.cache') : t('topBar.live')} className="flex-shrink-0">
                        <Pill
                            value={isCache ? 'cache' : 'live'}
                            options={[
                                { k: 'cache', l: '💾' },
                                { k: 'live', l: '🌐' },
                            ]}
                            onChange={(k) => {
                                if (k === 'cache') onChange({ providerId: 'static' });
                                else if (isCache) onChange({ providerId: 'cboe' });
                            }}
                            dark={dark}
                            accentActive={pillActive}
                            title={isCache ? t('topBar.cache') : t('topBar.live')}
                        />
                    </div>

                    {/* 7. Theme — fundamentals sun/moon text button */}
                    <button
                        type="button"
                        onClick={toggleDark}
                        title={t('theme.' + (dark ? 'light' : 'dark'))}
                        aria-label={t('theme.' + (dark ? 'light' : 'dark'))}
                        className={`flex-shrink-0 text-base leading-none px-2 py-1.5 rounded-lg transition-colors ${
                            dark ? `${sun} hover:bg-slate-800` : 'text-slate-500 hover:bg-slate-100'
                        }`}
                    >
                        {dark ? '☀️' : '🌙'}
                    </button>

                    {/* 8. i18n — fundamentals flag Pill */}
                    <div title={t('settings.language')} className="flex-shrink-0">
                        <Pill
                            value={settings.language}
                            options={[
                                { k: 'en', l: '🇺🇸' },
                                { k: 'ru', l: '🇷🇺' },
                            ]}
                            onChange={(k) => {
                                onChange({ language: k as Language });
                                setLang(k as Language);
                            }}
                            dark={dark}
                            accentActive={pillActive}
                            title={t('settings.language')}
                        />
                    </div>

                    {/* 9. Settings — fundamentals gear emoji button + card popover shell */}
                    <div className="relative flex-shrink-0" ref={settingsRef}>
                        <button
                            type="button"
                            onClick={() => setOpenSettings((v) => !v)}
                            title={t('topBar.settings')}
                            aria-label={t('topBar.settings')}
                            aria-expanded={openSettings}
                            className={`flex-shrink-0 text-base leading-none px-2 py-1.5 rounded-lg transition-colors ${
                                openSettings
                                    ? dark ? chipActiveDark : chipActiveLight
                                    : dark
                                        ? 'text-slate-300 hover:bg-slate-800'
                                        : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            ⚙️
                        </button>
                        {openSettings && (
                            <div
                                className={`absolute right-0 top-full mt-2 w-[min(92vw,22rem)] z-[60] ${card} border rounded-xl shadow-xl p-3 space-y-3`}
                            >
                                <div className={`font-bold text-sm ${t1}`}>⚙️ {t('settings.title')}</div>

                                <div className={`text-[10px] font-bold uppercase tracking-wide ${mt}`}>{t('settings.theme')}</div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className={`text-xs ${t2}`}>{t('settings.theme')}</span>
                                    <Pill
                                        value={dark ? 'dark' : 'light'}
                                        options={[
                                            { k: 'light', l: '☀️' },
                                            { k: 'dark', l: '🌙' },
                                        ]}
                                        onChange={(k) => setThemeMode(k as ThemeMode)}
                                        dark={dark}
                                        accentActive={pillActive}
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className={`text-xs ${t2}`}>{t('settings.colorTheme')}</span>
                                    <Pill
                                        value={settings.colorTheme}
                                        options={[
                                            { k: 'options-desk', l: '📘' },
                                            { k: 'fundamentals', l: '📗' },
                                        ]}
                                        onChange={(k) => onChange({ colorTheme: normalizeColorTheme(k) })}
                                        dark={dark}
                                        accentActive={pillActive}
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className={`text-xs ${t2}`}>{t('settings.language')}</span>
                                    <Pill
                                        value={settings.language}
                                        options={[
                                            { k: 'en', l: '🇺🇸' },
                                            { k: 'ru', l: '🇷🇺' },
                                        ]}
                                        onChange={(k) => {
                                            onChange({ language: k as Language });
                                            setLang(k as Language);
                                        }}
                                        dark={dark}
                                        accentActive={pillActive}
                                    />
                                </div>

                                <div className={`text-[10px] font-bold uppercase tracking-wide pt-1 ${mt}`}>{t('settings.provider')}</div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className={`text-xs ${t2}`}>{t('settings.provider')}</span>
                                    <select
                                        value={settings.providerId}
                                        onChange={(e) => onChange({ providerId: e.target.value })}
                                        disabled={isCache}
                                        data-provider-select={isCache ? 'disabled' : 'live'}
                                        className={`box-border w-[7.25rem] max-w-full rounded-lg border px-2 py-1 text-xs font-bold outline-none ${
                                            isCache
                                                ? dark
                                                    ? 'border-slate-700 bg-slate-900/50 text-slate-500 cursor-not-allowed'
                                                    : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                                                : dark
                                                    ? 'border-slate-600 bg-slate-900 text-slate-100'
                                                    : 'border-slate-200 bg-white text-slate-800'
                                        }`}
                                    >
                                        {(isCache ? PROVIDERS.filter((p) => p.id === 'static') : LIVE_PROVIDERS).map((p) => (
                                            <option key={p.id} value={p.id}>{p.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className={`text-[10px] ${mt}`}>
                                    {isCache ? t('topBar.proxyDisabled') : t('settings.providerHint')}
                                </div>

                                {/* Nested full SettingsPanel for desk columns / cache / proxy fields */}
                                <div className={`border-t ${bdr} pt-2`}>
                                    <SettingsPanel
                                        settings={settings}
                                        provider={provider}
                                        onChange={onChange}
                                        onSetToken={onSetToken}
                                        onSetSecret={onSetSecret}
                                        onClearData={onClearData}
                                        onClearSettings={onClearSettings}
                                        onClearAll={onClearAll}
                                        onClose={() => setOpenSettings(false)}
                                        embedded
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ============================================================================
// ONBOARDING CARD (shown when the active provider needs a key that isn't set)
// ============================================================================

const KeyOnboarding: React.FC<{
    provider: DataProvider;
    tokenValue: string;
    secretValue: string;
    onSave: (apiToken: string, apiSecret: string) => void;
    onPreview: () => void;
    previewLabel: string;
    colorTheme?: ColorThemeId;
}> = ({ provider, tokenValue, secretValue, onSave, onPreview, previewLabel, colorTheme = DEFAULT_COLOR_THEME }) => {
    const { t, lang } = useI18n();
    const ax = accentOf(colorTheme);
    const [keyDraft, setKeyDraft] = useState('');
    const [secretDraft, setSecretDraft] = useState('');
    // Ready when the key (and, if required, the secret) are filled in.
    const ready = !!keyDraft && (!provider.supportsSecret || !!secretDraft);
    const save = () => { if (ready) onSave(keyDraft, secretDraft); };
    return (
        <div className="mx-auto max-w-lg animate-fade-in rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center shadow-sm">
            <div className={`mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full ${ax.brandSoft}`}>
                <Icon.Key className="h-5 w-5" />
            </div>
            <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-50">
                {t('onboarding.title', { provider: provider.label.split(' ')[0], keys: provider.supportsSecret ? t('onboarding.keys') : t('onboarding.key') })}
            </h2>
            <p className="mx-auto mb-4 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {provider.keyHint || providerDescription(provider.id, lang)}
            </p>

            {provider.keyUrl && (
                <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer"
                   className={`mb-3 inline-flex items-center gap-1.5 rounded-lg ${ax.btn} px-4 py-2 text-sm font-semibold text-white`}>
                    {t('onboarding.getKey')} <Icon.External className="h-4 w-4" />
                </a>
            )}

            <div className="mt-3 space-y-2 text-left">
                <input
                    type="password"
                    value={keyDraft}
                    placeholder={provider.keyLabel || t('settings.apiKey')}
                    onChange={(e) => setKeyDraft(e.target.value.trim())}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !provider.supportsSecret) save(); }}
                    className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                />
                {provider.supportsSecret && (
                    <input
                        type="password"
                        value={secretDraft}
                        placeholder={provider.secretLabel || t('settings.apiSecret')}
                        onChange={(e) => setSecretDraft(e.target.value.trim())}
                        onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                        className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                    />
                )}
                <button
                    type="button"
                    disabled={!ready}
                    onClick={save}
                    className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                    {t('onboarding.save', { keys: provider.supportsSecret ? t('onboarding.keys') : t('onboarding.key') })}
                </button>
            </div>

            <button
                type="button"
                onClick={onPreview}
                className={`mt-4 text-xs font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400 ${ax.link}`}
            >
                {previewLabel}
            </button>
            {tokenValue && (!provider.supportsSecret || secretValue) && (
                <p className="mt-3 text-[11px] text-emerald-600 dark:text-emerald-400">{t('onboarding.saved')}</p>
            )}
        </div>
    );
};

// ============================================================================
// OPTION CHAIN TABLE
// ============================================================================

/** One expiration's worth of grouped quotes, ready to render as a section. */
/**
 * Max number of leading rows that get a staggered animation delay. Keeping this
 * small means the effect is visible on load but never turns a multi-thousand-row
 * chain into a long "flickering" cascade.
 */
const STAGGER_ROWS = 15;

interface ChainSection {
    expiration: string;
    calls: Map<number, OptionQuote>;
    puts: Map<number, OptionQuote>;
    strikes: number[];
}

type DeskColumnKey = 'openInterest' | 'volume' | 'iv' | 'delta' | 'gamma' | 'theta' | 'vega' | 'rho' | 'bid' | 'mid' | 'ask';
interface DeskColumnDef {
    key: DeskColumnKey;
    label: string;
    headerLabel?: string;
    className?: string;
    render: (q?: OptionQuote) => string;
}

/** Build the currently visible call/put columns from Settings → Desk columns. */
function deskColumns(settings: DeskColumnSettings, t: (key: string) => string, colorTheme: ColorThemeId = DEFAULT_COLOR_THEME): { calls: DeskColumnDef[]; puts: DeskColumnDef[] } {
    const ax = accentOf(colorTheme);
    const oi: DeskColumnDef = { key: 'openInterest', label: t('settings.deskColumns.openInterest'), headerLabel: t('deskColumns.header.openInterest'), render: (q) => fmtInt(q?.openInterest) };
    const vol: DeskColumnDef = { key: 'volume', label: t('settings.deskColumns.volume'), headerLabel: t('deskColumns.header.volume'), render: (q) => fmtInt(q?.volume) };
    const iv: DeskColumnDef = { key: 'iv', label: t('settings.deskColumns.iv'), headerLabel: t('deskColumns.header.iv'), className: 'text-slate-500', render: (q) => fmtPct(q?.iv) };
    const delta: DeskColumnDef = { key: 'delta', label: t('settings.deskColumns.delta'), headerLabel: t('deskColumns.header.delta'), className: ax.greek, render: (q) => fmtGreek(q?.delta) };
    const gamma: DeskColumnDef = { key: 'gamma', label: t('settings.deskColumns.gamma'), headerLabel: t('deskColumns.header.gamma'), className: ax.greek, render: (q) => fmtGreek(q?.gamma) };
    const theta: DeskColumnDef = { key: 'theta', label: t('settings.deskColumns.theta'), headerLabel: t('deskColumns.header.theta'), className: ax.greek, render: (q) => fmtGreek(q?.theta) };
    const vega: DeskColumnDef = { key: 'vega', label: t('settings.deskColumns.vega'), headerLabel: t('deskColumns.header.vega'), className: ax.greek, render: (q) => fmtGreek(q?.vega) };
    const rho: DeskColumnDef = { key: 'rho', label: t('settings.deskColumns.rho'), headerLabel: t('deskColumns.header.rho'), className: ax.greek, render: (q) => fmtGreek(q?.rho) };
    const lambda: DeskColumnDef = { key: 'lambda', label: t('settings.deskColumns.lambda'), headerLabel: t('deskColumns.header.lambda'), className: 'text-fuchsia-500', render: (q) => fmtGreek(q?.lambda) };
    const vanna: DeskColumnDef = { key: 'vanna', label: t('settings.deskColumns.vanna'), headerLabel: t('deskColumns.header.vanna'), className: 'text-amber-500', render: (q) => fmtGreek(q?.vanna) };
    const vomma: DeskColumnDef = { key: 'vomma', label: t('settings.deskColumns.vomma'), headerLabel: t('deskColumns.header.vomma'), className: 'text-amber-500', render: (q) => fmtGreek(q?.vomma) };
    const charm: DeskColumnDef = { key: 'charm', label: t('settings.deskColumns.charm'), headerLabel: t('deskColumns.header.charm'), className: 'text-amber-500', render: (q) => fmtGreek(q?.charm) };
    const speed: DeskColumnDef = { key: 'speed', label: t('settings.deskColumns.speed'), headerLabel: t('deskColumns.header.speed'), className: 'text-cyan-500', render: (q) => fmtGreek(q?.speed) };
    const zomma: DeskColumnDef = { key: 'zomma', label: t('settings.deskColumns.zomma'), headerLabel: t('deskColumns.header.zomma'), className: 'text-cyan-500', render: (q) => fmtGreek(q?.zomma) };
    const color: DeskColumnDef = { key: 'color', label: t('settings.deskColumns.color'), headerLabel: t('deskColumns.header.color'), className: 'text-cyan-500', render: (q) => fmtGreek(q?.color) };
    const callPrice: DeskColumnDef[] = [
        { key: 'bid', label: t('settings.deskColumns.bid'), headerLabel: t('deskColumns.header.bid'), render: (q) => fmt(q?.bid) },
        { key: 'mid', label: t('settings.deskColumns.mid'), headerLabel: t('deskColumns.header.mid'), className: ax.mid, render: (q) => fmt(q?.mid) },
        { key: 'ask', label: t('settings.deskColumns.ask'), headerLabel: t('deskColumns.header.ask'), render: (q) => fmt(q?.ask) },
    ];
    const putPrice: DeskColumnDef[] = [
        { key: 'bid', label: t('settings.deskColumns.bid'), headerLabel: t('deskColumns.header.bid'), render: (q) => fmt(q?.bid) },
        { key: 'mid', label: t('settings.deskColumns.mid'), headerLabel: t('deskColumns.header.mid'), className: 'font-medium text-rose-600 dark:text-rose-400', render: (q) => fmt(q?.mid) },
        { key: 'ask', label: t('settings.deskColumns.ask'), headerLabel: t('deskColumns.header.ask'), render: (q) => fmt(q?.ask) },
    ];

    const buildSide = (s: SideColumnSettings, isCall: boolean): DeskColumnDef[] => {
        const cols: DeskColumnDef[] = [];
        if (s.openInterest) cols.push(oi);
        if (s.volume) cols.push(vol);
        if (s.iv) cols.push(iv);
        if (s.delta) cols.push(delta);
        if (s.gamma) cols.push(gamma);
        if (s.theta) cols.push(theta);
        if (s.vega) cols.push(vega);
        if (s.rho) cols.push(rho);
        if (s.lambda) cols.push(lambda);
        if (s.vanna) cols.push(vanna);
        if (s.vomma) cols.push(vomma);
        if (s.charm) cols.push(charm);
        if (s.speed) cols.push(speed);
        if (s.zomma) cols.push(zomma);
        if (s.color) cols.push(color);
        return isCall ? [...cols, ...callPrice] : [...putPrice, ...cols.reverse()];
    };

    return { calls: buildSide(settings.calls, true), puts: buildSide(settings.puts, false) };
}

function gridCols(callCount: number, putCount: number): string {
    // Strike track must fit values like "1,480.00" (high-priced underlyings) without
    // overflowing into Put Bid. 5.75rem min + slight fr boost keeps the center axis
    // readable while side columns still flex. CSS on .od-strike-cell contains overflow.
    return `repeat(${callCount}, minmax(3.5rem, 1fr)) minmax(5.75rem, 1.15fr) repeat(${putCount}, minmax(3.5rem, 1fr))`;
}
function deskMinWidth(callCount: number, putCount: number): string {
    // Strike allowance raised in lockstep with gridCols (was 4.5rem for 4.25rem track).
    return `${Math.max(48, (callCount + putCount) * 3.75 + 6.25)}rem`;
}

/** One data cell in the grid desk. */
const Cell: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className }) => (
    <div className={'px-2 py-1 text-right tabular-nums ' + (className || '')}>{children}</div>
);
const QuoteCells: React.FC<{ q?: OptionQuote; columns: DeskColumnDef[] }> = ({ q, columns }) => (
    <>
        {columns.map((c) => <Cell key={c.key} className={c.className}>{c.render(q)}</Cell>)}
    </>
);

/**
 * NOTE (v0.9.16): collapse/expand state is intentionally SESSION-ONLY and is NO
 * LONGER persisted to localStorage. Requirement: after the user selects
 * expiration(s) and clicks "Load", the chain must ALWAYS render fully EXPANDED —
 * there must be no case where a previously-collapsed state from a past session
 * makes a freshly-loaded chain appear collapsed. The user can still collapse
 * sections during the current session (purely ephemeral); loading a different
 * symbol resets everything back to expanded. (The old COLLAPSE_KEY /
 * loadCollapsed / saveCollapsed persistence helpers were removed for this.)
 */

/**
 * One expiration section, built from DIVs (NOT a <table>) so `position: sticky`
 * works reliably. (Native <table> sticky <th> backgrounds go transparent while
 * scrolling in WebKit/Blink — the bug that plagued earlier versions. The proven
 * fix, also used in the sibling daggerok/csv project, is a CSS-grid div layout.)
 *
 * Structure (all inside a shared scroll container):
 *   - .od-bar   : the always-sticky Expiration bar; accumulates into the top pile
 *                 (top = index * --od-bar), whole bar is one collapse toggle.
 *   - .od-sub   : Calls|Strike|Puts group + column labels; sticky ONLY when this
 *                 section is active (in view), just below the pile.
 *   - rows      : one grid row per strike.
 */
const ExpirationSection: React.FC<{
    section: ChainSection;
    index: number;
    spot: number | null;
    callColumns: DeskColumnDef[];
    putColumns: DeskColumnDef[];
    colorTheme?: ColorThemeId;
    collapsed: boolean;
    active: boolean;
    onToggle: () => void;
    /** Registers this section's sticky expiration BAR element (a real box we can
     *  measure; the .od-sec wrapper is `display: contents` and has no box). Used
     *  for active-section tracking. */
    innerRef: (el: HTMLButtonElement | null) => void;
    /** Registers this section's ATM (at-the-money) row element so the desk can
     *  scroll it to the vertical center on load / expand (center-strike view). */
    atmRef: (el: HTMLDivElement | null) => void;
}> = ({ section, index, spot, callColumns, putColumns, collapsed, active, onToggle, innerRef, atmRef, colorTheme = DEFAULT_COLOR_THEME }) => {
    const ax = accentOf(colorTheme);
    const { t } = useI18n();
    const { expiration, calls, puts, strikes } = section;
    const atmStrike = useMemo(() => {
        if (spot == null || strikes.length === 0) return null;
        return strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), strikes[0]);
    }, [spot, strikes]);

    // Symmetric open/close animation: keep rows mounted during close to fade out.
    const [rendered, setRendered] = useState(!collapsed);
    const [closing, setClosing] = useState(false);
    useEffect(() => {
        if (!collapsed) { setClosing(false); setRendered(true); }
        else if (rendered) {
            setClosing(true);
            const t = setTimeout(() => { setRendered(false); setClosing(false); }, 180);
            return () => clearTimeout(t);
        }
        return undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collapsed]);
    const bodyAnim = closing ? 'od-row-out' : 'od-row-in';

    // Sticky offsets: the bar piles at index*--od-bar; the sub-headers (only when
    // active) sit just below this section's own bar.
    const barTop = { top: `calc(${index} * var(--od-bar))`, zIndex: 40 + index } as React.CSSProperties;
    const groupTop = { top: `calc((${index} + 1) * var(--od-bar))`, zIndex: 30 } as React.CSSProperties;
    const labelsTop = { top: `calc((${index} + 1) * var(--od-bar) + var(--od-hrow))`, zIndex: 30 } as React.CSSProperties;

    return (
        <div data-exp={expiration} className="od-sec">
            {/* Expiration bar — always sticky, accumulates into the top pile.
                Whole bar is one toggle; only the chevron rotates (v / >).
                NOTE: the measurement ref lives HERE (on the bar), not on the
                .od-sec wrapper: the wrapper is `display: contents` (no box), so
                its getBoundingClientRect() would be all-zeros. The bar is a real
                box we can measure to know which section is pinned/active. */}
            <button
                ref={innerRef}
                type="button"
                onClick={onToggle}
                aria-expanded={!collapsed}
                title={collapsed ? 'Expand this expiration' : 'Collapse this expiration'}
                style={barTop}
                className={
                    'od-bar sticky flex w-full items-center justify-center gap-2 px-2 text-[11px] font-semibold ' +
                    (active ? 'od-current' : '')
                }
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                     strokeLinecap="round" strokeLinejoin="round"
                     className={'h-3 w-3 transition-transform ' + (collapsed ? '-rotate-90' : '')}>
                    <path d="m6 9 6 6 6-6" />
                </svg>
                <span className="tabular-nums">{expiration}&nbsp; {t('chain.strikes', { count: strikes.length })}</span>
            </button>

            {rendered && (
                <>
                    {/* Group row: Calls | Strike | Puts (sticky only when active). */}
                    <div
                        style={active ? groupTop : undefined}
                        className={
                            'od-sub grid text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 ' +
                            bodyAnim + ' ' + (active ? 'sticky' : '')
                        }
                    >
                        <div className="od-calls px-2 py-1 text-center font-semibold text-emerald-700 dark:text-emerald-400" style={{ gridColumn: `span ${callColumns.length}` }}>{t('chain.calls')}</div>
                        <div className="od-strike-cell px-1.5 py-1 text-center font-semibold">{t('chain.strike')}</div>
                        <div className="od-puts px-2 py-1 text-center font-semibold text-rose-700 dark:text-rose-400" style={{ gridColumn: `span ${putColumns.length}` }}>{t('chain.puts')}</div>
                    </div>
                    {/* Column-label row (sticky only when active). */}
                    <div
                        style={active ? labelsTop : undefined}
                        className={
                            'od-sub od-labels grid text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 ' +
                            bodyAnim + ' ' + (active ? 'sticky' : '')
                        }
                    >
                        {callColumns.map((c) => (
                            <div key={`c${c.key}`} title={c.label} className="px-2 py-1 text-right font-medium">{c.headerLabel || c.label}</div>
                        ))}
                        <div className="od-strike-cell px-1.5 py-1 text-center font-medium">{t('chain.strikeSymbol')}</div>
                        {putColumns.map((c) => (
                            <div key={`p${c.key}`} title={c.label} className="px-2 py-1 text-right font-medium">{c.headerLabel || c.label}</div>
                        ))}
                    </div>
                    {/* Strike rows: staggered fade-in on open; uniform fade-out on close. */}
                    {strikes.map((strike, i) => {
                        const isAtm = strike === atmStrike;
                        const stagger = !closing && i < STAGGER_ROWS;
                        return (
                            <div
                                key={strike}
                                // Register the ATM row so the desk can scroll it to
                                // the vertical center (center-strike view) on load/expand.
                                ref={isAtm ? atmRef : undefined}
                                className={
                                    'od-drow grid text-slate-700 dark:text-slate-200 ' + bodyAnim + ' ' +
                                    (isAtm ? 'od-atm' : '')
                                }
                                style={stagger ? { animationDelay: `${i * 18}ms` } : undefined}
                            >
                                <QuoteCells q={calls.get(strike)} columns={callColumns} />
                                <div
                                    title={fmt(strike)}
                                    className={
                                        'od-strike-cell px-1.5 py-1 text-center font-semibold tabular-nums ' +
                                        (isAtm ? ax.atm : 'text-slate-900 dark:text-slate-100')
                                    }
                                >
                                    {fmt(strike)}
                                </div>
                                <QuoteCells q={puts.get(strike)} columns={putColumns} />
                            </div>
                        );
                    })}
                </>
            )}
        </div>
    );
};

/**
 * The scrolling desk: renders ALL selected expirations as sibling DIV sections
 * in one scroll container (EARLIEST -> LATEST). Each expiration bar is sticky and
 * PILES UP as you scroll down (un-piles scrolling up). A scroll listener marks
 * the in-view section active so its sub-headers stay pinned below the pile.
 */
const ChainTable: React.FC<{ symbol: string; sections: ChainSection[]; spot: number | null; columns: DeskColumnSettings; colorTheme?: ColorThemeId }> = ({ symbol, sections, spot, columns, colorTheme = DEFAULT_COLOR_THEME }) => {
    const { t } = useI18n();
    const ax = accentOf(colorTheme);
    const visibleColumns = useMemo(() => deskColumns(columns, t, colorTheme), [columns, t, colorTheme]);
    const odGrid = useMemo(() => gridCols(visibleColumns.calls.length, visibleColumns.puts.length), [visibleColumns]);
    const odMinWidth = useMemo(() => deskMinWidth(visibleColumns.calls.length, visibleColumns.puts.length), [visibleColumns]);

    // Collapsed set — SESSION-ONLY (never persisted). A freshly loaded chain must
    // ALWAYS start fully EXPANDED (empty set). Switching symbol resets it so the
    // new chain is expanded too. (See the v0.9.16 note above loadCollapsed's
    // removal for the rationale.)
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

    // A fresh chain (new symbol OR a different set of loaded expirations) resets
    // everything back to fully expanded. Collapse/expand is now PURELY MANUAL
    // (via the per-section headers and Expand all / Collapse all) — there is no
    // scroll-driven auto collapse/expand.
    const expKeyReset = sections.map((s) => s.expiration).join(',');
    useEffect(() => {
        setCollapsed(new Set());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, expKeyReset]);

    const allCollapsed = sections.length > 0 && sections.every((s) => collapsed.has(s.expiration));

    // Which section is highlighted / whose sub-headers stay pinned.
    const [activeExp, setActiveExp] = useState<string>('');

    // ---- Center-strike view ----
    // The scroll container and a registry of each section's ATM (at-the-money)
    // row element, so we can scroll the current strike to the VERTICAL CENTER
    // of the desk on load and whenever a section is (re)expanded.
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const atmRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    // barRefs holds each section's sticky expiration bar (a real, measurable box;
    // the .od-sec wrapper is display:contents so it has none). Used both for
    // active-section tracking and for scrolling a collapsed bar to its pinned slot.
    const barRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    /**
     * Scroll so the ATM row of `exp` sits in the vertical middle of the desk.
     * Accounts for the sticky expiration-bar pile above the section so the strike
     * lands in the visible center, not underneath the pinned headers.
     *
     * IMPORTANT: when a section is EXPANDING from collapsed, its rows are NOT in
     * the DOM yet on the next frame — ExpirationSection mounts them a couple of
     * renders later (the `rendered` state flips in an effect, then the staggered
     * rows paint). So we RETRY across animation frames until the ATM row actually
     * exists (bug: clicking a collapsed header only flipped the chevron because
     * the one-shot rAF found no row and bailed, leaving the desk off-screen).
     */
    const centerStrike = useCallback((exp: string) => {
        let tries = 0;
        const attempt = () => {
            const container = scrollRef.current;
            const row = atmRefs.current.get(exp);
            if (!container) return;
            if (!row) {
                // Row not mounted yet (section still expanding): retry a few frames.
                if (tries++ < 30) requestAnimationFrame(attempt);
                return;
            }
            const cRect = container.getBoundingClientRect();
            const rRect = row.getBoundingClientRect();
            // Sticky pile height above this section (bars stack at index*--od-bar).
            const barPx = parseFloat(getComputedStyle(container).getPropertyValue('--od-bar')) * 16 || 30;
            const idx = sections.findIndex((s) => s.expiration === exp);
            const pile = Math.max(0, (idx + 1)) * barPx;
            // Visible viewport (below the pile) whose center we aim the row at.
            const usableTop = cRect.top + pile;
            const usableCenter = usableTop + (cRect.bottom - usableTop) / 2;
            const rowCenter = rRect.top + rRect.height / 2;
            const delta = rowCenter - usableCenter;
            container.scrollTop += delta;
            // If the row was far off-screen it may still be settling (staggered
            // fade-in changes heights); nudge once more next frame to land exact.
            if (Math.abs(delta) > 1 && tries++ < 30) requestAnimationFrame(attempt);
        };
        requestAnimationFrame(attempt);
    }, [sections]);

    /**
     * Scroll so section `exp`'s expiration bar sits at its PINNED slot in the top
     * pile (top = index * --od-bar). Used after COLLAPSING a section so the user
     * always SEES the result: the just-collapsed bar squashed into the pile with
     * the following section right below it. Without this, collapsing a middle
     * section (while scrolled down) removes a lot of height below the fold, the
     * browser CLAMPS scrollTop, and the view jumps — so the collapsed section
     * scrolls out of sight even though its chevron flipped. Collapsing only the
     * LAST expanded section removes nothing below, hence it "worked fine" there.
     */
    const scrollBarToPinned = useCallback((exp: string) => {
        const container = scrollRef.current;
        const bar = barRefs.current.get(exp);
        if (!container || !bar) return;
        const barPx = parseFloat(getComputedStyle(container).getPropertyValue('--od-bar')) * 16 || 30;
        const idx = Math.max(0, sections.findIndex((s) => s.expiration === exp));
        // bar.offsetTop is the bar's natural position within the (position:relative)
        // scroll container; subtract the pile height of the earlier bars so THIS
        // bar lands exactly at its pinned slot.
        const target = Math.max(0, bar.offsetTop - idx * barPx);
        container.scrollTo({ top: target, behavior: 'smooth' });
    }, [sections]);

    /**
     * Focus-on-click (v0.9.25 BDD):
     * GIVEN 4 expirations loaded and user scrolled to latest (4th),
     * WHEN clicking any date bar above (2nd/3rd) in the sticky pile,
     * THEN:
     *  - current active expiration collapses (v -> >)
     *  - clicked expiration expands (and, when many >1 were expanded, becomes
     *    the ONLY expanded one — smart exclusive per user choice)
     *  - view scrolls to ATM strike in the vertical middle (centerStrike)
     * If clicked is already expanded but not active, it still collapses current
     * active and scrolls to its ATM. Clicking the active bar itself still toggles.
     */
    const toggleOne = useCallback((exp: string) => {
        // If clicking a different expiration than the active one -> focus it.
        if (exp !== activeExp) {
            const expandedCount = sections.filter((s) => !collapsed.has(s.expiration)).length;
            if (expandedCount > 1) {
                // Smart: many expanded -> exclusive, only clicked stays open.
                // This satisfies "collapse current date (4th) and expand clicked"
                // plus cleans up the other expanded ones for a focused view.
                setCollapsed(new Set(sections.map((s) => s.expiration).filter((e) => e !== exp)));
            } else {
                // Only current active is expanded (or all collapsed): swap.
                setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (activeExp) next.add(activeExp); // collapse current
                    next.delete(exp); // expand clicked
                    return next;
                });
            }
            setActiveExp(exp);
            centerStrike(exp);
            return;
        }
        // Clicking the active expiration itself -> toggle collapse/expand.
        let willExpand = false;
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(exp)) { next.delete(exp); willExpand = true; } else { next.add(exp); }
            return next;
        });
        setActiveExp(exp);
        if (willExpand) {
            centerStrike(exp);
        } else {
            window.setTimeout(() => scrollBarToPinned(exp), 200);
        }
    }, [activeExp, collapsed, sections, centerStrike, scrollBarToPinned]);
    const toggleAll = useCallback(() => {
        setCollapsed((prev) => (
            sections.every((s) => prev.has(s.expiration)) ? new Set() : new Set(sections.map((s) => s.expiration))
        ));
    }, [sections]);

    // ---- Active-section tracking ----
    // The ACTIVE section is the LAST one whose bar has already reached its pinned
    // slot in the top pile — i.e. the section whose content is currently on screen
    // below the pile. (barRefs is declared above, near the other scroll refs.)
    const recomputeActive = useCallback(() => {
        const container = scrollRef.current;
        if (!container) return;
        const barPx = parseFloat(getComputedStyle(container).getPropertyValue('--od-bar')) * 16 || 30;
        const top = container.getBoundingClientRect().top;
        let current = '';
        // A bar is "pinned" when it has scrolled up to its accumulated top offset
        // (index * barPx). Walk in order; the last pinned bar is the active one,
        // because everything above it is already stacked in the pile.
        sections.forEach((s, i) => {
            const bar = barRefs.current.get(s.expiration);
            if (!bar) return;
            const rel = bar.getBoundingClientRect().top - top;
            // Small tolerance so the very-first (top=0) bar counts as pinned.
            if (rel <= i * barPx + 1) current = s.expiration;
        });
        if (!current && sections.length) current = sections[0].expiration;
        setActiveExp(current);
    }, [sections]);

    useEffect(() => {
        const c = scrollRef.current;
        if (!c) return;
        const onScroll = () => recomputeActive();
        c.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        return () => { c.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
    }, [recomputeActive]);

    useEffect(() => {
        setActiveExp((cur) => (cur && sections.some((s) => s.expiration === cur)) ? cur : (sections[0]?.expiration ?? ''));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sections.length]);

    // After data loads (or the symbol / selected expirations change), bring the
    // FIRST expiration's current strike to the vertical center so the user lands
    // on the money instead of at the top of a long chain. Keyed on symbol +
    // the joined expiration list (expKeyReset, declared above) so it re-centers
    // whenever the loaded set changes.
    useEffect(() => {
        if (sections.length) centerStrike(sections[0].expiration);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, expKeyReset]);

    return (
        <div style={{ ['--od-grid' as string]: odGrid }}>
            {/* Controls ABOVE the desk (full width): count LEFT, toggle RIGHT. */}
            <div className="mb-2 flex w-full items-center justify-between">
                <span className="text-xs text-slate-400">
                    {sections.length} {sections.length === 1 ? t('chain.expirations') : t('chain.expirationsPlural')}
                </span>
                <button
                    type="button"
                    onClick={toggleAll}
                    className={`inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 ${ax.expHover}`}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                         strokeLinecap="round" strokeLinejoin="round"
                         className={'h-3 w-3 transition-transform ' + (allCollapsed ? '-rotate-90' : '')}>
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                    {allCollapsed ? t('chain.expandAll') : t('chain.collapseAll')}
                </button>
            </div>

            {/* Desk: full width, adaptive height. A DIV/grid layout (not a table)
                so sticky headers stay opaque during scroll. Inner wrapper carries
                the min-width so columns stay comfortable / scroll horizontally on
                small screens. */}
            <div ref={scrollRef} className="table-container w-full max-h-[calc(100dvh-210px)] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="od-desk" style={{ minWidth: odMinWidth }}>
                    {sections.map((s, i) => (
                        <ExpirationSection
                            key={s.expiration}
                            section={s}
                            index={i}
                            spot={spot}
                            callColumns={visibleColumns.calls}
                            putColumns={visibleColumns.puts}
                            colorTheme={colorTheme}
                            collapsed={collapsed.has(s.expiration)}
                            active={activeExp === s.expiration}
                            onToggle={() => toggleOne(s.expiration)}
                            innerRef={(el) => { if (el) barRefs.current.set(s.expiration, el); else barRefs.current.delete(s.expiration); }}
                            atmRef={(el) => { if (el) atmRefs.current.set(s.expiration, el); else atmRefs.current.delete(s.expiration); }}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================

const App: React.FC = () => {
    const { t: tr, lang } = useI18n();
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
    const ax = accentOf(settings.colorTheme);

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
     */
    const getDates = useCallback(async (symbol: string, credsOverride?: { token?: string; secret?: string }) => {
        const sym = symbol.trim().toUpperCase();
        setError('');
        setNotice('');
        if (!sym) {
            setError(tr('error.enterTicker'));
            setErrorNonce((n) => n + 1);
            return;
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
            const m = await loadMeta(provider, sym, ctx);
            if (ac.signal.aborted) return;
            if (m.expirations.length === 0) throw new Error(tr('error.noContracts', { symbol: sym }));
            setMeta(m);
            // Pre-select the nearest expiration by default (user can add more).
            setSelectedExps([m.expirations[0]]);
            patchSettings({ lastTicker: m.symbol });
            dbg('getDates ok', { expirations: m.expirations.length });
        } catch (e: unknown) {
            if (isAbortError(e)) { setNotice(tr('notice.cancelled')); return; }
            setMeta(null);
            setError(friendlyError(e, provider, lang));
            setErrorNonce((n) => n + 1);
            dbg('getDates error', e);
        } finally {
            if (metaAbort.current === ac) { setMetaLoading(false); metaAbort.current = null; }
        }
    }, [provider, settings, patchSettings]);

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
                const quotes = await loadExpiration(provider, meta.symbol, exp, ctxFor(settings, provider, ac.signal));
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

    /** Toggle one expiration in the multi-select, then focus the Load button so
     *  pressing Enter immediately loads (no need to click Load). */
    const toggleExpiration = useCallback((exp: string) => {
        setSelectedExps((prev) =>
            prev.includes(exp) ? prev.filter((e) => e !== exp) : [...prev, exp],
        );
        // Focus after the state/DOM settles.
        requestAnimationFrame(() => loadBtnRef.current?.focus());
    }, []);

    /** Move focus to Expirations (after ticker confirm) so Space/Enter activates it. */
    const focusGetDatesButton = useCallback(() => {
        // rAF: wait for React to commit closed dropdown / updated value.
        requestAnimationFrame(() => loadBtnRef.current?.focus());
    }, []);

    /** Select a suggestion into the ticker input without auto-fetching. */
    const chooseTickerSuggestion = useCallback((s: TickerSuggestion) => {
        setTickerInput(s.symbol);
        setTickerSuggestionsOpen(false);
        setActiveTickerSuggestion(-1);
        if (!s.hasOptions) {
            setNotice(tr('notice.noOptions', { symbol: s.symbol }));
        } else {
            setNotice('');
        }
        focusGetDatesButton();
    }, [focusGetDatesButton]);

    /** Keyboard navigation for the custom ticker suggestion popover. */
    const onTickerKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            setTickerSuggestionsOpen(false);
            setActiveTickerSuggestion(-1);
            return;
        }
        if (e.key === 'Enter') {
            // Confirm ticker → focus Expirations (Space/Enter there runs the fetch).
            // Do not submit the form from the input; button receives the next activation.
            e.preventDefault();
            if (tickerSuggestionsOpen && activeTickerSuggestion >= 0 && tickerSuggestions[activeTickerSuggestion]) {
                chooseTickerSuggestion(tickerSuggestions[activeTickerSuggestion]);
            } else {
                setTickerSuggestionsOpen(false);
                setActiveTickerSuggestion(-1);
                focusGetDatesButton();
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
    }, [tickerSuggestionsOpen, tickerSuggestions, activeTickerSuggestion, chooseTickerSuggestion, focusGetDatesButton]);

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
    return (
        <div className="min-h-screen">
            <TopBar
                settings={settings}
                provider={provider}
                onChange={patchSettings}
                onSetToken={setToken}
                onSetSecret={setSecret}
                onClearData={() => { clearCacheData(); resetView(); }}
                onClearSettings={() => { clearSettingsStore(); setSettings(freshDefaultSettings()); resetView(); }}
                onClearAll={() => { clearAll(); setSettings(freshDefaultSettings()); resetView(); }}
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

            {/* Width: comfortable centered column on phones/tablets, but on LARGE
                screens (laptops/desktops/TVs, lg: ≥1024px) go full-width so the
                option desk uses all the horizontal space instead of a narrow
                column. See index.css for the matching container note. */}
            <main className="mx-auto w-full max-w-3xl px-4 py-4 lg:max-w-none lg:px-8 2xl:px-16">
                {/* ---- Controls: STEP 1 (ticker → Expirations), STEP 2 (exp → Load) ---- */}
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    

                    {/* Multi-expiration selector + Load — after "Expirations" succeeds.
                        Pick one or MANY dates (checkboxes); they render stacked
                        earliest→latest. "All"/"None" quick toggles included. */}
                    {meta && (
                        /* A <form> so pressing Enter (once the Load button is focused
                           after picking a date) submits and loads immediately. */
                        <form
                            onSubmit={(e) => { e.preventDefault(); loadChain(); }}
                            className="flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
                        >
                            <span className="text-xs text-slate-400">{tr('controls.expirations')}</span>
                            <div className="themed-scroll flex max-w-[46vw] items-center gap-1 overflow-x-auto">
                                {meta.expirations.map((exp) => {
                                    const on = selectedExps.includes(exp);
                                    return (
                                        <button
                                            key={exp}
                                            type="button"
                                            onClick={() => toggleExpiration(exp)}
                                            aria-pressed={on}
                                            className={
                                                'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ' +
                                                (on
                                                    ? ax.chipActive
                                                    : ax.chipIdle)
                                            }
                                        >
                                            {exp}
                                        </button>
                                    );
                                })}
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedExps(selectedExps.length === meta.expirations.length ? [] : [...meta.expirations])}
                                className="shrink-0 rounded-md border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                title={tr('controls.all') + ' / ' + tr('controls.none')}
                            >
                                {selectedExps.length === meta.expirations.length ? tr('controls.none') : tr('controls.all')}
                            </button>
                            <button
                                ref={loadBtnRef}
                                type="submit"
                                disabled={expLoading || selectedExps.length === 0}
                                className={`shrink-0 rounded-md ${ax.btn} px-3 py-1 text-xs font-semibold text-white disabled:opacity-50 ${ax.focusRingOffset}`}
                            >
                                {expLoading ? tr('controls.loading') : (selectedExps.length > 1 ? tr('controls.loadCount', { count: selectedExps.length }) : tr('controls.load'))}
                            </button>
                        </form>
                    )}

                    {/* Cancel — visible only while a request is in flight. */}
                    {anyLoading && (
                        <button
                            type="button"
                            onClick={cancelAll}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-300 dark:border-rose-700 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                        >
                            <Icon.X className="h-3.5 w-3.5" /> {tr('controls.cancel')}
                        </button>
                    )}

                    {/* Underlying spot + provider label. */}
                    {chainSymbol && (
                        <div className="flex items-baseline gap-2">
                            <span className="text-lg font-bold text-slate-900 dark:text-slate-50">{chainSymbol}</span>
                            {spot != null && (
                                <span className="text-sm text-slate-500 dark:text-slate-400">
                                    {tr('spot.label')} <span className="font-semibold text-slate-800 dark:text-slate-200">${fmt(spot)}</span>
                                    {spotIsEstimated && <span className="ml-1 text-[11px] text-amber-500">{tr('spot.estimated')}</span>}
                                </span>
                            )}
                            <span className="text-xs text-slate-400">{tr('spot.delayed', { provider: provider.label.split(' ')[0] })}</span>
                        </div>
                    )}

                    {anyLoading && (
                        <span className={`animate-pulse-soft text-xs font-medium ${ax.pulse}`}>
                            {metaLoading ? tr('loading.expirations') : tr('loading.chain')}
                        </span>
                    )}
                </div>

                {/* Calm notice (e.g. cancelled). */}
                {notice && !error && (
                    <div className="mb-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                        {notice}
                    </div>
                )}

                {/* Error banner with retry. */}
                {error && (
                    <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                        <span>{error}</span>
                        <button
                            type="button"
                            onClick={() => (meta ? loadChain() : getDates(tickerInput))}
                            className="shrink-0 rounded-md border border-rose-300 dark:border-rose-700 px-2 py-0.5 text-xs font-semibold hover:bg-rose-100 dark:hover:bg-rose-900/40"
                        >
                            {tr('retry')}
                        </button>
                    </div>
                )}

                {/* Onboarding card (key required for this provider + ticker). */}
                {showOnboarding && (
                    <div className="py-10">
                        <KeyOnboarding
                            provider={provider}
                            tokenValue={settings.tokens[provider.id] || ''}
                            secretValue={settings.secrets[provider.id] || ''}
                            colorTheme={settings.colorTheme}
                            onSave={(apiToken, apiSecret) => {
                                setToken(provider.id, apiToken);
                                if (provider.supportsSecret) setSecret(provider.id, apiSecret);
                                // Pass creds directly to avoid a stale-closure race
                                // (settings state hasn't committed yet).
                                getDates(tickerInput || 'AAPL', { token: apiToken, secret: apiSecret });
                            }}
                            onPreview={onboardingPreview}
                            previewLabel={previewLabel}
                        />
                    </div>
                )}

                {/* Option chain desk (one section per expiration), or guidance. */}
                {!showOnboarding && (
                    chainSymbol && hasRows ? (
                        <ChainTable symbol={chainSymbol} sections={sections} spot={spot} columns={settings.deskColumns} colorTheme={settings.colorTheme} />
                    ) : meta && !expLoading && !chainSymbol ? (
                        <div className="grid place-items-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-16 text-sm text-slate-400">
                            {tr('notice.pickExp')} <span className={`mx-1 font-semibold ${ax.pulse}`}>{tr('controls.load')}</span> {tr('notice.toFetch')}
                        </div>
                    ) : (!meta && !metaLoading && !error) ? (
                        <div className="grid place-items-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-16 text-sm text-slate-400">
                            {tr('notice.enterTicker')} <span className="mx-1 font-semibold text-slate-600 dark:text-slate-300">{tr('controls.expirations')}</span> {tr('notice.toBegin')}
                        </div>
                    ) : null
                )}
            </main>
        </div>
    );
};

// ============================================================================
// BOOTSTRAP
// ============================================================================

const rootElement = document.getElementById('root');
if (rootElement) createRoot(rootElement).render(<React.StrictMode><I18nProvider initial={DEFAULT_LANGUAGE}><App /></I18nProvider></React.StrictMode>);
else console.error('Failed to find root element.');
