// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import { createPortal } from 'react-dom';
// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import { Bar, BarChart, CartesianGrid, Legend, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { computeGexProfile, computeOiVolumeTotals, computePCRatio, trimZeroBoundaries } from '../gex';
import {
    DEFAULT_LEVEL_COLORS, DEFAULT_METRIC_COLORS, GEX_LEVEL_COLORS, loadLevelColors, loadMetricColors, saveLevelColors, saveMetricColors,
    type GexLevelKey, type LevelColorSet, type MetricColorSet,
} from '../gex-colors';
import { useI18n } from '../i18n';
import { accentOf } from '../theme';
import type { DataProvider, GexLevels, GexPoint, OptionQuote, Settings } from '../types';
import { fmt, fmtInt } from '../utils';

// ============================================================================
// GEX VIEW (Tab 2) - plan section 8.1 + gex-implementation-plan-wireframe-
// tab2-gex.svg. A pure consumer of chain data App already holds: it never
// fetches, and every number comes from src/gex.ts (rule R1) - this file only
// selects which quotes to pass in and formats the results.
// ============================================================================

/** GexPoint field plotted by the bars (metric toggle, section 8.1). */
export type GexMetric = 'netGex' | 'callOi' | 'putOi' | 'callVolume' | 'putVolume';
export const GEX_METRICS: GexMetric[] = ['netGex', 'callOi', 'putOi', 'callVolume', 'putVolume'];

/** GexView.tsx's own toggleable-level key: every GexLevelKey except the
 *  legacy collapsed `gammaFlip` (ChartView.tsx-only - see gex-colors.ts's
 *  GexLevelKey doc comment; this view reads gammaFlipPos/gammaFlipNeg
 *  directly and never selects it). `spot` USED to be excluded too (always
 *  drawn, never toggleable) - it's now a toggleable/colorable Key Level like
 *  every other one, per the user's "add it similarly to other levels"
 *  request: it's the reference point every other level's position is read
 *  relative to, which is reason enough to let it be shown/hidden/recolored
 *  the same way. */
type ToggleableLevelKey = Exclude<GexLevelKey, 'gammaFlip'>;

/** The 10 toggleable Key Levels (everything in GexLevels except legacy
 *  `gammaFlip` - see ToggleableLevelKey above; also gex-colors.ts's
 *  LevelColorSet). `gammaFlipPos`/`gammaFlipNeg` each carry their own
 *  selection + color state independently (see the `selectedLevels`/
 *  `levelColors` comment below) even though the toggle/color panel usually
 *  renders them as a single combined "Gamma Flip" entry - see
 *  `gammaFlipPanelKeys` below. `callWall1_5`/`putWall1_5` ("Resistance 1.5"/
 *  "Support 1.5") sit between the primary wall and the distance-filtered
 *  `callWall2`/`putWall2`, matching their conceptual position (src/gex.ts's
 *  findCallPutWalls doc comment). `spot` is listed last here - its actual
 *  rendered position (toggle panel AND sidebar card) is decided by each
 *  one's own by-strike sort (see `levelPanelKeys`/`keyLevels` below), this
 *  array is just the base/reset order. */
const ALL_LEVEL_KEYS: ToggleableLevelKey[] = ['callWall', 'callWall1_5', 'callWall2', 'gammaFlipPos', 'gammaFlipNeg', 'putWall', 'putWall1_5', 'putWall2', 'maxPain', 'spot'];

/** Default ON selection (Part 2, revised): only Call Wall / Put Wall start
 *  OFF - they're redundant with just looking at the chart's own tallest bars.
 *  Resistance 2 / Support 2 start ON despite their current 2%-distance
 *  heuristic not being fully trusted yet (a redesign is deferred, not
 *  touching findCallPutWalls' math) - the user decided to keep them visible
 *  by default anyway. Gamma Flip (both directional keys - whichever applies
 *  to the loaded data) and Max Pain start ON. Resistance 1.5 / Support 1.5
 *  also start ON - the user is actively curious to see these (unlike
 *  Call Wall/Put Wall, which are redundant with the chart's own bars). Spot
 *  starts ON too - it's important reference info, same spirit as Gamma
 *  Flip/Max Pain defaulting on. */
const DEFAULT_SELECTED_LEVELS: ToggleableLevelKey[] = ['callWall1_5', 'callWall2', 'gammaFlipPos', 'gammaFlipNeg', 'putWall1_5', 'putWall2', 'maxPain', 'spot'];

/** i18n key for each non-gamma-flip level's sidebar/toggle-panel label and
 *  <ReferenceLine> chart label. Gamma Flip is handled separately (see
 *  `levelLabel`/`levelChartLabel` below) since its label is adaptive:
 *  plain "Gamma Flip" when only one of gammaFlipPos/gammaFlipNeg is non-null
 *  for the current data, "Gamma Flip +"/"Gamma Flip -" when both are. */
const LEVEL_LABEL_KEY: Record<Exclude<ToggleableLevelKey, 'gammaFlipPos' | 'gammaFlipNeg'>, string> = {
    callWall: 'gex.level.callWall',
    callWall1_5: 'gex.level.resistance1_5',
    callWall2: 'gex.level.resistance2',
    putWall: 'gex.level.putWall',
    putWall1_5: 'gex.level.support1_5',
    putWall2: 'gex.level.support2',
    maxPain: 'gex.level.maxPain',
    // Reuses the plain 'spot.label' key ("Spot"/"Спот") already shown
    // elsewhere in this file (spot.label/spot.estimated/spot.delayed i18n
    // group) rather than inventing a parallel 'gex.level.spot' string.
    spot: 'spot.label',
};

/** Same as LEVEL_LABEL_KEY but for the <ReferenceLine> label on the chart
 *  (distinct from gex.level.* - the sidebar/toggle-panel text labels - so the
 *  two can read differently: the chart line stays short even when the
 *  sidebar label carries an "(R1)"/"(S1)" suffix). */
const LEVEL_CHART_LABEL_KEY: Record<Exclude<ToggleableLevelKey, 'gammaFlipPos' | 'gammaFlipNeg'>, string> = {
    callWall: 'gex.chart.callWall',
    callWall1_5: 'gex.chart.resistance1_5',
    callWall2: 'gex.chart.resistance2',
    putWall: 'gex.chart.putWall',
    putWall1_5: 'gex.chart.support1_5',
    putWall2: 'gex.chart.support2',
    maxPain: 'gex.chart.maxPain',
    // 'gex.chart.spot' used to read "Spot {{price}}" for the old always-on,
    // never-rotated, plain horizontal <ReferenceLine> label (which had room
    // to spell out the price inline). Now that Spot is just another rotated
    // diagonal Key Level label like the rest (see the ALL_LEVEL_KEYS render
    // loop below), it reads plain "Spot" - no value baked into the label
    // text, same as every other level's chart label.
    spot: 'gex.chart.spot',
};

/** i18n tooltip key (Part 4) for every Key Levels panel entry - plain
 *  "gammaFlip" generic tooltip covers the single-entry case; the dual-entry
 *  case uses the directional tooltips instead (see `levelTooltip` below). */
const LEVEL_TOOLTIP_KEY: Record<ToggleableLevelKey, string> = {
    callWall: 'gex.level.tooltip.callWall',
    callWall1_5: 'gex.level.tooltip.resistance1_5',
    callWall2: 'gex.level.tooltip.resistance2',
    gammaFlipPos: 'gex.level.tooltip.gammaFlipPos',
    gammaFlipNeg: 'gex.level.tooltip.gammaFlipNeg',
    putWall: 'gex.level.tooltip.putWall',
    putWall1_5: 'gex.level.tooltip.support1_5',
    putWall2: 'gex.level.tooltip.support2',
    maxPain: 'gex.level.tooltip.maxPain',
    // Plain (non-estimated) case - see `levelTooltip` below for the
    // 'gex.level.tooltip.spotEstimated' variant used when the spot shown is
    // a put-call-parity estimate rather than the provider's own reported price.
    spot: 'gex.level.tooltip.spot',
};

