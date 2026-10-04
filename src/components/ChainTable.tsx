// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { DEFAULT_COLOR_THEME } from '../settings-store';
import { accentOf } from '../theme';
import type { ColorThemeId, DeskColumnSettings, OptionQuote, SideColumnSettings } from '../types';
import { fmt, fmtGreek, fmtInt, fmtPct } from '../utils';

// ============================================================================
// OPTION CHAIN TABLE
// ============================================================================

/** One expiration's worth of grouped quotes, ready to render as a section. */
/**
 * Max number of leading rows that get a staggered animation delay. Keeping this
 * small means the effect is visible on load but never turns a multi-thousand-row
 * chain into a long "flickering" cascade.
 */
export const STAGGER_ROWS = 15;

export interface ChainSection {
    expiration: string;
    calls: Map<number, OptionQuote>;
    puts: Map<number, OptionQuote>;
    strikes: number[];
}

export type DeskColumnKey = 'openInterest' | 'volume' | 'iv' | 'delta' | 'gamma' | 'theta' | 'vega' | 'rho' | 'bid' | 'mid' | 'ask';
export interface DeskColumnDef {
    key: DeskColumnKey;
    label: string;
    headerLabel?: string;
    className?: string;
    render: (q?: OptionQuote) => string;
}

/** Build the currently visible call/put columns from Settings → Desk columns. */
export function deskColumns(settings: DeskColumnSettings, t: (key: string) => string, colorTheme: ColorThemeId = DEFAULT_COLOR_THEME): { calls: DeskColumnDef[]; puts: DeskColumnDef[] } {
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

export function gridCols(callCount: number, putCount: number): string {
    // Strike track must fit values like "1,480.00" (high-priced underlyings) without
    // overflowing into Put Bid. 5.75rem min + slight fr boost keeps the center axis
    // readable while side columns still flex. CSS on .od-strike-cell contains overflow.
    return `repeat(${callCount}, minmax(3.5rem, 1fr)) minmax(5.75rem, 1.15fr) repeat(${putCount}, minmax(3.5rem, 1fr))`;
}
export function deskMinWidth(callCount: number, putCount: number): string {
    // Strike allowance raised in lockstep with gridCols (was 4.5rem for 4.25rem track).
    return `${Math.max(48, (callCount + putCount) * 3.75 + 6.25)}rem`;
}

/** One data cell in the grid desk. */
export const Cell: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className }) => (
    <div className={'px-2 py-1 text-right tabular-nums ' + (className || '')}>{children}</div>
);
export const QuoteCells: React.FC<{ q?: OptionQuote; columns: DeskColumnDef[] }> = ({ q, columns }) => (
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
export const ExpirationSection: React.FC<{
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
export const ChainTable: React.FC<{ symbol: string; sections: ChainSection[]; spot: number | null; columns: DeskColumnSettings; colorTheme?: ColorThemeId }> = ({ symbol, sections, spot, columns, colorTheme = DEFAULT_COLOR_THEME }) => {
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