export interface GexViewProps {
    settings: Settings;
    provider: DataProvider;
    /** Symbol of the loaded chain ('' when nothing is loaded). */
    symbol: string;
    /** Spot the levels were computed with (App spot, or parity estimate). */
    spot: number | null;
    spotIsEstimated: boolean;
    /** Quotes of selectedExps (from App's shared useGexLevels slice). */
    quotes: OptionQuote[];
    /** Shared GexLevels computed ONCE in App (also drawn by the Chart tab). */
    levels: GexLevels | null;
    /** True when `symbol` is a futures-priced volatility index (VIX, VXN).
     *  This tab shows a "not supported" message instead of GEX numbers ONLY
     *  when `levels` is also null (toggle off, or Black-76 pricing failed for
     *  every selected quote) - see useGexLevels' doc comment. When real
     *  per-quote-forward levels ARE available, this only adds a small note
     *  clarifying they're futures-terms-based, not spot-based. */
    isFuturesPriced: boolean;
    /** Shared with Desk and Chart (one picker in main.tsx's panel, not an
     *  independent copy) - read here only to reset zoom when it changes. */
    selectedExps: string[];
    /** Non-empty; defaults to ['netGex'] (main.tsx), matching the old single-select default. */
    metrics: GexMetric[];
    setMetrics: (metrics: GexMetric[]) => void;
}

/** 2140000000 -> "2.14B" (absolute value, 2 decimals, K/M/B/T suffix). */
function fmtCompact(v: number): string {
    const a = Math.abs(v);
    const [div, suffix] = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
    return (a / div).toFixed(2) + suffix;
}

/** Signed compact: +2.14B / -310.50M / 0.00. */
function fmtSignedCompact(v: number): string {
    return (v > 0 ? '+' : v < 0 ? '-' : '') + fmtCompact(v);
}

/**
 * Custom <ReferenceLine> label renderer (Part 3, revised): rotates a Key
 * Level's chart label -45deg and hangs it BELOW the chart's X-axis, with the
 * label's LAST character anchored right at the level's own strike/X-axis
 * tick position and the rest of the text trailing down-and-to-the-left from
 * there - same diagonal slant and the same bottom-left-to-top-right READING
 * direction as before, just relocated: it now reads as a label hanging off
 * the axis tick rather than one sitting above the bars. This replaced an
 * earlier version that anchored near the TOP of the plot area instead (see
 * git history) - the user found that placement visually cluttered the bars
 * themselves (diagonal labels sitting on top of the chart's own data), and
 * wanted them moved below the X-axis instead, like a chart library's rotated
 * axis-tick labels, just one per Key Level rather than one per axis tick.
 *
 * recharts hands a vertical <ReferenceLine>'s label render function a
 * `viewBox` whose `x` is this line's own pixel column, whose `y` is the TOP
 * of the whole plot area, and whose `height` is the plot area's height (see
 * recharts' ReferenceLine.getVerticalLineEndPoints + Label's
 * CartesianLabelContextProvider: a vertical line's rect is {x: coord, y:
 * plotTop, width: 0, height: plotHeight}) - so `viewBox.y + viewBox.height`
 * is the BOTTOM of the plot area, i.e. the X axis line itself. `BOTTOM_GAP`
 * (28px) clears recharts' own numeric X-axis tick labels (the "7,320" etc.
 * strike numbers already rendered just below the axis, ~18-20px tall at this
 * chart's 11px tick font) before the diagonal label starts, so the two don't
 * visually collide. The BarChart's own `margin.bottom` was widened (see its
 * usage site) to make room for this - a vertical <ReferenceLine>'s label is
 * rendered as a sibling layer of the plotted bars, not inside their clipped
 * group, so it is NOT clipped by the chart's own plot-area clipPath, but it
 * IS clipped by the SVG/<ResponsiveContainer>'s own bottom edge if the chart
 * isn't given enough total height via `margin.bottom` to draw into -
 * verified live (Playwright) that widening `margin.bottom` alone is
 * sufficient, no clipPath workaround needed.
 *
 * EVERY label anchors at the exact same offset below the axis (no
 * per-level stagger, same reasoning as the original top-anchored version
 * this replaces) - only each level's own strike (X position) and the -45deg
 * rotation keep labels apart. Same accepted limitation as before: two levels
 * whose strikes sit very close together can still have their diagonal labels
 * overlap - individually readable, just closer together.
 *
 * `textAnchor="end"` (flipped from the old version's `"start"`) is what
 * moves the ANCHORED character from the first to the last: with the same
 * `rotate(-45 ${x} ${y})` pivot, the text before the anchor now extends in
 * the LOCAL -x direction (characters precede the anchor for `text-anchor:
 * end`), which the same -45deg rotation sends down-and-to-the-left on
 * screen - verified live (Playwright screenshot, see the PR) that this
 * reads correctly (last character at the axis tick, trailing down-left),
 * not assumed from the transform math alone.
 */
function renderRotatedLevelLabel(color: string, text: string) {
    return (props: { viewBox?: { x?: number; y?: number; height?: number } }) => {
        const vx = props.viewBox?.x;
        const vy = props.viewBox?.y;
        const vh = props.viewBox?.height;
        if (vx == null || vy == null || vh == null) return <React.Fragment />;
        const BOTTOM_GAP = 28; // clears recharts' own numeric X-axis tick labels below the axis line
        const x = vx + 4;
        const y = vy + vh + BOTTOM_GAP;
        return (
            <text x={x} y={y} transform={`rotate(-45 ${x} ${y})`} fill={color} fontSize={10} textAnchor="end">
                {text}
            </text>
        );
    };
}

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section>
        <h3 className="mb-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        <div className="space-y-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-3 py-2.5">
            {children}
        </div>
    </section>
);

const Row: React.FC<{ label: string; value: string; valueClass?: string; dot?: string }> = ({ label, value, valueClass, dot }) => (
    <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            {dot && <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />}
            {label}
        </span>
        <span className={`font-medium tabular-nums ${valueClass ?? 'text-slate-800 dark:text-slate-100'}`}>{value}</span>
    </div>
);

/**
 * One toggleable chip combining a show/hide toggle AND its color swatch(es)
 * into a single visual unit (Metrics panel + Key Levels panel): clicking the
 * chip's body (label) toggles the metric/level on/off, clicking the nested
 * color swatch opens the native color picker instead, without also
 * triggering the toggle.
 *
 * A real `<button>` can't contain an `<input type="color">` - interactive
 * content isn't allowed inside `<button>` per the HTML spec, and support for
 * it is inconsistent across browsers even though some render it anyway - so
 * the toggle itself is a `<div role="button">` with equivalent keyboard
 * semantics (`tabIndex`, `aria-pressed`, Enter/Space via onKeyDown) instead
 * of a literal `<button>`. `swatches` (the actual `<input type="color">`(s) -
 * one for most metrics/levels, two for Net GEX's signed pos/neg halves) is
 * wrapped in its own span that stops click/mousedown propagation, so
 * interacting with the swatch never bubbles up to the outer toggle handler.
 *
 * CUSTOM HOVER/FOCUS TOOLTIP (replaces the native `title` popup as the
 * visible-on-desktop affordance; `title` itself is KEPT on the chip - see
 * below). `title`'s explanatory text is often a full sentence or two (see
 * LEVEL_TOOLTIP_KEY's i18n strings), and the OS-rendered native `title`
 * tooltip can't be animated - there is no CSS hook into it at all - so a
 * small custom tooltip renders the same text with a fade/slide-in transition
 * instead.
 *
 * PORTAL, NOT A PLAIN `group-hover` SIBLING: both the Metrics row and the Key
 * Levels row this chip lives in are `overflow-x-auto` (`themed-scroll flex
 * items-center gap-2 overflow-x-auto`). Per the CSS2.1 overflow computation
 * rules, setting `overflow-x: auto` with no explicit `overflow-y` forces
 * `overflow-y` to `auto` too (only one axis staying `visible` while the other
 * is non-visible isn't a legal combination) - so the row clips in BOTH axes,
 * not just the one it scrolls. Verified live (Playwright): a plain
 * `absolute bottom-full ... group-hover:opacity-100` tooltip, as a normal
 * in-DOM child of the chip, was silently cut off at the row's own top edge
 * exactly as that rule predicts - invisible, not just mispositioned. Fixed by
 * rendering the tooltip through `createPortal` to `document.body`, positioned
 * with `position: fixed` + `getBoundingClientRect()` (viewport coordinates,
 * independent of any ancestor's overflow/stacking context) instead of
 * `position: absolute` inside the clipped row. One consequence of the
 * portal: Tailwind's `group-hover`/`group-focus-within` selectors need real
 * DOM ancestry and can't reach across a portal boundary, so visibility here
 * is plain React state (`open`, set on mouse/focus enter+leave) rather than
 * a CSS pseudo-class - the fade/slide is still pure CSS (`transition-*`
 * classes reacting to that state), just driven by a class toggle instead of
 * `:hover`.
 *
 * The tooltip DOM node is always mounted (even while hidden, at `opacity-0
 * pointer-events-none`) rather than conditionally rendered on `open` - an
 * element that's created already AT its final "visible" style never
 * transitions (there's no prior frame to animate from); staying mounted and
 * only toggling the opacity/transform classes is what lets the transition
 * play on every open, including the very first hover.
 *
 * Horizontal placement is clamped to the viewport (`show()` below) so a chip
 * near either edge of the scrollable row doesn't push the tooltip off
 * screen; vertical placement flips from above to below the chip if there
 * isn't enough room above (e.g. a chip very close to the top of the
 * viewport) - checked against the tooltip's own measured height via `tipRef`.
 *
 * `title` is kept on the chip IN ADDITION to the custom tooltip (not
 * replaced) - touch devices with no hover state, and any assistive tech that
 * specifically keys off the native `title` attribute rather than (or
 * alongside) `aria-describedby`, still get it; it's a cheap, harmless safety
 * net under the custom one, not redundant effort. `aria-describedby` links
 * the chip to the custom tooltip node by id (via `useId`) so screen readers
 * announce the same explanatory text the visible tooltip shows.
 */
const ToggleChip: React.FC<{
    on: boolean;
    onToggle: () => void;
    title: string;
    activeClass: string;
    idleClass: string;
    swatches: React.ReactNode;
    children: React.ReactNode;
    /** Net GEX is the only chip with TWO color swatches (its signed +/-
     *  halves) - the user wants those two stacked in their own row ABOVE the
     *  label instead of inline after it, unlike every single-swatch chip
     *  (every other metric, every Key Level), which keeps the original
     *  inline (label, then swatch, same row) layout. Defaults to false
     *  (inline) so every existing call site is unaffected; only the Net GEX
     *  chip passes `true`. */
    swatchesAbove?: boolean;
}> = ({ on, onToggle, title, activeClass, idleClass, swatches, children, swatchesAbove = false }) => {
    const chipRef = useRef<HTMLDivElement>(null);
    const tipRef = useRef<HTMLDivElement>(null);
    const tooltipId = useId();
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0, placement: 'top' as 'top' | 'bottom' });

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
        }
    };
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    const GAP = 8; // px between the chip and the tooltip
    const EDGE_MARGIN = 8; // px kept clear of either viewport edge

    const show = () => {
        const chip = chipRef.current;
        if (chip) {
            const r = chip.getBoundingClientRect();
            const tipW = tipRef.current?.offsetWidth ?? 0;
            const tipH = tipRef.current?.offsetHeight ?? 0;
            const halfTip = tipW / 2;
            let left = r.left + r.width / 2;
            left = Math.min(Math.max(left, halfTip + EDGE_MARGIN), window.innerWidth - halfTip - EDGE_MARGIN);
            // Default above the chip; flip below it if there isn't room
            // above (e.g. a chip docked near the top of the viewport).
            const placement: 'top' | 'bottom' = r.top - tipH - GAP < 0 ? 'bottom' : 'top';
            const top = placement === 'top' ? r.top - GAP : r.bottom + GAP;
            setPos({ top, left, placement });
        }
        setOpen(true);
    };
    const hide = () => setOpen(false);

    return (
        <div
            ref={chipRef}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-describedby={tooltipId}
            title={title}
            onClick={onToggle}
            onKeyDown={onKeyDown}
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocus={show}
            onBlur={hide}
            className={
                'relative flex shrink-0 cursor-pointer rounded-md border px-2 py-0.5 text-xs font-medium ' +
                (swatchesAbove ? 'flex-col items-center gap-0.5 py-1' : 'items-center gap-1.5') + ' ' +
                (on ? activeClass : idleClass)
            }
        >
            {/* DOM order mirrors visual order (row layout for the default
                inline case, column layout for `swatchesAbove`) - every other
                chip keeps the exact original "label, then swatch" order
                (swatch reads to the RIGHT of the label in the normal
                left-to-right row); only Net GEX (`swatchesAbove`) flips to
                "swatches, then label" so the stacked column puts the two
                color swatches on top and the label underneath. */}
            {swatchesAbove && (
                <span className="flex shrink-0 items-center gap-1" onClick={stop} onMouseDown={stop}>
                    {swatches}
                </span>
            )}
            <span>{children}</span>
            {!swatchesAbove && (
                <span className="flex shrink-0 items-center gap-1" onClick={stop} onMouseDown={stop}>
                    {swatches}
                </span>
            )}
            {createPortal(
                <div
                    ref={tipRef}
                    id={tooltipId}
                    role="tooltip"
                    style={{
                        top: pos.top,
                        left: pos.left,
                        // Both the placement flip (-100%/0%, above vs below the
                        // chip) and the small reveal slide (a few px toward the
                        // chip while hidden, 0 once open) live in this ONE
                        // inline `transform` - an inline `style.transform`
                        // always wins over a Tailwind `translate-*` utility
                        // class for the same property (inline style beats any
                        // stylesheet rule), so the slide can't be a separate
                        // conditional className alongside this or it would
                        // simply be overridden and never apply.
                        transform: `translate(-50%, calc(${pos.placement === 'top' ? '-100%' : '0%'} + ${open ? '0px' : pos.placement === 'top' ? '4px' : '-4px'}))`,
                    }}
                    className={
                        'pointer-events-none fixed z-50 w-64 max-w-[calc(100vw-16px)] rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] leading-snug text-slate-100 shadow-lg ' +
                        'transition-[opacity,transform] duration-150 ease-out dark:border-slate-600 ' +
                        (open ? 'opacity-100' : 'opacity-0')
                    }
                >
                    {title}
                </div>,
                document.body,
            )}
        </div>
    );
};

export const GexView: React.FC<GexViewProps> = ({
    settings, provider, symbol, spot: effSpot, spotIsEstimated: effSpotIsEstimated, quotes, levels, isFuturesPriced,
    selectedExps, metrics, setMetrics,
}) => {
    const { t: tr } = useI18n();
    const ax = accentOf(settings.colorTheme);
    const na = tr('gex.na');

    // quotes / effSpot / levels come from App's useGexLevels (computed once,
    // shared with the Chart tab). The profile below only feeds the bar chart.
    const totals = useMemo(() => computeOiVolumeTotals(quotes), [quotes]);
    const profile: GexPoint[] = useMemo(
        () => (effSpot != null && quotes.length ? computeGexProfile(quotes, effSpot) : []),
        [quotes, effSpot],
    );
    const pcr = useMemo(
        () => (levels ? { byOi: levels.pcRatioOi, byVolume: levels.pcRatioVolume } : computePCRatio(quotes)),
        [levels, quotes],
    );

    // Regime: Neutral when exactly 0 or when spot/quotes (or gamma) are missing.
    const net = levels && profile.length ? levels.totalNetGex : 0;
    const regime = net > 0 ? 'positive' : net < 0 ? 'negative' : 'neutral';
    const netClass = net > 0
        ? 'text-green-600 dark:text-green-400'
        : net < 0 ? 'text-red-600 dark:text-red-400' : undefined;

    // ---- Chart data (display only: zero-boundary trimming + splitting sign
    // for colors). No more spot-percentage windowing (removed) - the chart
    // now shows the FULL range of real data for the selected expirations by
    // default; drilling into a sub-range is what xZoom/yZoomFactor are for.
    // The only trimming left is per-edge: drop all-zero strikes beyond a
    // single boundary marker on each side (trimZeroBoundaries, src/gex.ts),
    // evaluated against whichever metrics are currently selected - a strike
    // only counts as zero when every one of `metrics`'s fields reads 0 there.
    const chart = useMemo(() => {
        if (!profile.length) return null;
        const visible = trimZeroBoundaries(profile, metrics);
        if (!visible.length) return null; // pathological: all-zero across the current selection
        let gap = Infinity;
        for (let i = 1; i < visible.length; i++) gap = Math.min(gap, visible[i].strike - visible[i - 1].strike);
        const pad = Number.isFinite(gap) && gap > 0 ? gap : Math.max(1, visible[0].strike * 0.01);
        const minK = Math.min(visible[0].strike, effSpot ?? Infinity);
        const maxK = Math.max(visible[visible.length - 1].strike, effSpot ?? -Infinity);
        // Every GexPoint field is carried through (not just the selected
        // metrics) so toggling metrics on/off never needs to recompute rows -
        // only which Bars/axes get rendered below changes.
        //
        // putOiNeg/putVolumeNeg mirror putOi/putVolume onto the negative axis
        // for the bars only (same signed call/put convention netGex already
        // uses) - the real p.putOi/p.putVolume values (from src/gex.ts, rule
        // R1) are left untouched and carried through via `...p`, so the
        // tooltip/legend can still report the actual non-negative count.
        const rows = visible.map((p) => ({
            ...p,
            pos: Math.max(p.netGex, 0),
            neg: Math.min(p.netGex, 0),
            putOiNeg: -p.putOi,
            putVolumeNeg: -p.putVolume,
        }));
        return { rows, domain: [minK - pad, maxK + pad] as [number, number] };
    }, [profile, effSpot, metrics]);

    // ---- Multi-metric selection --------------------------------------------
    // netGex keeps its signed pos/neg stacked treatment. The 4 OI/Volume
    // metrics now follow the same signed call/put convention: Call OI/Volume
    // draw as plain positive bars (dataKey === the metric itself); Put OI/
    // Volume draw mirrored onto the negative axis (dataKey === `${m}Neg`,
    // see the `rows` comment above) - independently per metric, so selecting
    // only "Put OI" still draws it negative without "Call OI" also being on.
    // All metrics share one Y axis (see "Chart axes + zoom" below) - when
    // netGex is combined with an OI/Volume metric, the OI/Volume bars will
    // look small/flat next to netGex's much larger dollar-gamma magnitude.
    // That's an accepted, explicit tradeoff, not something normalized away.
    const countMetrics = GEX_METRICS.filter((m) => m !== 'netGex' && metrics.includes(m)) as Array<Exclude<GexMetric, 'netGex'>>;
    const hasNetGex = metrics.includes('netGex');
    const isPutMetric = (m: GexMetric) => m === 'putOi' || m === 'putVolume';
    /** dataKey the <Bar> for a count metric actually plots - put metrics plot
     *  their negated mirror field, so the bar draws below zero (see `rows`). */
    const barKeyFor = (m: Exclude<GexMetric, 'netGex'>) => (isPutMetric(m) ? `${m}Neg` : m);
    const metricLabel = (m: GexMetric) => tr('gex.metric.' + m);

    // ---- Per-metric bar colors (user-customizable, persisted) --------------
    const [metricColors, setMetricColorsState] = useState<MetricColorSet>(() => loadMetricColors());
    const setMetricColor = (key: keyof MetricColorSet, value: string) => {
        setMetricColorsState((prev) => {
            const next = { ...prev, [key]: value };
            saveMetricColors(next);
            return next;
        });
    };
    const colorFor = (m: GexMetric, sign?: 'pos' | 'neg'): string => {
        if (m === 'netGex') return sign === 'neg' ? metricColors.netGexNeg : metricColors.netGexPos;
        return metricColors[m];
    };
    // Metrics-panel "Reset" (distinct from the chart header's "Reset zoom"):
    // back to the original default selection (Net GEX only) and default colors.
    const resetMetricsPanel = () => {
        setMetrics(['netGex']);
        setMetricColorsState(DEFAULT_METRIC_COLORS);
        saveMetricColors(DEFAULT_METRIC_COLORS);
    };
    const fmtMetricValue = (m: GexMetric, v: number) => (m === 'netGex' ? `${fmtSignedCompact(v)} ${tr('gex.unit')}` : fmtInt(v));
    const selectedLabels = metrics.map(metricLabel);
    const chartTitle = metrics.length === 1
        ? tr('gex.chart.title', { metric: selectedLabels[0] })
        : tr('gex.chart.titleMulti', { metrics: selectedLabels.join(', ') });

    // ---- Key Levels: toggleable + colorable <ReferenceLine>s ---------------
    // Same pattern as the metrics panel above: per-level show/hide + a color
    // picker, persisted colors (gex-colors.ts's loadLevelColors/
    // saveLevelColors, dedicated 'gex.levelColors.v1' key). Selection itself
    // is plain component state (not persisted) - mirroring how `metrics`
    // selection itself works today (its *colors* persist via
    // loadMetricColors/saveMetricColors, but the selection array is just
    // useState in main.tsx with no localStorage key); unlike metrics, there's
    // no "at least one must stay on" rule here - toggling every level off is
    // a valid (if unusual) choice. Reset restores DEFAULT_SELECTED_LEVELS
    // (Part 2 - only Call Wall/Put Wall start OFF; Resistance 2/Support 2/
    // Gamma Flip/Max Pain start ON), not "every level on".
    const [selectedLevels, setSelectedLevels] = useState<Array<ToggleableLevelKey>>(() => [...DEFAULT_SELECTED_LEVELS]);
    const [levelColors, setLevelColorsState] = useState<LevelColorSet>(() => loadLevelColors());
    const setLevelColor = (key: ToggleableLevelKey, value: string) => {
        setLevelColorsState((prev) => {
            const next = { ...prev, [key]: value };
            saveLevelColors(next);
            return next;
        });
    };
    const resetLevelsPanel = () => {
        setSelectedLevels([...DEFAULT_SELECTED_LEVELS]);
        setLevelColorsState(DEFAULT_LEVEL_COLORS);
        saveLevelColors(DEFAULT_LEVEL_COLORS);
    };

    // ---- Gamma Flip adaptive +/- labeling (Part 1) -------------------------
    // gammaFlipPos/gammaFlipNeg are tracked as two fully independent
    // toggleable/colorable keys (see ALL_LEVEL_KEYS above) so a user's
    // per-direction preference survives a later reload whose data shape
    // differs - but the overwhelmingly common case is only ONE of the two
    // being non-null for the currently loaded data, and in that case showing
    // a bare "Gamma Flip" (no "+"/"-": nothing to disambiguate) reads far
    // better than a lone "Gamma Flip +" would. `bothGammaFlip` is true only
    // for a genuine two-crossing chain, where both directional entries are
    // shown side by side instead.
    const bothGammaFlip = levels?.gammaFlipPos != null && levels?.gammaFlipNeg != null;
    /** Which single key represents Gamma Flip when only one direction has a
     *  value (or neither does, e.g. no data loaded yet - arbitrary pick,
     *  moot since the value reads null either way). */
    const soloGammaFlipKey: 'gammaFlipPos' | 'gammaFlipNeg' =
        levels?.gammaFlipPos == null && levels?.gammaFlipNeg != null ? 'gammaFlipNeg' : 'gammaFlipPos';
    /** Keys the Key Levels toggle/color panel actually renders for Gamma Flip
     *  this render - one combined entry, or both directional entries. This is
     *  the "dynamic based on current data" part; the sidebar card mirrors it
     *  via the `keyLevels` array below. */
    const gammaFlipPanelKeys: Array<'gammaFlipPos' | 'gammaFlipNeg'> = bothGammaFlip ? ['gammaFlipPos', 'gammaFlipNeg'] : [soloGammaFlipKey];
    /** Base logical order, BEFORE the by-strike sort just below - only used
     *  as the stable tie-break among levels that sort equal (i.e. every
     *  null-valued one, see `levelPanelKeys` itself). `spot` sits next to the
     *  gamma-flip entries here since it's the reference point every other
     *  level's position is read relative to - a reasonable logical "center",
     *  though it's moot for the actual rendered order once sorted below. */
    const levelPanelKeysBase: Array<ToggleableLevelKey> = ['callWall', 'callWall1_5', 'callWall2', ...gammaFlipPanelKeys, 'spot', 'putWall', 'putWall1_5', 'putWall2', 'maxPain'];
    /** The Key Levels TOGGLE PANEL's actual left-to-right order: ascending by
     *  each level's live strike (`levels?.[key]`), recomputed every render so
     *  it tracks real data as it loads/changes - the user wants the chip with
     *  the LOWEST strike leftmost and the HIGHEST strike rightmost. This is
     *  the mirror image of the sidebar Card's own sort below (`keyLevels`'
     *  `.sort()`): same idea, OPPOSITE direction (ascending here for a
     *  left-to-right row vs. descending there for a top-to-bottom list), and
     *  over a completely independent array/state - sorting this one must
     *  never affect `keyLevels`' sidebar order, and vice versa.
     *
     *  A level with no value for the current data (an optional wall/gamma-
     *  flip direction that doesn't qualify, or no data loaded at all) has no
     *  real strike to sort by, so it sinks to the FAR RIGHT, after every
     *  level with a real value - mirroring the sidebar's own "nulls sink"
     *  rule, just at the opposite end since this row reads left-to-right
     *  instead of top-to-bottom. `Array#sort` is stable, so among themselves
     *  the null-valued entries keep `levelPanelKeysBase`'s order. */
    const levelPanelKeys: Array<ToggleableLevelKey> = [...levelPanelKeysBase].sort((a, b) => {
        const va = levels?.[a] ?? null;
        const vb = levels?.[b] ?? null;
        if (va == null) return vb == null ? 0 : 1;
        if (vb == null) return -1;
        return va - vb;
    });

    const levelLabel = (key: ToggleableLevelKey): string => {
        if (key === 'gammaFlipPos' || key === 'gammaFlipNeg') {
            return bothGammaFlip ? tr(key === 'gammaFlipPos' ? 'gex.level.gammaFlipPos' : 'gex.level.gammaFlipNeg') : tr('gex.level.gammaFlip');
        }
        return tr(LEVEL_LABEL_KEY[key]);
    };
    // The dual-entry chart label ("Flip +"/"Flip -") is deliberately SHORTER
    // than the sidebar/toggle-panel label ("Gamma Flip +"/"Gamma Flip -") -
    // same short-on-chart/fuller-in-sidebar split this file already has for
    // Call Wall (R1)/Put Wall (S1) (see LEVEL_CHART_LABEL_KEY's doc comment).
    // Verified live (Playwright, SPX "All expirations") that a genuine
    // two-crossing chain can land gammaFlipPos/gammaFlipNeg only ~15 strike
    // points apart - at that distance even the shorter wording can't fully
    // keep two FULL "Gamma Flip +"/"Gamma Flip -" diagonal labels from
    // overlapping now that every label shares one fixed baseline (see
    // renderRotatedLevelLabel's doc comment - no per-level vertical offset
    // any more), so the chart case specifically gets the shorter wording;
    // the sidebar/toggle panel have much more horizontal room and keep the
    // fuller one.
    const levelChartLabel = (key: ToggleableLevelKey): string => {
        if (key === 'gammaFlipPos' || key === 'gammaFlipNeg') {
            return bothGammaFlip ? tr(key === 'gammaFlipPos' ? 'gex.chart.gammaFlipPos' : 'gex.chart.gammaFlipNeg') : tr('gex.chart.gammaFlip');
        }
        return tr(LEVEL_CHART_LABEL_KEY[key]);
    };
    /** Part 4 hover-tooltip text for a Key Levels panel entry - the combined
     *  single-entry case gets the direction-agnostic explanation, the
     *  two-entry case gets each direction's own. Spot gets its own variant
     *  when the shown value is a put-call-parity estimate rather than a
     *  provider-reported price (`effSpotIsEstimated`) - folds that signal
     *  into the tooltip instead of only a sidebar badge, so it isn't lost
     *  now that Spot is a toggleable level like the rest. */
    const levelTooltip = (key: ToggleableLevelKey): string => {
        if ((key === 'gammaFlipPos' || key === 'gammaFlipNeg') && !bothGammaFlip) return tr('gex.level.tooltip.gammaFlip');
        if (key === 'spot' && effSpotIsEstimated) return tr('gex.level.tooltip.spotEstimated');
        return tr(LEVEL_TOOLTIP_KEY[key]);
    };

    // ---- Zoom (section 8.1 part 2) ------------------------------------------
    // recharts 3.9 has no built-in rectangular zoom, so horizontal zoom
    // follows recharts' own documented drag-to-select recipe: mousedown/
    // mousemove/mouseup on the chart track a strike range (via activeLabel,
    // the dataKey value under the cursor - works regardless of how many Y
    // axes are in play), shown live with a ReferenceArea, and committed to
    // `xZoom` on mouseup (overriding the auto-windowed `chart.domain`).
    // Vertical zoom uses simple +/- buttons instead (per-axis "value under
    // cursor" isn't available with two Y axes without reaching into
    // recharts internals): `yZoomFactor` (1 = default) scales each axis'
    // natural (pre-zoom) domain around zero. Both reset whenever the loaded
    // ticker or expiration selection changes, so a stale window never
    // outlives the data it was drawn against.
    const [xZoom, setXZoom] = useState<[number, number] | null>(null);
    const [yZoomFactor, setYZoomFactor] = useState(1);
    const [dragStart, setDragStart] = useState<number | null>(null);
    const [dragEnd, setDragEnd] = useState<number | null>(null);

    const zoomResetKey = `${symbol}|${selectedExps.join(',')}`;
    useEffect(() => {
        setXZoom(null);
        setYZoomFactor(1);
        setDragStart(null);
        setDragEnd(null);
    }, [zoomResetKey]);

    const resetZoom = () => { setXZoom(null); setYZoomFactor(1); };
    const zoomInY = () => setYZoomFactor((f) => Math.max(f * 0.7, 0.1));
    const zoomOutY = () => setYZoomFactor((f) => Math.min(f / 0.7, 1));
    const isZoomed = xZoom != null || yZoomFactor !== 1;

    const onChartMouseDown = (state: { activeLabel?: string | number }) => {
        if (typeof state?.activeLabel === 'number') { setDragStart(state.activeLabel); setDragEnd(state.activeLabel); }
    };
    const onChartMouseMove = (state: { activeLabel?: string | number }) => {
        if (dragStart == null) return;
        if (typeof state?.activeLabel === 'number') setDragEnd(state.activeLabel);
    };
    const onChartMouseUp = () => {
        if (dragStart != null && dragEnd != null && dragStart !== dragEnd) {
            setXZoom([Math.min(dragStart, dragEnd), Math.max(dragStart, dragEnd)]);
        }
        setDragStart(null);
        setDragEnd(null);
    };

    const scaleAroundZero = ([lo, hi]: [number, number], factor: number): [number, number] => [lo * factor, hi * factor];

    // ---- Chart axes + zoom ---------------------------------------------------
    // Single shared Y axis for every selected metric (no dual-axis split).
    //
    // Now that Put OI/Volume also draw negative (mirroring netGex's existing
    // call/put convention), the domain tracks each side's extent
    // independently - posMax from netGex's positive half + any selected call
    // metric, negMax (a magnitude) from netGex's negative half + any selected
    // put metric - and fits the axis to [-negMax, posMax] rather than forcing
    // a single +/-max symmetric domain. This is a deliberate choice over
    // symmetric: it's what the axis already did for OI/Volume-only selections
    // before this change (a plain [0, max], i.e. negMax implicitly 0 - the
    // positive-only case below reproduces that exactly), so e.g. "Call OI"
    // alone still fills the whole chart height, not just the top half; "Put
    // OI" alone now mirrors that, filling the whole height below zero
    // ([-negMax, 0]) rather than wasting the top half on an empty positive
    // side a forced symmetric domain would leave. Pixels-per-unit is a single
    // linear scale across the whole domain either way, so a call bar and a
    // put bar of equal magnitude still draw with equal height whenever both
    // sides are in play - independent sizing only moves where the zero line
    // sits, it never distorts the relative bar heights.
    const yBase = useMemo((): [number, number] => {
        if (!chart) return [0, 1];
        let posMax = 0;
        let negMax = 0;
        for (const row of chart.rows) {
            if (hasNetGex) {
                posMax = Math.max(posMax, row.pos);
                negMax = Math.max(negMax, Math.abs(row.neg));
            }
            for (const m of countMetrics) {
                if (isPutMetric(m)) negMax = Math.max(negMax, row[m] ?? 0);
                else posMax = Math.max(posMax, row[m] ?? 0);
            }
        }
        if (posMax === 0 && negMax === 0) return [0, 1];
        return [-negMax, posMax];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chart, hasNetGex, countMetrics.join(',')]);

    const yDomain = scaleAroundZero(yBase, yZoomFactor);
    // Signed formatting once the domain can actually go negative - true
    // whenever netGex is selected, or any put metric (now also negative) is.
    const yTickFormatter = (v: number) => (yBase[0] < 0 ? fmtSignedCompact(v) : fmtCompact(v));
    const xDomain = xZoom ?? chart?.domain ?? ([0, 1] as [number, number]);

    // Sidebar Key Levels card: plain "Gamma Flip" row when only one direction
    // has a value (the common case, same adaptive rule as the toggle panel
    // above), two rows "Gamma Flip +"/"Gamma Flip -" when both do. Neither
    // row is `optional` (unlike callWall2/putWall2/callWall1_5/putWall1_5):
    // even with no data at all it still shows one placeholder "Gamma Flip"
    // row reading "-", same as callWall/putWall/maxPain already do. `spot`
    // is likewise never `optional` (GexLevels.spot is a plain `number`, not
    // nullable, whenever `levels` itself is non-null) and carries its own
    // `suffix` - the former "(est.)" badge from the now-removed symbol/spot
    // header block, folded into this row instead of being dropped (see
    // `gex.level.tooltip.spotEstimated` for the matching tooltip variant).
    //
    // Built in a fixed logical order here (matching levelPanelKeysBase'
    // order); the sidebar Card below re-sorts its OWN rendering by strike
    // price descending (see `.sort()` at the JSX usage site) - this array's
    // build order is otherwise unused for display purposes, only for feeding
    // that sort.
    const keyLevels: Array<{ key: ToggleableLevelKey; label: string; value: number | null; optional?: boolean; suffix?: string }> = [
        { key: 'callWall', label: levelLabel('callWall'), value: levels?.callWall ?? null },
        { key: 'callWall1_5', label: levelLabel('callWall1_5'), value: levels?.callWall1_5 ?? null, optional: true },
        { key: 'callWall2', label: levelLabel('callWall2'), value: levels?.callWall2 ?? null, optional: true },
        ...gammaFlipPanelKeys.map((key) => ({ key, label: levelLabel(key), value: levels?.[key] ?? null })),
        { key: 'spot', label: levelLabel('spot'), value: levels?.spot ?? null, suffix: effSpotIsEstimated ? tr('spot.estimated') : undefined },
        { key: 'putWall', label: levelLabel('putWall'), value: levels?.putWall ?? null },
        { key: 'putWall1_5', label: levelLabel('putWall1_5'), value: levels?.putWall1_5 ?? null, optional: true },
        { key: 'putWall2', label: levelLabel('putWall2'), value: levels?.putWall2 ?? null, optional: true },
        { key: 'maxPain', label: levelLabel('maxPain'), value: levels?.maxPain ?? null },
    ];

    const box = 'flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5';
    const emptyBox = 'grid h-full min-h-[240px] place-items-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 text-center text-sm text-slate-400';

    // Gate is now just "is a ticker loaded" (meta exists): the picker + Load
    // button live in the shared panel (main.tsx), so a loaded ticker with
    // nothing fetched yet for the selected expirations is an expected,
    // incomplete-until-Load state (quotes/levels below), not an error - see
    // main.tsx's gexQuotesByExp comment. Previously this also required
    // `gexExpirations.length > 0` (data already loaded for SOME expiration),
    // which no longer applies since this tab no longer restricts selection to
    // already-loaded dates.
    if (!symbol) {
        return (
            <main className="mx-auto w-full max-w-3xl px-4 py-4 lg:max-w-none lg:px-8 2xl:px-16">
                <div className={emptyBox}>{tr('gex.empty.noData')}</div>
            </main>
        );
    }

    // Futures-priced volatility index (VIX, VXN) with no real levels: either
    // settings.vixFuturesPricing is off, or it's on but Black-76 pricing
    // failed for every selected quote (no `forward` resolved) - App's
    // useGexLevels already decided `levels` is null for exactly these cases
    // (see its doc comment), so this is the only gate needed here. When
    // `levels` IS present (pricing succeeded), fall through to the normal
    // rendering path below - same computeGexProfile/computeGexLevels output
    // as every other symbol, just built from each quote's own forward
    // (src/gex.ts section 9) instead of one shared spot. The Desk tab (plain
    // chain table) was always unaffected either way.
    if (isFuturesPriced && !levels) {
        return (
            <main className="mx-auto w-full max-w-3xl px-4 py-4 lg:max-w-none lg:px-8 2xl:px-16">
                <div className={emptyBox}>{tr('gex.empty.futuresPriced', { symbol })}</div>
            </main>
        );
    }

    const chartMessage = selectedExps.length === 0
        ? tr('gex.empty.noSelection')
        : !chart ? tr('gex.empty.noGamma') : null;

    return (
        <main className="mx-auto w-full max-w-3xl px-4 py-4 lg:max-w-none lg:px-8 2xl:px-16">
            {/* ---- Controls: metric toggle + Key Levels toggle (expiration
                picker + Load live in the shared panel in main.tsx, in the
                same row as the Desk/GEX/Chart tab pills). Both panels are
                flex items of ONE flex-wrap row: plain flex-wrap naturally
                keeps them side by side whenever the viewport has room for
                both and wraps each onto its own row once it doesn't - no
                JS-measured breakpoint or hardcoded media query needed.
                `grow shrink basis-[…]` (rather than the default `auto`
                basis, which is each panel's full un-scrolled content width -
                ~660px/~850px with all 5/6 buttons showing - and would only
                let two panels share a row above ~1850px) gives the
                WRAP DECISION a smaller "comfortable" width to pack against,
                then grows each panel back out (capped by `max-w-[…]`, each
                panel's own full content width) to fill any extra room on
                the line - so a wide viewport still shows every button
                unscrolled, a mid viewport may lean on each panel's own
                `overflow-x-auto` button row before it wraps, and `min-w-`
                is just the absolute floor. `items-center` (not the
                flex-wrap default `stretch`) is load-bearing: it keeps each
                panel's own height independent of its sibling, so neither
                panel's internal `overflow-x-auto` button row is forced to
                match the other's height. Metrics stays left (plain source
                order, no extra class); Key Levels is pushed to the right via
                `ml-auto` on ITS OWN element (not `justify-between` on this
                row) - `ml-auto` consumes all free space to its left on
                whichever line it ends up sharing, so Metrics/Key Levels still
                read left/right whenever both fit on one line. On a narrower
                viewport where a panel wraps onto its own line, `ml-auto`
                right-aligns that panel alone on its line (harmless - still
                no overflow, just an alignment detail on an otherwise-empty
                line). The symbol/spot/"delayed" info block that used to
                trail after Key Levels here (last in source order) was
                removed: the user found it redundant with TopBar's own ticker
                input (always visible, every tab) and `spot` is now just
                another toggleable/colorable Key Level (see
                `ALL_LEVEL_KEYS`/`keyLevels`), its former "(est.)" badge
                folded into that level's own sidebar row/tooltip instead of a
                separate header span. The "delayed · {provider}" text
                specifically has no replacement elsewhere on THIS tab - see
                the PR description. ---- */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className={box + ' grow shrink basis-[460px] min-w-[260px] max-w-[670px]'} role="group" aria-label={tr('gex.metric.label')}>
                    <span className="text-xs text-slate-400 whitespace-nowrap">{tr('gex.metric.label')}</span>
                    <div className="themed-scroll flex items-center gap-2 overflow-x-auto">
                        {GEX_METRICS.map((m) => {
                            const on = metrics.includes(m);
                            return (
                                <ToggleChip
                                    key={m}
                                    on={on}
                                    // Independently togglable (not radio buttons); the last
                                    // remaining selected metric can't be turned off, so the
                                    // chart is never empty.
                                    onToggle={() => setMetrics(on ? (metrics.length > 1 ? metrics.filter((x) => x !== m) : metrics) : [...metrics, m])}
                                    title={tr('gex.metric.tooltip.' + m)}
                                    activeClass={ax.chipActive}
                                    idleClass={ax.chipIdle}
                                    // Net GEX is the only metric with TWO swatches (signed +/-
                                    // halves) - stack them in their own row above the label
                                    // instead of inline after it (the user found two swatches
                                    // inline, after the label, too cramped/unclear on which
                                    // swatch was which); every other metric keeps one swatch
                                    // inline, unchanged.
                                    swatchesAbove={m === 'netGex'}
                                    // Per-metric bar color pickers. Net GEX needs two (its
                                    // signed pos/neg stacked halves); the 4 OI/Volume metrics
                                    // get one each. Dependency-free <input type="color">,
                                    // always visible (not gated on `on`) so a color can be
                                    // set up before toggling the metric on.
                                    swatches={m === 'netGex' ? (
                                        <>
                                            <input
                                                type="color"
                                                value={metricColors.netGexPos}
                                                onChange={(e) => setMetricColor('netGexPos', e.target.value)}
                                                title={tr('gex.metric.colorNetGexPos')}
                                                aria-label={tr('gex.metric.colorNetGexPos')}
                                                className="h-4 w-4 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700"
                                            />
                                            <input
                                                type="color"
                                                value={metricColors.netGexNeg}
                                                onChange={(e) => setMetricColor('netGexNeg', e.target.value)}
                                                title={tr('gex.metric.colorNetGexNeg')}
                                                aria-label={tr('gex.metric.colorNetGexNeg')}
                                                className="h-4 w-4 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700"
                                            />
                                        </>
                                    ) : (
                                        <input
                                            type="color"
                                            value={metricColors[m]}
                                            onChange={(e) => setMetricColor(m, e.target.value)}
                                            title={tr('gex.metric.color', { metric: metricLabel(m) })}
                                            aria-label={tr('gex.metric.color', { metric: metricLabel(m) })}
                                            className="h-4 w-4 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700"
                                        />
                                    )}
                                >
                                    {tr('gex.metric.' + m)}
                                </ToggleChip>
                            );
                        })}
                    </div>
                    <button
                        type="button"
                        onClick={resetMetricsPanel}
                        className={'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ' + ax.chipIdle}
                    >
                        {tr('gex.metric.reset')}
                    </button>
                </div>

                {/* ---- Key Levels toggle+color panel: same per-item
                    affordances as the metrics panel above (toggle button +
                    color picker), one row per currently-rendered toggleable
                    level (Call Wall / Resistance 2 / Gamma Flip [one row, or
                    "+"/"-" as two rows when the loaded data has a genuine
                    two-crossing chain - see `levelPanelKeys`/`bothGammaFlip`
                    above] / Put Wall / Support 2 / Max Pain). Purely additive
                    - the sidebar's Key Levels card (below) keeps showing text
                    for every level regardless of this panel's state. A
                    flex-wrap sibling of the Metrics panel above (see the
                    row-level comment) rather than its own separate row. ---- */}
                <div className={box + ' grow shrink basis-[600px] min-w-[300px] max-w-[860px] ml-auto'} role="group" aria-label={tr('gex.sidebar.keyLevels')}>
                    {/* whitespace-nowrap: "Key Levels" is two words and was
                        wrapping onto "Key"/"Levels" lines in tighter layouts
                        - force it onto one line regardless of how tight the
                        row gets (same defensive treatment applied to the
                        Metrics label above, even though "Metrics" is a single
                        word that can't actually wrap). */}
                    <span className="text-xs text-slate-400 whitespace-nowrap">{tr('gex.sidebar.keyLevels')}</span>
                    <div className="themed-scroll flex items-center gap-2 overflow-x-auto">
                        {levelPanelKeys.map((key) => {
                            const on = selectedLevels.includes(key);
                            const label = levelLabel(key);
                            return (
                                <ToggleChip
                                    key={key}
                                    on={on}
                                    onToggle={() => setSelectedLevels(on ? selectedLevels.filter((x) => x !== key) : [...selectedLevels, key])}
                                    title={levelTooltip(key)}
                                    activeClass={ax.chipActive}
                                    idleClass={ax.chipIdle}
                                    swatches={
                                        <input
                                            type="color"
                                            value={levelColors[key]}
                                            onChange={(e) => setLevelColor(key, e.target.value)}
                                            title={tr('gex.level.color', { level: label })}
                                            aria-label={tr('gex.level.color', { level: label })}
                                            className="h-4 w-4 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700"
                                        />
                                    }
                                >
                                    {label}
                                </ToggleChip>
                            );
                        })}
                    </div>
                    <button
                        type="button"
                        onClick={resetLevelsPanel}
                        className={'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ' + ax.chipIdle}
                    >
                        {tr('gex.level.reset')}
                    </button>
                </div>
            </div>

            {provider.mode === 'lazy' && (
                <div className="mb-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {tr('gex.lazyHint')}
                </div>
            )}

            {/* Futures-priced symbol WITH real levels (toggle on, pricing
                succeeded): the Key Levels below are computed per-expiration-
                forward, not spot (section 9) - say so, briefly. */}
            {isFuturesPriced && levels && (
                <div className="mb-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {tr('gex.futuresPricedHint', { symbol })}
                </div>
            )}

            <div className="flex flex-col gap-4 lg:flex-row">
                {/* ---- Sidebar: exactly 4 cards (wireframe) ---- */}
                <aside className="flex w-full flex-col gap-4 lg:w-[300px] lg:shrink-0">
                    <Card title={tr('gex.sidebar.oiVolume')}>
                        <Row label={tr('gex.sidebar.totalCallOi')} value={fmtInt(totals.callOi)} />
                        <Row label={tr('gex.sidebar.totalPutOi')} value={fmtInt(totals.putOi)} />
                    </Card>
                    <Card title={tr('gex.sidebar.gexAnalysis')}>
                        <Row
                            label={tr('gex.sidebar.totalNetGex')}
                            value={levels && profile.length ? `${fmtSignedCompact(levels.totalNetGex)} ${tr('gex.unit')}` : na}
                            valueClass={netClass}
                        />
                        <Row label={tr('gex.sidebar.regime')} value={tr('gex.regime.' + regime)} />
                    </Card>
                    <Card title={tr('gex.sidebar.keyLevels')}>
                        {/* Display-only reordering: the sidebar text card reads
                            top-to-bottom by strike price, descending - NOT the
                            fixed logical order `keyLevels` was built in above
                            (that order still drives the toggle+color panel via
                            the separate `levelPanelKeys` array, untouched by
                            this sort). A null-valued row (Resistance/Support
                            1.5/2 not applicable, or Gamma Flip with no
                            crossing) has no real price to sort by, so every
                            null row sinks to the bottom, below every row with
                            a real value - Array#sort is stable, so nulls keep
                            their relative order among themselves. */}
                        {keyLevels
                            .filter((l) => !(l.optional && l.value == null))
                            .sort((a, b) => (a.value == null ? 1 : b.value == null ? -1 : b.value - a.value))
                            .map((l) => (
                                <Row
                                    key={l.key}
                                    label={l.label}
                                    value={l.value != null ? fmt(l.value) + (l.suffix ? ` ${l.suffix}` : '') : na}
                                    dot={GEX_LEVEL_COLORS[l.key].dot}
                                />
                            ))}
                    </Card>
                    <Card title={tr('gex.sidebar.pcRatio')}>
                        <Row label={tr('gex.pcRatio.byOi')} value={pcr.byOi != null ? fmt(pcr.byOi) : na} />
                        <Row label={tr('gex.pcRatio.byVolume')} value={pcr.byVolume != null ? fmt(pcr.byVolume) : na} />
                    </Card>
                </aside>

                {/* ---- Main chart ---- */}
                <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs text-slate-500 dark:text-slate-400">{chartTitle}</h3>
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                            <span className="hidden sm:inline">{tr('gex.zoom.hint')}</span>
                            <button
                                type="button"
                                onClick={zoomOutY}
                                title={tr('gex.zoom.yOut')}
                                className="shrink-0 rounded-md border border-slate-300 dark:border-slate-700 px-1.5 py-0.5 font-medium hover:border-slate-400 dark:hover:border-slate-500"
                            >
                                −
                            </button>
                            <button
                                type="button"
                                onClick={zoomInY}
                                title={tr('gex.zoom.yIn')}
                                className="shrink-0 rounded-md border border-slate-300 dark:border-slate-700 px-1.5 py-0.5 font-medium hover:border-slate-400 dark:hover:border-slate-500"
                            >
                                +
                            </button>
                            <button
                                type="button"
                                onClick={resetZoom}
                                disabled={!isZoomed}
                                className={
                                    'shrink-0 rounded-md border px-2 py-0.5 font-medium ' +
                                    (isZoomed ? ax.chipIdle : 'border-slate-200 dark:border-slate-800 text-slate-300 dark:text-slate-600')
                                }
                            >
                                {tr('gex.zoom.reset')}
                            </button>
                        </div>
                    </div>
                    <div className="h-[360px] lg:h-[calc(100dvh-304px)] lg:min-h-[420px]">
                        {chartMessage || !chart ? (
                            <div className={emptyBox}>{chartMessage}</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={chart.rows}
                                    // bottom: 110 (widened from 8) makes room for the Key Level
                                    // diagonal labels now hanging BELOW the X axis (see
                                    // renderRotatedLevelLabel's doc comment) - the longest chart
                                    // label text ("Resistance 1.5") at this -45deg rotation and
                                    // 10px font needs roughly BOTTOM_GAP (28px, clears the axis'
                                    // own numeric tick labels) + ~60px of diagonal vertical extent
                                    // + a little slack; verified live (Playwright) that 110px
                                    // keeps every label fully on-screen, not clipped by the
                                    // chart's own bottom edge.
                                    margin={{ top: 24, right: 16, bottom: 110, left: 8 }}
                                    stackOffset="sign"
                                    barCategoryGap="15%"
                                    onMouseDown={onChartMouseDown}
                                    onMouseMove={onChartMouseMove}
                                    onMouseUp={onChartMouseUp}
                                >
                                    <CartesianGrid stroke="#94a3b8" strokeOpacity={0.15} vertical={false} />
                                    <XAxis
                                        dataKey="strike"
                                        type="number"
                                        domain={xDomain}
                                        allowDataOverflow
                                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                                        stroke="#94a3b8"
                                        tickFormatter={(v: number) => fmt(v, v % 1 === 0 ? 0 : 1)}
                                    />
                                    <YAxis
                                        domain={yDomain}
                                        allowDataOverflow
                                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                                        stroke="#94a3b8"
                                        width={64}
                                        tickFormatter={yTickFormatter}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#94a3b8', fillOpacity: 0.12 }}
                                        content={({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Record<string, number> }> }) => {
                                            const row = active && payload && payload[0] ? payload[0].payload : null;
                                            if (!row) return null;
                                            return (
                                                <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs shadow">
                                                    <div className="text-slate-500 dark:text-slate-400">{tr('chain.strike')} {fmt(row.strike)}</div>
                                                    {metrics.map((m) => (
                                                        <div key={m} className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
                                                            <span
                                                                className="inline-block h-2 w-2 shrink-0 rounded-full"
                                                                style={{ background: m === 'netGex' ? colorFor('netGex', row.netGex >= 0 ? 'pos' : 'neg') : colorFor(m) }}
                                                                aria-hidden="true"
                                                            />
                                                            {metricLabel(m)}: {fmtMetricValue(m, row[m])}
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        }}
                                    />
                                    {/* verticalAlign="top": moved off the bottom edge, where it
                                        used to sit right in the middle of the Key Level diagonal
                                        labels now hanging below the X axis (see
                                        renderRotatedLevelLabel's doc comment) - recharts renders
                                        the Legend as an absolutely-positioned overlay, not
                                        something the chart's own `margin` makes room for, so
                                        widening `margin.bottom` alone didn't move it out of the
                                        labels' way; moving the Legend to the top (clear of the
                                        bars, which only draw up to the plot's own top margin) was
                                        simpler than trying to out-position it from the bottom. */}
                                    <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                                    {hasNetGex && <ReferenceLine y={0} stroke="#94a3b8" />}
                                    {hasNetGex && (
                                        <>
                                            <Bar dataKey="pos" stackId="net" name={`${tr('gex.metric.netGex')} (+)`} fill={metricColors.netGexPos} isAnimationActive={false} />
                                            <Bar dataKey="neg" stackId="net" name={`${tr('gex.metric.netGex')} (−)`} fill={metricColors.netGexNeg} isAnimationActive={false} />
                                        </>
                                    )}
                                    {countMetrics.map((m) => (
                                        <Bar key={m} dataKey={barKeyFor(m)} name={metricLabel(m)} fill={metricColors[m]} isAnimationActive={false} />
                                    ))}
                                    {dragStart != null && dragEnd != null && dragStart !== dragEnd && (
                                        <ReferenceArea x1={dragStart} x2={dragEnd} strokeOpacity={0.3} fill="#6366f1" fillOpacity={0.15} />
                                    )}
                                    {/* All 10 toggleable Key Level keys (gammaFlipPos/gammaFlipNeg
                                        included independently - see ALL_LEVEL_KEYS above), gated
                                        independently on their own toggle (selectedLevels) and drawn
                                        in their own configured color (levelColors). `levels?.[key]`
                                        reads the same computed GexLevels field the sidebar's Key
                                        Levels card already shows (src/gex.ts, rule R1) - this never
                                        recomputes anything.

                                        `spot` is included here too (full parity with every other
                                        level, per the user's "add it similarly to other levels"
                                        request) - it used to get its own always-on, un-rotated,
                                        plain-horizontal <ReferenceLine> block (removed). Wherever
                                        this code actually runs, `levels` is guaranteed non-null and
                                        `levels.spot` is exactly `effSpot` (see use-gex-levels.ts:
                                        the only way to reach this branch with `chart` truthy is
                                        `effSpot != null` - computeGexProfile is gated on that - and
                                        for a non-futures-priced symbol `levels` is non-null under
                                        that exact same condition; a futures-priced symbol with no
                                        real levels is caught by the earlier `isFuturesPriced &&
                                        !levels` early return, before this code is reached at all) -
                                        so no special-casing is needed, `levels?.spot` alone is
                                        correct. Chose full rotated-diagonal parity over keeping spot
                                        upright-and-distinct: now that it's a toggleable/colorable
                                        level like the other 9, treating it identically is the
                                        simpler, more consistent choice, and its color (amber-500,
                                        GEX_LEVEL_COLORS.spot) already reads as visually distinct
                                        from every other level's color regardless of rotation. */}
                                    {(() => {
                                        // Every drawn label shares the exact same baseline y
                                        // (see renderRotatedLevelLabel's doc comment) - only each
                                        // level's own strike (x position) and the -45deg rotation
                                        // keep labels apart, no per-drawn-level vertical offset.
                                        return ALL_LEVEL_KEYS.map((key) => {
                                            if (!selectedLevels.includes(key)) return null;
                                            const value = levels?.[key];
                                            if (value == null) return null;
                                            const color = levelColors[key];
                                            return (
                                                <ReferenceLine
                                                    key={key}
                                                    x={value}
                                                    stroke={color}
                                                    strokeDasharray="2 4"
                                                    label={renderRotatedLevelLabel(color, levelChartLabel(key))}
                                                />
                                            );
                                        });
                                    })()}
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
};
