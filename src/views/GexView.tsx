// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import { createPortal } from 'react-dom';
// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { canPanRange, chartKeyAction, clickStep, panRange, panRangeBy, zoomRange, zoomStep } from '../zoom-pan';
import { AXIS_NEUTRAL, countAxisColor, netGexAxisColor, ratioAxisColor } from '../axis-colors';
import { groupLevelLabels, labelLayout, LEVEL_LABEL_SEPARATOR, type LevelLabelGroup, type LevelLabelItem } from '../level-labels';
import { computeGexProfile, computeOiVolumeTotals, computePCRatio, pcRatioByStrike, pointAtPrice, sumAbsGamma, trimZeroBoundaries } from '../gex';
import {
    DEFAULT_LEVEL_COLORS, DEFAULT_METRIC_COLORS, GEX_LEVEL_COLORS, loadLevelColors, loadMetricColors, saveLevelColors, saveMetricColors,
    type GexLevelKey, type LevelColorSet, type MetricColorSet,
} from '../gex-colors';
import { useI18n } from '../i18n';
import { accentOf } from '../theme';
import type { DataProvider, GexLevels, GexPoint, OptionQuote, Settings } from '../types';
import { fmt, fmtInt } from '../utils';

// ============================================================================
// GEX VIEW (Tab 2) - plan section 8.1 (`.claude/docs/spec-gex-app.md`). A pure consumer of chain data App already holds: it never
// fetches, and every number comes from src/gex.ts (rule R1) - this file only
// selects which quotes to pass in and formats the results.
// ============================================================================

/** GexPoint field plotted by the bars (metric toggle, section 8.1). */
export type GexMetric = 'netGex' | 'absoluteGamma' | 'callOi' | 'putOi' | 'callVolume' | 'putVolume' | 'pcRatioOi' | 'pcRatioVolume';
/** OI and Volume metrics: translucent areas on their own shared counts axis (like AG, other colors). */
type CountMetric = 'callOi' | 'putOi' | 'callVolume' | 'putVolume';
/** Per-strike put/call ratio lines on their own ratio axis. */
type RatioMetric = 'pcRatioOi' | 'pcRatioVolume';
/** Per-strike ratios above this are drawn at the cap (the hover shows the real value). */
const RATIO_PLOT_CAP = 5;
/** 'absoluteGamma' (AG) sits right after 'netGex' - the user's own placement
 *  request from when they first asked for a gamma-related metric - so the
 *  Metrics panel's toggle order reads Net GEX, AG, Call OI, Put OI, Call
 *  Volume, Put Volume. */
export const GEX_METRICS: GexMetric[] = ['netGex', 'absoluteGamma', 'callOi', 'putOi', 'callVolume', 'putVolume', 'pcRatioOi', 'pcRatioVolume'];

/** The GexPoint (src/gex.ts/src/types.ts) field a metric plots. Identical to
 *  the metric's own name for every metric except 'absoluteGamma', whose
 *  value lives in GexPoint's `absGamma` field - that field keeps its shorter
 *  math-layer name (matching callGex/putGex/netGex) while the toggle UI/
 *  settings persistence spells the metric out in full for clarity. Used
 *  anywhere a GexPoint field needs to be read generically by metric name
 *  (trimZeroBoundaries' `keys`, the hover-tooltip's per-row value lookup).  */
const metricDataKey = (m: GexMetric): keyof GexPoint => (m === 'absoluteGamma' ? 'absGamma' : m === 'pcRatioOi' ? 'putOi' : m === 'pcRatioVolume' ? 'putVolume' : m);

/** GexView.tsx's own toggleable-level key: every GexLevelKey, including the
 *  plain collapsed `gammaFlip` - Gamma Flip is one ordinary toggleable/
 *  colorable Key Level here, same as Max Net GEX/Min Net GEX/Max Pain (an earlier
 *  adaptive gammaFlipPos/gammaFlipNeg dual-display mechanism was removed). */
type ToggleableLevelKey = GexLevelKey;

/** The 7 toggleable Key Levels (everything in GexLevels - see
 *  ToggleableLevelKey above; also gex-colors.ts's LevelColorSet).
 *  (Resistance 1.5 / Support 1.5 - `maxNetGex1_5`/`minNetGex1_5` - were removed
 *  entirely: the user found them not working out after shipping them.
 *  Removed here alongside the corresponding
 *  `GexLevels.maxNetGex1_5`/`minNetGex1_5` fields/math removal in
 *  src/gex.ts/src/types.ts, done in a separate PR.) `spot` is listed last
 *  here - its actual rendered position (toggle panel AND sidebar card) is
 *  decided by each one's own by-strike sort (see `levelPanelKeys`/
 *  `keyLevels` below), this array is just the base/reset order. */
const ALL_LEVEL_KEYS: ToggleableLevelKey[] = ['maxNetGex', 'netGexPlus', 'gammaFlip', 'minNetGex', 'netGexMinus', 'sumNetGexPlus', 'sumNetGexMinus', 'maxPain', 'spot'];

/** Default ON selection (revised again - the user narrowed this further
 *  after seeing it live): only 75% Sum Net GEX+ / 75% Sum Net GEX- / Net GEX+ / Net GEX- /
 *  Gamma Flip start ON. Max Net GEX / Min Net GEX stay OFF (redundant with just looking at the
 *  chart's own tallest bars - unchanged from the earlier revision). Max
 *  Pain and Spot now ALSO start OFF - the user wants a quieter default
 *  view; both remain one click away in the Key Levels panel like every
 *  other level. */
const DEFAULT_SELECTED_LEVELS: ToggleableLevelKey[] = [...ALL_LEVEL_KEYS];

/** i18n key for each level's sidebar/toggle-panel label. */
const LEVEL_LABEL_KEY: Record<ToggleableLevelKey, string> = {
    maxNetGex: 'gex.level.maxNetGex',
    netGexPlus: 'gex.level.netGexPlus',
    gammaFlip: 'gex.level.gammaFlip',
    minNetGex: 'gex.level.minNetGex',
    netGexMinus: 'gex.level.netGexMinus',
    sumNetGexPlus: 'gex.level.sumNetGexPlus',
    sumNetGexMinus: 'gex.level.sumNetGexMinus',
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
const LEVEL_CHART_LABEL_KEY: Record<ToggleableLevelKey, string> = {
    maxNetGex: 'gex.chart.maxNetGex',
    netGexPlus: 'gex.chart.netGexPlus',
    gammaFlip: 'gex.chart.gammaFlip',
    minNetGex: 'gex.chart.minNetGex',
    netGexMinus: 'gex.chart.netGexMinus',
    sumNetGexPlus: 'gex.chart.sumNetGexPlus',
    sumNetGexMinus: 'gex.chart.sumNetGexMinus',
    maxPain: 'gex.chart.maxPain',
    // 'gex.chart.spot' used to read "Spot {{price}}" for the old always-on,
    // never-rotated, plain horizontal <ReferenceLine> label (which had room
    // to spell out the price inline). Now that Spot is just another rotated
    // diagonal Key Level label like the rest (see the ALL_LEVEL_KEYS render
    // loop below), it reads plain "Spot" - no value baked into the label
    // text, same as every other level's chart label.
    spot: 'gex.chart.spot',
};

/** i18n tooltip key (Part 4) for every Key Levels panel entry. */
const LEVEL_TOOLTIP_KEY: Record<ToggleableLevelKey, string> = {
    maxNetGex: 'gex.level.tooltip.maxNetGex',
    netGexPlus: 'gex.level.tooltip.netGexPlus',
    gammaFlip: 'gex.level.tooltip.gammaFlip',
    minNetGex: 'gex.level.tooltip.minNetGex',
    netGexMinus: 'gex.level.tooltip.netGexMinus',
    sumNetGexPlus: 'gex.level.tooltip.sumNetGexPlus',
    sumNetGexMinus: 'gex.level.tooltip.sumNetGexMinus',
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
 * visually collide. The chart container's own `margin.bottom` was widened
 * (see its usage site) to make room for this - a vertical <ReferenceLine>'s label is
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
function renderRotatedLevelLabel(group: LevelLabelGroup) {
    return (props: { viewBox?: { x?: number; y?: number; height?: number } }) => {
        const vx = props.viewBox?.x;
        const vy = props.viewBox?.y;
        const vh = props.viewBox?.height;
        if (vx == null || vy == null || vh == null) return <React.Fragment />;
        const BOTTOM_GAP = 28; // clears recharts' own numeric X-axis tick labels below the axis line
        const x = vx + 4;
        const y = vy + vh + BOTTOM_GAP;
        // Levels on the same price share one label (see level-labels.ts): one line
        // "A + B" when it is short enough, otherwise one level per line, each in
        // its own color. The extra lines are offset in the ROTATED frame, so they
        // stack perpendicular to the text direction and never overlap.
        const LINE_HEIGHT = 12;
        if (labelLayout(group) === 'inline') {
            return (
                <text x={x} y={y} transform={`rotate(-45 ${x} ${y})`} fontSize={10} textAnchor="end">
                    {group.items.map((item, i) => (
                        <React.Fragment key={item.key}>
                            {i > 0 && <tspan fill="#94a3b8">{LEVEL_LABEL_SEPARATOR}</tspan>}
                            <tspan fill={item.color}>{item.text}</tspan>
                        </React.Fragment>
                    ))}
                </text>
            );
        }
        return (
            <g transform={`rotate(-45 ${x} ${y})`}>
                {group.items.map((item, i) => (
                    <text key={item.key} x={x} y={y + i * LINE_HEIGHT} fill={item.color} fontSize={10} textAnchor="end">
                        {item.text}
                    </text>
                ))}
            </g>
        );
    };
}

/** Heading style shared by the sidebar cards and the chart title. */
const HEADING_CLASS = 'text-base font-semibold text-slate-800 dark:text-slate-100';

/** Y axis tick renderer that colors every label with `colorOf(value)` (recharts' default tick
 *  is one color per axis). `format` is applied here because a custom tick bypasses tickFormatter. */
const coloredTick = (colorOf: (v: number) => string, format: (v: number) => string, placement?: { dx: number; anchor: 'start' | 'end' }) => (props: { x?: number; y?: number; payload?: { value: number }; textAnchor?: string }) => {
    const v = props.payload?.value;
    if (v == null || props.x == null || props.y == null) return <React.Fragment />;
    return (
        <text x={props.x + (placement?.dx ?? 0)} y={props.y} dy="0.355em" textAnchor={placement?.anchor ?? (props.textAnchor as 'start' | 'middle' | 'end' | 'inherit' | undefined) ?? 'end'} fill={colorOf(v)} fontSize={12}>
            {format(v)}
        </text>
    );
};

/**
 * Hover/focus tooltip for the small icon buttons (same look as the chip tooltips): the
 * explanation is rendered through a portal to <body> with `position: fixed`, so no
 * `overflow` ancestor clips it. The hover handlers live on a wrapping span, not on the
 * button, because a disabled <button> receives no mouse events and its tooltip (what
 * the button would do once enabled) would never show. The native `title` is left off on
 * purpose, it would pop up a second, duplicate tooltip.
 */
const Tip: React.FC<{ text: string; side?: 'below' | 'left'; wrap?: boolean; wrapperClassName?: string; children: React.ReactNode }> = ({ text, side = 'below', wrap = false, wrapperClassName = 'inline-flex', children }) => {
    const wrapRef = useRef<HTMLSpanElement>(null);
    const tipRef = useRef<HTMLDivElement>(null);
    const tooltipId = useId();
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0, placement: 'bottom' as 'top' | 'bottom' | 'left' });
    const show = () => {
        const el = wrapRef.current;
        if (el) {
            const r = el.getBoundingClientRect();
            if (side === 'left') {
                // the vertical zoom column sits at the right edge: open to its left, centered on the button
                setPos({ top: r.top + r.height / 2, left: r.left - 8, placement: 'left' });
                setOpen(true);
                return;
            }
            const half = (tipRef.current?.offsetWidth ?? 0) / 2;
            const left = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
            const tipH = tipRef.current?.offsetHeight ?? 0;
            // below the button by default (they sit near the top of the chart), above when there is no room below
            const placement: 'top' | 'bottom' = r.bottom + 8 + tipH > window.innerHeight ? 'top' : 'bottom';
            setPos({ top: placement === 'bottom' ? r.bottom + 8 : r.top - 8, left, placement });
        }
        setOpen(true);
    };
    return (
        <span ref={wrapRef} className={wrapperClassName} onMouseEnter={show} onMouseLeave={() => setOpen(false)} onFocus={show} onBlur={() => setOpen(false)} aria-describedby={tooltipId}>
            {children}
            {createPortal(
                <div
                    ref={tipRef}
                    id={tooltipId}
                    role="tooltip"
                    style={{ top: pos.top, left: pos.left, transform: pos.placement === 'left' ? 'translate(-100%, -50%)' : `translate(-50%, ${pos.placement === 'top' ? '-100%' : '0%'})` }}
                    className={
                        'pointer-events-none fixed z-50 max-w-[calc(100vw-16px)] rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-100 shadow-lg ' +
                        (wrap ? 'w-80 whitespace-normal ' : 'w-max whitespace-nowrap ') +
                        'transition-opacity duration-200 ease-out dark:border-slate-600 ' +
                        (open ? 'opacity-100' : 'opacity-0')
                    }
                >
                    {text}
                </div>,
                document.body,
            )}
        </span>
    );
};

/** One icon set for every zoom button: heavy inline SVG strokes and solid heads painted with
 *  `currentColor`, so all of them share one style and follow the theme (the emoji did neither:
 *  some rendered in colored squares, the plus and minus were black on the dark theme). */
type ZoomIconKind = 'plus' | 'minus' | 'reset' | 'left' | 'right' | 'up' | 'down';
const ZOOM_ICON_SHAPES: Record<ZoomIconKind, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.6" />,
    minus: <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.6" />,
    // two arrows chasing each other in a circle (a sync symbol)
    reset: (
        <>
            <path d="M5.6 9.6 A7 7 0 0 1 18.8 10.4" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M18.4 14.4 A7 7 0 0 1 5.2 13.6" fill="none" stroke="currentColor" strokeWidth="2" />
            <polygon points="15.6,10 22,10 18.8,13.8" fill="currentColor" />
            <polygon points="2,14 8.4,14 5.2,10.2" fill="currentColor" />
        </>
    ),
    left: (<><path d="M20 12H9" fill="none" stroke="currentColor" strokeWidth="2.6" /><polygon points="3,12 11,5.5 11,18.5" fill="currentColor" /></>),
    right: (<><path d="M4 12h11" fill="none" stroke="currentColor" strokeWidth="2.6" /><polygon points="21,12 13,5.5 13,18.5" fill="currentColor" /></>),
    up: (<><path d="M12 20V9" fill="none" stroke="currentColor" strokeWidth="2.6" /><polygon points="12,3 5.5,11 18.5,11" fill="currentColor" /></>),
    down: (<><path d="M12 4v11" fill="none" stroke="currentColor" strokeWidth="2.6" /><polygon points="12,21 5.5,13 18.5,13" fill="currentColor" /></>),
};
const ZoomIcon: React.FC<{ kind: ZoomIconKind }> = ({ kind }) => (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="block">{ZOOM_ICON_SHAPES[kind]}</svg>
);

/** The counts axis and the put/call ratio axis share ONE column on the right: the counts axis
 *  owns this width and left-aligns its ticks, the ratio axis is 1px wide (recharts skips a zero-width axis) and draws its ticks
 *  right-aligned inside the same column (see `coloredTick`'s `placement`), so enabling OI, Volume
 *  or P/C metrics never changes the plot width. */
const SECONDARY_AXIS_WIDTH = 100;

/**
 * Box of the chart's hover tooltip: fades in and out. It stays mounted and starts at opacity 0, the
 * visible value is applied one frame later, because an element created already at its final style
 * never transitions (so the first hover would pop in).
 */
const TooltipFade: React.FC<{ shown: boolean; children: React.ReactNode }> = ({ shown, children }) => {
    const [on, setOn] = useState(false);
    useEffect(() => {
        const id = requestAnimationFrame(() => setOn(shown));
        return () => cancelAnimationFrame(id);
    }, [shown]);
    return (
        <div
            style={{ opacity: on ? 1 : 0 }}
            className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs shadow transition-opacity duration-200 ease-out"
        >
            {children}
        </div>
    );
};

/** How long the cursor must rest on the chart before the hover tooltip appears. */
const TOOLTIP_DELAY_MS = 500;

/** Small borderless zoom button holding a ZoomIcon. */
const ZOOM_BTN = 'shrink-0 select-none rounded-md px-1.5 py-0.5 font-medium leading-none hover:bg-slate-200/70 dark:hover:bg-slate-700/70 disabled:cursor-default';


/** Compact sidebar table: centered heading, tight rows (the user prefers this
 *  over rows stretched to fill the height). */
const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section>
        <h3 className={'mb-1.5 text-center ' + HEADING_CLASS}>{title}</h3>
        <div className="space-y-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-3 py-2.5">
            {children}
        </div>
    </section>
);

const Row: React.FC<{ label: string; value: string; valueClass?: string; dot?: string; dotColor?: string }> = ({ label, value, valueClass, dot, dotColor }) => (
    <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            {dot && <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />}
            {dotColor && <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} aria-hidden="true" />}
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
 * small custom tooltip renders the same text with a fade-in/fade-out transition
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
 * a CSS pseudo-class - the fade is still pure CSS (`transition-*`
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
}> = ({ on, onToggle, title, activeClass, idleClass, swatches, children }) => {
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
                'relative flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ' +
                (on ? activeClass : idleClass)
            }
        >
            {/* Every chip (including Net GEX's two signed +/- swatches) reads
                "label, then swatch(es)" inline in one row - the user tried
                stacking Net GEX's two swatches above its label in a separate
                layout and reverted after seeing it live, wanting every chip
                to look the same regardless of how many swatches it has. */}
            <span>{children}</span>
            <span className="flex shrink-0 items-center gap-1" onClick={stop} onMouseDown={stop}>
                {swatches}
            </span>
            {createPortal(
                <div
                    ref={tipRef}
                    id={tooltipId}
                    role="tooltip"
                    style={{
                        top: pos.top,
                        left: pos.left,
                        // Placement only (above vs below the chip). The tooltip no longer
                        // slides: it just fades in and out (opacity transition below).
                        transform: `translate(-50%, ${pos.placement === 'top' ? '-100%' : '0%'})`,
                    }}
                    className={
                        'pointer-events-none fixed z-50 w-64 max-w-[calc(100vw-16px)] rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] leading-snug text-slate-100 shadow-lg ' +
                        'transition-opacity duration-200 ease-out dark:border-slate-600 ' +
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

// ---------------------------------------------------------------------------
// Chart zoom persistence (xZoom survives a reload - same spirit as
// main.tsx's activeTab/selectedExps/gexMetrics persistence, but scoped to
// THIS chart specifically, so it lives here rather than in Settings/
// settings-store.ts, same reasoning as gex-colors.ts's own dedicated-key
// pattern for metric/level colors). `xZoom` is a STRIKE-PRICE range - utterly
// meaningless for a different ticker with a different strike scale (SPX's
// 7000s vs AAPL's 100s) - so the persisted blob carries its own `symbol` and
// is only ever applied when it still matches the symbol currently loaded
// (see the zoomResetKey effect below); a mismatch (reload with a different
// ticker, or switching tickers mid-session) behaves exactly like today, a
// plain reset to the default full-range/unzoomed view.
// ---------------------------------------------------------------------------
interface ChartZoomState {
    symbol: string;
    xZoom: [number, number] | null;
}

const CHART_ZOOM_KEY = 'gex.chartZoom.v1';

function loadChartZoom(): ChartZoomState | null {
    try {
        const raw = localStorage.getItem(CHART_ZOOM_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.symbol !== 'string') return null;
        const xZoom = Array.isArray(parsed.xZoom) && parsed.xZoom.length === 2 && parsed.xZoom.every((v: unknown) => typeof v === 'number')
            ? (parsed.xZoom as [number, number])
            : null;
        return { symbol: parsed.symbol, xZoom };
    } catch {
        return null;
    }
}

/** Best-effort persist (same convention as gex-colors.ts's saveMetricColors/saveLevelColors). */
function saveChartZoom(state: ChartZoomState): void {
    try { localStorage.setItem(CHART_ZOOM_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

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
    // default; drilling into a sub-range is what xZoom is for.
    // The only trimming left is per-edge: drop all-zero strikes beyond a
    // single boundary marker on each side (trimZeroBoundaries, src/gex.ts),
    // evaluated against whichever metrics are currently selected - a strike
    // only counts as zero when every one of `metrics`'s fields reads 0 there.
    const chart = useMemo(() => {
        if (!profile.length) return null;
        // metrics.map(metricDataKey): a metric name is usually its own
        // GexPoint field, except 'absoluteGamma' (field `absGamma`) - so AG
        // participates in the zero-boundary trim via its own field, exactly
        // like every other metric (e.g. AG selected alone trims by its own
        // leading/trailing zero strikes, same as netGex alone does today).
        const visible = trimZeroBoundaries(profile, metrics.map(metricDataKey));
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
            // Per-strike put/call ratios (src/gex.ts, rule R1): the real value for
            // the hover, and a capped copy for the line so one outlier strike
            // cannot flatten the whole ratio axis.
            pcRatioOi: pcRatioByStrike(p).byOi,
            pcRatioVolume: pcRatioByStrike(p).byVolume,
            pcRatioOiPlot: (() => { const r = pcRatioByStrike(p).byOi; return r == null ? null : Math.min(r, RATIO_PLOT_CAP); })(),
            pcRatioVolumePlot: (() => { const r = pcRatioByStrike(p).byVolume; return r == null ? null : Math.min(r, RATIO_PLOT_CAP); })(),
        }));
        // strikeStep: the smallest gap between two visible strikes = "one strike", the zoom-in floor is 4 of them
        return { rows, domain: [minK - pad, maxK + pad] as [number, number], strikeStep: pad };
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
    // 'absoluteGamma' (AG) is excluded from countMetrics/the shared bar axis
    // entirely - it gets its own secondary Y axis and its own Area/filled-
    // line rendering further down (hasAbsoluteGamma), deliberately NOT one
    // of the Bar-based count metrics sharing yBase/yDomain with netGex/OI/
    // Volume (it would also dominate that shared axis, since AG >= |netGex|
    // at every strike by construction - see GexPoint.absGamma's doc comment).
    const countMetrics = GEX_METRICS.filter((m) => (m === 'callOi' || m === 'putOi' || m === 'callVolume' || m === 'putVolume') && metrics.includes(m)) as CountMetric[];
    const ratioMetrics = GEX_METRICS.filter((m) => (m === 'pcRatioOi' || m === 'pcRatioVolume') && metrics.includes(m)) as RatioMetric[];
    const hasNetGex = metrics.includes('netGex');
    const hasAbsoluteGamma = metrics.includes('absoluteGamma');
    const isPutMetric = (m: GexMetric) => m === 'putOi' || m === 'putVolume';
    /** dataKey the <Bar> for a count metric actually plots - put metrics plot
     *  their negated mirror field, so the bar draws below zero (see `rows`). */
    const barKeyFor = (m: CountMetric) => (isPutMetric(m) ? `${m}Neg` : m);
    /** Short label (chip body, Legend abbreviation) - "AG" for Absolute
     *  Gamma, matching the reference tool's own abbreviation; the metric's
     *  one plain name for everything else. */
    const metricLabel = (m: GexMetric) => tr('gex.metric.' + m);
    /** Fuller label used wherever there's room to spell things out (chart
     *  title, hover-tooltip rows) - every other metric already reads fully
     *  via metricLabel; only Absolute Gamma has a distinct short ("AG") vs.
     *  full ("Absolute Gamma") form. */
    const metricLabelFull = (m: GexMetric) => (m === 'absoluteGamma' ? tr('gex.metric.absoluteGammaFull') : metricLabel(m));
    /** Reads a chart row's value for a metric generically (see
     *  metricDataKey's doc comment for why AG needs this instead of
     *  `row[m]` directly). */
    const metricValue = (m: GexMetric, row: Record<string, number | null>): number | null => (m === 'pcRatioOi' || m === 'pcRatioVolume' ? row[m] ?? null : row[metricDataKey(m)] ?? 0);

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
        setMetrics(['netGex', 'absoluteGamma']);
        setMetricColorsState(DEFAULT_METRIC_COLORS);
        saveMetricColors(DEFAULT_METRIC_COLORS);
    };
    // AG is a dollar-gamma magnitude, same unit/scale as netGex (just
    // unsigned - no cancellation between call/put) - formatted the same way
    // (compact + the "$/1%" unit), not as a plain integer count like OI/Volume.
    const fmtMetricValue = (m: GexMetric, v: number | null) => (
        v == null ? na
            : m === 'pcRatioOi' || m === 'pcRatioVolume' ? fmt(v)
            : m === 'netGex' ? `${fmtSignedCompact(v)} ${tr('gex.unit')}`
            : m === 'absoluteGamma' ? `${fmtCompact(v)} ${tr('gex.unit')}`
                : fmtInt(v)
    );
    const selectedLabels = metrics.map(metricLabelFull);
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
    // (Part 2 - only Max Net GEX/Min Net GEX start OFF; Net GEX+/Net GEX-/
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

    /** Base logical order, BEFORE the by-strike sort just below - only used
     *  as the stable tie-break among levels that sort equal (i.e. every
     *  null-valued one, see `levelPanelKeys` itself). `spot` sits next to
     *  `gammaFlip` here since it's the reference point every other level's
     *  position is read relative to - a reasonable logical "center", though
     *  it's moot for the actual rendered order once sorted below. */
    const levelPanelKeysBase: Array<ToggleableLevelKey> = ['maxNetGex', 'netGexPlus', 'gammaFlip', 'spot', 'minNetGex', 'netGexMinus', 'sumNetGexPlus', 'sumNetGexMinus', 'maxPain'];
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
    const levelPanelKeysSorted: Array<ToggleableLevelKey> = [...levelPanelKeysBase].sort((a, b) => {
        const va = levels?.[a] ?? null;
        const vb = levels?.[b] ?? null;
        if (va == null) return vb == null ? 0 : 1;
        if (vb == null) return -1;
        return va - vb;
    });
    // User request: the "Net GEX-" button always sits before "75% Sum Net GEX-"
    // in this row, even when the 75% level has the lower strike - the two
    // swap places whenever the by-strike sort would put them the other way.
    const levelPanelKeys: Array<ToggleableLevelKey> = (() => {
        const out = [...levelPanelKeysSorted];
        const i = out.indexOf('netGexMinus');
        const j = out.indexOf('sumNetGexMinus');
        if (i > j && j >= 0) { out[j] = 'netGexMinus'; out[i] = 'sumNetGexMinus'; }
        return out;
    })();

    const levelLabel = (key: ToggleableLevelKey): string => tr(LEVEL_LABEL_KEY[key]);
    const levelChartLabel = (key: ToggleableLevelKey): string => tr(LEVEL_CHART_LABEL_KEY[key]);
    /** Part 4 hover-tooltip text for a Key Levels panel entry. Spot gets its
     *  own variant when the shown value is a put-call-parity estimate rather
     *  than a provider-reported price (`effSpotIsEstimated`) - folds that
     *  signal into the tooltip instead of only a sidebar badge, so it isn't
     *  lost now that Spot is a toggleable level like the rest. */
    const levelTooltip = (key: ToggleableLevelKey): string => {
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
    // The +/- buttons zoom the strike range by 2% of the full range per side per click
    // (zoomRange, zoomStep), the arrows move it by 1% (clickStep). There is no vertical zoom. It resets whenever the loaded
    // ticker or expiration selection changes (UNLESS a persisted zoom for
    // THIS symbol is restored instead - see the effect below), so a stale
    // window never outlives the data it was drawn against.
    const [xZoom, setXZoom] = useState<[number, number] | null>(null);
    // Last row the chart tooltip showed, kept so the tooltip can fade out on it (see the Tooltip below).
    const lastTooltipRow = useRef<Record<string, number | null> | null>(null);
    const [dragStart, setDragStart] = useState<number | null>(null);
    const [dragEnd, setDragEnd] = useState<number | null>(null);

    const zoomResetKey = `${symbol}|${selectedExps.join(',')}`;
    useEffect(() => {
        // Restore a persisted zoom ONLY when it was captured for this exact
        // symbol (ChartZoomState's own doc comment above) - a reload with
        // the same ticker still selected (main.tsx's own already-shipped
        // ticker restore) brings the zoom back exactly as it was; a reload
        // or in-session switch to a DIFFERENT ticker falls through to the
        // same plain reset this effect always did.
        const persisted = loadChartZoom();
        if (persisted && persisted.symbol === symbol) {
            setXZoom(persisted.xZoom);
        } else {
            setXZoom(null);
        }
        setDragStart(null);
        setDragEnd(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [zoomResetKey]);

    // Persist is called EXPLICITLY from each user-driven mutation below
    // (zoomX/panX/the reset button/onChartMouseUp), NOT from a generic
    // useEffect reacting to [symbol, xZoom]. A reactive effect
    // was tried first and found to race the restore effect above under
    // React 18 StrictMode's deliberate dev-only double-invocation of
    // effects on mount (verified live: the restore effect's own setXZoom/
    // setYZoomFactor calls, plus a save-effect re-running with the PRE-
    // update closure values during that same double-invoke pass, clobbered
    // the just-restored real data with stale defaults before the second
    // pass re-read its own corruption back as "the persisted value").
    // Calling saveChartZoom only from genuine user actions - never from an
    // effect that also fires as a side effect of restoring on mount -
    // removes the feedback loop entirely, regardless of how many times any
    // effect is invoked. `symbol` is read from the surrounding closure
    // (stable for the lifetime of a single click handler), guarded the same
    // way the old effect was (skip when no ticker is loaded).
    const persistZoom = (next: { xZoom?: [number, number] | null }) => {
        if (!symbol) return;
        saveChartZoom({
            symbol,
            xZoom: next.xZoom !== undefined ? next.xZoom : xZoom,
        });
    };

    // Arrow buttons move the CHART in the direction of the arrow (click right: the picture moves
    // right), so the visible window moves the opposite way: `-dir` below. Horizontal moves the
    // strike range, vertical the value axis (dir 1 = the chart moves up). They only matter once
    // zoomed, the buttons are disabled otherwise, and an arrow is disabled when the chart cannot
    // move any further in its direction.
    const panX = (dir: -1 | 1) => {
        const base = chart?.domain;
        if (!base || !xZoom) return;
        setXZoomAndPersist(panRange(xZoom, base, -dir as -1 | 1, clickStep(base)));
    };
    const canPanX = (dir: -1 | 1) => !!xZoom && !!chart && canPanRange(xZoom, chart.domain, -dir as -1 | 1);
    // Horizontal (strike axis) zoom buttons: zoom in/out around the middle of the
    // current range by the same 0.7 step as the vertical ones. Zooming out past
    // the full data range returns to the default view (xZoom = null).
    const setXZoomAndPersist = (next: [number, number] | null) => { setXZoom(next); persistZoom({ xZoom: next }); };
    const zoomX = (dir: 'in' | 'out') => {
        const base = chart?.domain;
        if (!base) return;
        setXZoomAndPersist(zoomRange(xZoom ?? base, base, dir, zoomStep(base), 4 * (chart?.strikeStep ?? 1)));
    };

    // Keyboard on the GEX tab (not while typing in an input): Left / Right move the chart like the
    // arrow buttons (only while zoomed), Ctrl / Alt(Option) / Shift + Right or Up zoom in, + Left or
    // Down zoom out (chartKeyAction). The listener is registered once and calls the latest handlers.
    const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
    keyHandlerRef.current = (e: KeyboardEvent) => {
        // Escape while a drag is in progress cancels it: a range selection is dropped without
        // zooming, a Cmd/Option move puts the chart back where it was.
        if (e.key === 'Escape' && (dragStart != null || cancelPanRef.current)) {
            e.preventDefault();
            setDragStart(null);
            setDragEnd(null);
            cancelPanRef.current?.();
            return;
        }
        if (e.defaultPrevented || !chart) return;
        const el = e.target as HTMLElement | null;
        if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
        const action = chartKeyAction(e);
        if (!action) return;
        if (action === 'panLeft' || action === 'panRight') {
            if (!xZoom) return; // nothing to move at the full range, leave the key alone
            e.preventDefault();
            panX(action === 'panLeft' ? -1 : 1);
        } else {
            e.preventDefault();
            zoomX(action === 'zoomIn' ? 'in' : 'out');
        }
    };
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => keyHandlerRef.current(e);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Mouse drag with Cmd or Option held moves the chart with the cursor (grab and drag) instead of
    // selecting a range to zoom into. Only while zoomed. The capture handler on the chart box runs
    // before recharts' own handlers and stops them, window listeners follow the drag outside the box.
    const [panning, setPanning] = useState(false);
    // Set while a Cmd/Option drag is running: puts the chart back and ends the drag (Escape).
    const cancelPanRef = useRef<(() => void) | null>(null);
    const onChartPointerDownCapture = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0 || !(e.metaKey || e.altKey) || !xZoom || !chart) return;
        const axisLine = e.currentTarget.querySelector('.recharts-xAxis .recharts-cartesian-axis-line');
        const plotWidth = axisLine ? axisLine.getBoundingClientRect().width : 0;
        if (plotWidth <= 0) return;
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startRange = xZoom;
        const base = chart.domain;
        const perPx = (startRange[1] - startRange[0]) / plotWidth;
        let last: [number, number] = startRange;
        setPanning(true);
        const onMove = (m: MouseEvent) => {
            // the chart follows the cursor: dragging right shows lower strikes
            last = panRangeBy(startRange, base, -(m.clientX - startX) * perPx);
            setXZoom(last);
        };
        const end = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            cancelPanRef.current = null;
            setPanning(false);
        };
        const onUp = () => {
            end();
            persistZoom({ xZoom: last });
        };
        // Escape: back to where the drag started, nothing is saved
        cancelPanRef.current = () => {
            end();
            setXZoom(startRange);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const onChartMouseDown = (state: { activeLabel?: string | number }) => {
        if (typeof state?.activeLabel === 'number') { setDragStart(state.activeLabel); setDragEnd(state.activeLabel); }
    };
    const chartGuides = [tr('gex.zoom.hint'), tr('gex.zoom.hintMove'), tr('gex.zoom.hintKeys'), tr('gex.zoom.hintZoomKeys')].join(' | ');
    // Hover-intent for the chart tooltip: it shows only once the cursor has stopped for
    // TOOLTIP_DELAY_MS, fades out as soon as the cursor moves again or leaves the chart.
    const [tooltipArmed, setTooltipArmed] = useState(false);
    const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rearmTooltip = () => {
        setTooltipArmed(false);
        if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
        tooltipTimer.current = setTimeout(() => setTooltipArmed(true), TOOLTIP_DELAY_MS);
    };
    const disarmTooltip = () => {
        if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
        tooltipTimer.current = null;
        setTooltipArmed(false);
    };
    useEffect(() => () => { if (tooltipTimer.current) clearTimeout(tooltipTimer.current); }, []);
    const onChartMouseMove = (state: { activeLabel?: string | number }) => {
        rearmTooltip();
        if (dragStart == null) return;
        if (typeof state?.activeLabel === 'number') setDragEnd(state.activeLabel);
    };
    const onChartMouseUp = () => {
        if (dragStart != null && dragEnd != null && dragStart !== dragEnd) {
            const next: [number, number] = [Math.min(dragStart, dragEnd), Math.max(dragStart, dragEnd)];
            setXZoom(next);
            persistZoom({ xZoom: next });
        }
        setDragStart(null);
        setDragEnd(null);
    };


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
        }
        if (posMax === 0 && negMax === 0) return [0, 1];
        // 5% breathing-room padding above the max / below the min, so the
        // tallest/most-negative bar doesn't visually touch the plot area's
        // top/bottom edge. Padding is added PER SIDE, only on a side that
        // actually has data (posMax/negMax > 0) - a positive-only selection
        // (e.g. "Call OI" alone) keeps its zero baseline exactly at 0
        // instead of gaining an empty padded strip below zero where no bar
        // ever draws; a side with real extent gets the same proportional
        // gap either way.
        const padPos = posMax > 0 ? posMax * 0.05 : 0;
        const padNeg = negMax > 0 ? negMax * 0.05 : 0;
        return [-(negMax + padNeg), posMax + padPos];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chart, hasNetGex]);

    const yDomain = yBase;
    // Signed formatting once the domain can actually go negative - true
    // whenever netGex is selected, or any put metric (now also negative) is.
    const yTickFormatter = (v: number) => (yBase[0] < 0 ? fmtSignedCompact(v) : fmtCompact(v));
    const xDomain = xZoom ?? chart?.domain ?? ([0, 1] as [number, number]);

    // ---- AG's own secondary Y axis (deliberate exception to the "one
    // shared Y axis" rule above) ---------------------------------------------
    // AG is always unsigned (absGamma >= 0 by construction) and, by
    // construction, always >= |netGex| at every strike - sharing yBase/
    // yDomain with the signed netGex/OI/Volume convention would either get
    // clipped by that axis' much smaller range or force every other metric's
    // bars down to a sliver next to AG's own larger magnitude. So AG gets its
    // own independent [0, max] domain (plus the same 5%-headroom padding as
    // yBase) instead of any of yBase's signed/symmetry
    // logic, which is specific to netGex/OI/Volume's convention and doesn't
    // apply here.
    const agBase = useMemo((): [number, number] => {
        if (!chart) return [0, 1];
        let max = 0;
        for (const row of chart.rows) max = Math.max(max, row.absGamma ?? 0);
        if (max === 0) return [0, 1];
        return [0, max * 1.05];
    }, [chart]);
    const agDomain = agBase;
    const agTickFormatter = (v: number) => fmtCompact(v);

    // ---- OI / Volume counts axis (shared by the four metrics) ---------------
    // Same signed call/put convention as before (calls above zero, puts
    // mirrored below it), same per-side 5% headroom as yBase, but on their own
    // axis now: contracts are not dollars of gamma, and sharing the Net GEX
    // axis made them a flat sliver (see the metrics comment above).
    const cntBase = useMemo((): [number, number] => {
        if (!chart || countMetrics.length === 0) return [0, 1];
        let posMax = 0;
        let negMax = 0;
        for (const row of chart.rows) {
            for (const m of countMetrics) {
                const v = (row as Record<string, number>)[m] ?? 0;
                if (isPutMetric(m)) negMax = Math.max(negMax, v);
                else posMax = Math.max(posMax, v);
            }
        }
        if (posMax === 0 && negMax === 0) return [0, 1];
        return [-(negMax * 1.05), posMax * 1.05];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chart, countMetrics.join(',')]);
    const cntDomain = cntBase;
    const cntTickFormatter = (v: number) => (cntBase[0] < 0 ? fmtSignedCompact(v) : fmtCompact(v));

    // ---- Put/call ratio axis: [0, max plotted ratio] (plotted values are capped at RATIO_PLOT_CAP) ----
    const ratioBase = useMemo((): [number, number] => {
        if (!chart || ratioMetrics.length === 0) return [0, 1];
        let max = 0;
        for (const row of chart.rows) {
            for (const m of ratioMetrics) max = Math.max(max, ((row as Record<string, number | null>)[`${m}Plot`] ?? 0));
        }
        return max === 0 ? [0, 1] : [0, max * 1.05];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chart, ratioMetrics.join(',')]);
    const ratioDomain = ratioBase;

    // Sidebar Key Levels card: one plain "Gamma Flip" row, same as every
    // other non-optional level (maxNetGex/minNetGex/maxPain) - not `optional`,
    // so even with no data at all it still shows a placeholder row reading
    // "-". `spot` is likewise never `optional` (GexLevels.spot is a plain
    // `number`, not nullable, whenever `levels` itself is non-null) and
    // carries its own `suffix` - the former "(est.)" badge from the
    // now-removed symbol/spot header block, folded into this row instead of
    // being dropped (see `gex.level.tooltip.spotEstimated` for the matching
    // tooltip variant).
    //
    // Built in a fixed logical order here (matching levelPanelKeysBase'
    // order); the sidebar Card below re-sorts its OWN rendering by strike
    // price descending (see `.sort()` at the JSX usage site) - this array's
    // build order is otherwise unused for display purposes, only for feeding
    // that sort.
    const keyLevels: Array<{ key: ToggleableLevelKey; label: string; value: number | null; optional?: boolean; suffix?: string }> = [
        { key: 'maxNetGex', label: levelLabel('maxNetGex'), value: levels?.maxNetGex ?? null },
        { key: 'netGexPlus', label: levelLabel('netGexPlus'), value: levels?.netGexPlus ?? null, optional: true },
        { key: 'gammaFlip', label: levelLabel('gammaFlip'), value: levels?.gammaFlip ?? null },
        { key: 'spot', label: levelLabel('spot'), value: levels?.spot ?? null, suffix: effSpotIsEstimated ? tr('spot.estimated') : undefined },
        { key: 'minNetGex', label: levelLabel('minNetGex'), value: levels?.minNetGex ?? null },
        { key: 'netGexMinus', label: levelLabel('netGexMinus'), value: levels?.netGexMinus ?? null, optional: true },
        { key: 'sumNetGexPlus', label: levelLabel('sumNetGexPlus'), value: levels?.sumNetGexPlus ?? null, optional: true },
        { key: 'sumNetGexMinus', label: levelLabel('sumNetGexMinus'), value: levels?.sumNetGexMinus ?? null, optional: true },
        { key: 'maxPain', label: levelLabel('maxPain'), value: levels?.maxPain ?? null },
    ];

    // Values panel open/closed: per-viewer convenience, remembered in localStorage
    // (reads and writes are guarded, the panel works without storage).
    const VALUES_OPEN_KEY = 'gex.valuesOpen.v1';
    const [valuesOpen, setValuesOpen] = useState<boolean>(() => {
        try { return localStorage.getItem(VALUES_OPEN_KEY) === '1'; } catch { return false; }
    });
    const toggleValues = () => setValuesOpen((open) => {
        const next = !open;
        try { localStorage.setItem(VALUES_OPEN_KEY, next ? '1' : '0'); } catch { /* ignore */ }
        return next;
    });
    // Values table rows: every level that has a price, highest price first (same
    // order as the Levels card), mapped to the profile row of its strike (nearest
    // strike when the level is not on one - Spot, Gamma Flip).
    const valueRows = keyLevels
        .filter((l) => l.value != null)
        .sort((a, b) => (b.value as number) - (a.value as number))
        .flatMap((l) => {
            const hit = pointAtPrice(profile, l.value as number);
            return hit ? [{ key: l.key, label: l.label, point: hit.point, exact: hit.exact, pc: pcRatioByStrike(hit.point) }] : [];
        });

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
            <main className="mx-auto w-full max-w-3xl px-4 py-4 lg:max-w-none lg:px-6">
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
            <main className="mx-auto w-full max-w-3xl px-4 py-4 lg:max-w-none lg:px-6">
                <div className={emptyBox}>{tr('gex.empty.futuresPriced', { symbol })}</div>
            </main>
        );
    }

    const chartMessage = selectedExps.length === 0
        ? tr('gex.empty.noSelection')
        : !chart ? tr('gex.empty.noGamma') : null;

    return (
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-4 lg:max-w-none lg:px-6">
            {/* ---- Controls: metric toggle + Key Levels toggle (expiration
                picker + Load live in the shared panel in main.tsx). One
                flex-wrap row, `justify-between`, `items-center` so each
                panel's height is independent of its sibling. Metrics sizes
                to its content, capped at 50% of the row. Key Levels grows
                leftward from the right edge until it reaches Metrics, up to
                its own content width (see its comment below). ALL 6 metric
                chips and ALL 7 level chips always render (toggling only
                changes the fill), so the natural widths are constant
                (~708px and ~972px). ---- */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                {/* Metrics: `shrink basis-auto max-w-[50%]` sizes to its own content,
                    capped at half the row, with its own scrollable chip row as the
                    fallback when even that is too tight. No `grow`, Key Levels takes
                    the leftover space. */}
                <div className={box + ' shrink basis-auto min-w-[260px] max-w-[50%]'} role="group" aria-label={tr('gex.metric.label')}>
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
                                            title={tr('gex.metric.color', { metric: metricLabelFull(m) })}
                                            aria-label={tr('gex.metric.color', { metric: metricLabelFull(m) })}
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
                    color picker), one row per toggleable level (see
                    `levelPanelKeys`). Purely additive - the sidebar's Key
                    Levels card keeps showing text for every level.

                    Sizing: `grow basis-0 min-w-[300px] max-w-fit`. The panel
                    sits at the row's right edge and extends LEFT, like the
                    Expirations form, until it reaches the Metrics panel
                    (one `gap-2` away), so its chips are only scrolled when
                    the viewport really has no more room. `max-w-fit` caps
                    the growth at the panel's own content width, so on a wide
                    row it ends right after its last chip instead of leaving
                    dead space inside its border. (The earlier fixed
                    `max-w-[45%]` cap clipped the first chip at 2000px while
                    the gap to Metrics stayed empty.) `basis-0` keeps the
                    wrap decision cheap: both panels stay on one line as long
                    as Metrics + 300px + gap fit, the leftover goes to this
                    panel. Below that, the documented wrap applies.
                    Note `grow` and the row's `justify-between` do not
                    conflict here: once this panel has taken the free space
                    there is nothing left for `justify-between` to place,
                    and when it is capped by `max-w-fit` the leftover is the
                    gap between the two panels. ---- */}
                <div className={box + ' grow basis-0 min-w-[300px] max-w-fit'} role="group" aria-label={tr('gex.sidebar.keyLevels')}>
                    {/* whitespace-nowrap: "Key Levels" is two words and was
                        wrapping onto "Key"/"Levels" lines in tighter layouts
                        - force it onto one line regardless of how tight the
                        row gets (same defensive treatment applied to the
                        Metrics label above, even though "Metrics" is a single
                        word that can't actually wrap). */}
                    <span className="text-xs text-slate-400 whitespace-nowrap">{tr('gex.sidebar.keyLevels')}</span>
                    {/* scrollbar-hidden (NOT themed-scroll - see index.css's own doc
                        comment on that class): the user wants this one row's visible
                        scrollbar gone while staying scrollable (wheel/trackpad/touch/
                        drag) - scoped to Key Levels only, the Metrics panel's own
                        scroll row above keeps its themed scrollbar unchanged.

                        Right-aligns the chips to this row's OWN right edge (matching
                        "right-aligned like Expirations" at the chip level, not just
                        the panel's outer box) via a leading, empty, `aria-hidden`
                        spacer (`flex-1` = `flex: 1 1 0%`) as the FIRST child, NOT
                        `justify-end` on this row itself - `justify-end` was tried
                        first and reverted after finding (Playwright, 390px viewport,
                        all 7 levels toggled on) that it doesn't degrade safely once
                        the chips genuinely overflow: with `justify-content: flex-end`
                        on an `overflow-x-auto` row, Chromium does not register the
                        overflow at all once the chips (non-shrinking, `shrink-0`)
                        exceed the row's width - `scrollWidth === clientWidth`
                        measured equal - and renders the EARLIER chips in DOM order
                        (Max Net GEX, Min Net GEX, Gamma Flip, Max Pain, Net GEX- in that
                        run) at negative x-coordinates, fully or partly off-screen to
                        the left, with no way to reach them: wheel/trackpad/drag don't
                        move it (nothing registers as scrollable), and setting
                        `scrollLeft` programmatically - to 0, to the negative extreme,
                        or to the positive extreme - was clamped straight back to 0
                        every time. So this isn't a "confusing default to maybe
                        correct with a scroll-position reset on mount" - a JS
                        scroll-position fix CAN'T work here, because `scrollLeft` is
                        provably stuck; those chips would be permanently unreachable,
                        a real bug, not a rough edge. The spacer avoids the whole
                        failure mode instead of papering over it: `flex-1`'s
                        `flex-basis: 0%` contributes nothing to this row's own
                        max-content width, so when the chips fit, the spacer's
                        `flex-grow: 1` consumes the leftover space and visually
                        pushes them flush right (identical end result to
                        `justify-end` in the common case); when the chips don't fit,
                        the spacer's `flex-shrink: 1` lets it collapse to 0 width
                        (never negative) and gets out of the way entirely, leaving
                        plain left-to-right, start-anchored overflow - the same
                        ordinary, fully-scrollable behavior every other
                        `overflow-x-auto` row in this file already relies on (e.g.
                        the Metrics row above), with the first chip (lowest strike,
                        e.g. Max Net GEX) visible at the start, same as a user
                        scrolling a list would expect. */}
                    <div className="scrollbar-hidden flex items-center gap-2 overflow-x-auto">
                        <div aria-hidden="true" className="flex-1" />
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

            <div className="flex flex-col gap-4 lg:flex-1 lg:flex-row">
                {/* ---- Sidebar: Metrics table + Levels ---- */}
                <aside className="flex w-full flex-col gap-4 lg:w-[320px] lg:shrink-0">
                    {/* One Metrics table instead of the old OI Volume / GEX Analysis /
                        P/C Ratio cards: every total in one place, each row with the
                        color of the matching chart series (custom colors included). */}
                    <Card title={tr('gex.sidebar.metrics')}>
                        {/* Total Net GEX first, then Regime, then one total per metric in the
                            order of the metric toggles above the chart (GEX_METRICS): AG, Call
                            OI, Put OI, Call Volume, Put Volume, P/C OI, P/C Volume. */}
                        <Row
                            label={tr('gex.sidebar.totalNetGex')}
                            value={levels && profile.length ? `${fmtSignedCompact(levels.totalNetGex)} ${tr('gex.unit')}` : na}
                            valueClass={netClass}
                            dotColor={net < 0 ? metricColors.netGexNeg : metricColors.netGexPos}
                        />
                        {/* Regime value: green for positive gamma, red for negative, grey for neutral */}
                        <Row
                            label={tr('gex.sidebar.regime')}
                            value={tr('gex.regime.' + regime)}
                            valueClass={regime === 'positive' ? 'text-green-600 dark:text-green-400' : regime === 'negative' ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}
                            dotColor={regime === 'negative' ? metricColors.netGexNeg : regime === 'positive' ? metricColors.netGexPos : AXIS_NEUTRAL}
                        />
                        <Row
                            label={tr('gex.sidebar.totalAg')}
                            value={profile.length ? `${fmtCompact(sumAbsGamma(profile))} ${tr('gex.unit')}` : na}
                            dotColor={metricColors.absoluteGamma}
                        />
                        <Row label={tr('gex.sidebar.totalCallOi')} value={fmtInt(totals.callOi)} dotColor={metricColors.callOi} />
                        <Row label={tr('gex.sidebar.totalPutOi')} value={fmtInt(totals.putOi)} dotColor={metricColors.putOi} />
                        <Row label={tr('gex.sidebar.totalCallVolume')} value={fmtInt(totals.callVolume)} dotColor={metricColors.callVolume} />
                        <Row label={tr('gex.sidebar.totalPutVolume')} value={fmtInt(totals.putVolume)} dotColor={metricColors.putVolume} />
                        <Row label={tr('gex.sidebar.pcRatioOi')} value={pcr.byOi != null ? fmt(pcr.byOi) : na} dotColor={metricColors.pcRatioOi} />
                        <Row label={tr('gex.sidebar.pcRatioVolume')} value={pcr.byVolume != null ? fmt(pcr.byVolume) : na} dotColor={metricColors.pcRatioVolume} />
                    </Card>
                    <Card title={tr('gex.sidebar.keyLevels')}>
                        {/* Display-only reordering: the sidebar text card reads
                            top-to-bottom by strike price, descending - NOT the
                            fixed logical order `keyLevels` was built in above
                            (that order still drives the toggle+color panel via
                            the separate `levelPanelKeys` array, untouched by
                            this sort). A null-valued row (Resistance/Net GEX-
                            not applicable, or Gamma Flip with no data) has no
                            real price to sort by, so every
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
                </aside>

                {/* ---- Main chart ---- */}
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-3">
                    {/* Header: title on the left (drag hint under it), the HORIZONTAL zoom
                        row centered above the chart as `-  x  +` (zoom out, reset, zoom in),
                        Reset Zoom (both axes) on the right. */}
                    <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-start gap-2">
                        <div className="min-w-0">
                            <h3 className={HEADING_CLASS}>{chartTitle}</h3>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                            <Tip text={tr('gex.zoom.panLeft')}>
                                <button
                                    type="button"
                                    onClick={() => panX(-1)}
                                    disabled={!canPanX(-1)}
                                    aria-label={tr('gex.zoom.panLeft')}
                                    className={ZOOM_BTN + (!canPanX(-1) ? ' opacity-40' : '')}
                                >
                                    <ZoomIcon kind="left" />
                                </button>
                            </Tip>
                            <Tip text={tr('gex.zoom.xOut')}><button type="button" onClick={() => zoomX('out')} aria-label={tr('gex.zoom.xOut')} className={ZOOM_BTN}><ZoomIcon kind="minus" /></button></Tip>
                            <Tip text={tr('gex.zoom.resetH')}>
                                <button
                                    type="button"
                                    onClick={() => setXZoomAndPersist(null)}
                                    disabled={xZoom == null}
                                                                    aria-label={tr('gex.zoom.resetH')}
                                    className={ZOOM_BTN + (xZoom == null ? ' opacity-40' : '')}
                                >
                                    <ZoomIcon kind="reset" />
                                </button>
                            </Tip>
                            <Tip text={tr('gex.zoom.xIn')}><button type="button" onClick={() => zoomX('in')} aria-label={tr('gex.zoom.xIn')} className={ZOOM_BTN}><ZoomIcon kind="plus" /></button></Tip>
                            <Tip text={tr('gex.zoom.panRight')}>
                                <button
                                    type="button"
                                    onClick={() => panX(1)}
                                    disabled={!canPanX(1)}
                                    aria-label={tr('gex.zoom.panRight')}
                                    className={ZOOM_BTN + (!canPanX(1) ? ' opacity-40' : '')}
                                >
                                    <ZoomIcon kind="right" />
                                </button>
                            </Tip>
                        </div>
                        <div />
                    </div>
                    {/* select-none: dragging across the chart to zoom (onChartMouseDown/
                        onChartMouseUp below) is a mousedown+drag+mouseup gesture over plain
                        SVG <text> elements (axis ticks, Key Level labels) - without this,
                        the browser's default text-selection drag kicks in at the same time,
                        visibly highlighting those labels mid-drag. Scoped to just this chart
                        container, not the whole page, so text elsewhere (inputs, sidebar
                        values, etc.) stays normally selectable. */}
                    <div
                        className={'relative h-[360px] lg:h-auto lg:min-h-[420px] lg:flex-1 select-none' + (panning ? ' cursor-grabbing' : '')}
                        onMouseDownCapture={onChartPointerDownCapture}
                    >
                        {chartMessage || !chart ? (
                            <div className={emptyBox}>{chartMessage}</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                {/* ComposedChart, not BarChart: recharts 3.x's <Area> component
                                    explicitly refuses to render (returns null, see its own
                                    source comment: "nothing stopping us... except for
                                    historical reasons") unless the surrounding container's
                                    chartName is 'AreaChart' or 'ComposedChart' - <Bar>/
                                    <ReferenceLine>/<ReferenceArea> carry no such restriction,
                                    so switching the container is a no-op for everything else
                                    already here. Both wrappers share the exact same
                                    defaultTooltipEventType ('axis'), which is what our custom
                                    <Tooltip content> relies on - verified live (Playwright)
                                    that AG's filled area actually renders once this changed
                                    (it silently mounted zero DOM output under <BarChart>,
                                    despite registering a Legend entry). */}
                                <ComposedChart
                                    data={chart.rows}
                                    // bottom: 110 (widened from 8) makes room for the Key Level
                                    // diagonal labels now hanging BELOW the X axis (see
                                    // renderRotatedLevelLabel's doc comment) - the longest chart
                                    // label text ("Net GEX+") at this -45deg rotation and
                                    // 10px font needs roughly BOTTOM_GAP (28px, clears the axis'
                                    // own numeric tick labels) + ~60px of diagonal vertical extent
                                    // + a little slack; verified live (Playwright) that 110px
                                    // keeps every label fully on-screen, not clipped by the
                                    // chart's own bottom edge.
                                    margin={{ top: 24, right: 16, bottom: 110, left: 8 }}
                                    // No recharts accessibility layer: it makes the svg focusable (tabindex 0), so a click
                                    // on the chart drew the browser's bright focus ring, and it moves the tooltip with the
                                    // arrow keys, which the chart's own keyboard shortcuts already use.
                                    accessibilityLayer={false}
                                    stackOffset="sign"
                                    barCategoryGap="15%"
                                    onMouseDown={onChartMouseDown}
                                    onMouseMove={onChartMouseMove}
                                    onMouseLeave={disarmTooltip}
                                    onMouseUp={onChartMouseUp}
                                >
                                    <CartesianGrid stroke="#94a3b8" strokeOpacity={0.15} vertical={false} />
                                    {/* tickCount raised from recharts' default of 5 to a denser
                                        20 (X, doubled again from an earlier 10 - the user
                                        wanted roughly twice as many grid levels on the X axis)
                                        / 8 (Y) - these are CANDIDATE counts, not a
                                        guaranteed final count: recharts' default
                                        `interval="preserveEnd"` already measures each tick
                                        label's real rendered size against the axis' actual
                                        pixel width (minTickGap, default 5px) every render and
                                        drops whichever candidates would collide - so raising
                                        tickCount alone both (a) reads denser at the default
                                        full-range view and (b) automatically adapts to the
                                        current zoom: `domain={xDomain}` already reflects
                                        `xZoom` when dragging to zoom in, so a narrower zoomed
                                        domain has more real pixel width per candidate tick and
                                        more of them survive the collision check, while a wide
                                        unzoomed domain still only shows as many as fit without
                                        overlapping. Verified live at full range, a moderate
                                        zoom, and a very tight zoom - see the PR. */}
                                    <XAxis
                                        dataKey="strike"
                                        type="number"
                                        domain={xDomain}
                                        allowDataOverflow
                                        tickCount={20}
                                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                                        stroke="#94a3b8"
                                        tickFormatter={(v: number) => fmt(v, v % 1 === 0 ? 0 : 1)}
                                    />
                                    {/* axisLine/tickLine hidden on both Y axes (left/primary and
                                        right/AG) - visually minimal, floating tick VALUES only,
                                        no axis line or tick marks. Left-axis numbers already
                                        right-align by default (orientation="left" -> recharts'
                                        own getTickTextAnchor gives textAnchor="end"); right-axis
                                        (AG) numbers already left-align by default
                                        (orientation="right" -> textAnchor="start") - both read as
                                        "pointing into" the plot area with no extra tick-anchor
                                        prop needed, verified live. Only rendered while something
                                        actually plots against it (hasNetGex/countMetrics) -
                                        selecting AG alone (no Bar uses the primary axis) hides
                                        this axis instead of showing a meaningless default [0,1]
                                        scale next to real data on the AG axis. */}
                                    <YAxis
                                        domain={yDomain}
                                        allowDataOverflow
                                        tickCount={8}
                                        axisLine={false}
                                        tickLine={false}
                                        tick={hasNetGex ? coloredTick((v) => netGexAxisColor(v, metricColors), yTickFormatter) : false}
                                        stroke="#94a3b8"
                                        width={64}
                                        tickFormatter={yTickFormatter}
                                    />
                                    {/* AG's own secondary axis (see agBase/agDomain above) - only
                                        rendered while AG is selected, orientation="right" so it
                                        reads as visually distinct from the primary (left) axis
                                        every other metric shares. */}
                                    <YAxis
                                        yAxisId="ag"
                                        orientation="right"
                                        domain={agDomain}
                                        allowDataOverflow
                                        tickCount={6}
                                        axisLine={false}
                                        tickLine={false}
                                        tick={hasAbsoluteGamma ? { fill: metricColors.absoluteGamma, fontSize: 12 } : false}
                                        stroke={metricColors.absoluteGamma}
                                        width={64}
                                        tickFormatter={agTickFormatter}
                                    />
                                    {/* Counts axis (OI / Volume areas) and ratio axis (P/C lines):
                                        always mounted like the AG axis so toggling a metric never
                                        moves the plot, ticks only while something plots on them. */}
                                    <YAxis
                                        yAxisId="cnt"
                                        orientation="right"
                                        domain={cntDomain}
                                        allowDataOverflow
                                        tickCount={6}
                                        axisLine={false}
                                        tickLine={false}
                                        tick={countMetrics.length > 0 ? coloredTick((v) => countAxisColor(v, countMetrics, metricColors), cntTickFormatter) : false}
                                        stroke="#94a3b8"
                                        width={SECONDARY_AXIS_WIDTH}
                                        tickFormatter={cntTickFormatter}
                                    />
                                    <YAxis
                                        yAxisId="ratio"
                                        orientation="right"
                                        domain={ratioDomain}
                                        allowDataOverflow
                                        tickCount={6}
                                        axisLine={false}
                                        tickLine={false}
                                        tick={ratioMetrics.length > 0 ? coloredTick(() => ratioAxisColor(ratioMetrics, metricColors), (v) => fmt(v), { dx: -10, anchor: 'end' }) : false}
                                        stroke="#94a3b8"
                                        width={1}
                                        tickFormatter={(v: number) => fmt(v)}
                                    />
                                    {/* Hover tooltip: fades in and out like every other tooltip, no gliding. recharts
                                        hides its wrapper instantly (visibility) and slides it between positions (a
                                        transform transition), so the wrapper is forced visible and not animated
                                        (`isAnimationActive` off, `wrapperStyle`) and the CONTENT fades through its own
                                        opacity, keeping the last hovered row on screen while it fades out. */}
                                    <Tooltip
                                        cursor={{ fill: '#94a3b8', fillOpacity: 0.12 }}
                                        isAnimationActive={false}
                                        wrapperStyle={{ visibility: 'visible', pointerEvents: 'none' }}
                                        content={({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Record<string, number | null> }> }) => {
                                            const live = active && payload && payload[0] ? payload[0].payload : null;
                                            if (live) lastTooltipRow.current = live;
                                            const row = lastTooltipRow.current;
                                            if (!row) return null;
                                            return (
                                                <TooltipFade shown={!!live && tooltipArmed}>
                                                    <div className="text-slate-500 dark:text-slate-400">{tr('chain.strike')} {fmt(row.strike as number)}</div>
                                                    {metrics.map((m) => (
                                                        <div key={m} className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
                                                            <span
                                                                className="inline-block h-2 w-2 shrink-0 rounded-full"
                                                                style={{ background: m === 'netGex' ? colorFor('netGex', (row.netGex as number) >= 0 ? 'pos' : 'neg') : colorFor(m) }}
                                                                aria-hidden="true"
                                                            />
                                                            {metricLabelFull(m)}: {fmtMetricValue(m, metricValue(m, row))}
                                                        </div>
                                                    ))}
                                                </TooltipFade>
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
                                    {/* Plain horizontal zero-line label - unlike the Key Levels'
                                        diagonal below-axis labels (renderRotatedLevelLabel), this
                                        one line has nowhere else to collide: it sits on its own
                                        horizontal row at y=0, so a simple inline recharts `label`
                                        reads fine. `insideTopRight` keeps it clear of both the
                                        left-axis tick values (which right-align just outside the
                                        plot area, not inside it) and the Legend (moved to
                                        verticalAlign="top", see above - the label sits well below
                                        that, right at the zero line itself). */}
                                    {hasNetGex && (
                                        <ReferenceLine
                                            y={0}
                                            stroke="#94a3b8"
                                            label={{ value: tr('gex.chart.zeroLine'), position: 'insideTopRight', fill: '#94a3b8', fontSize: 10 }}
                                        />
                                    )}
                                    {hasNetGex && (
                                        <>
                                            <Bar dataKey="pos" stackId="net" name={`${tr('gex.metric.netGex')} (+)`} fill={metricColors.netGexPos} isAnimationActive={false} />
                                            <Bar dataKey="neg" stackId="net" name={`${tr('gex.metric.netGex')} (−)`} fill={metricColors.netGexNeg} isAnimationActive={false} />
                                        </>
                                    )}
                                    {/* OI / Volume: translucent areas like AG, each in its own
                                        color, on the shared counts axis, drawn above the Net GEX
                                        bars (zIndex 350, see the AG comment below). */}
                                    {countMetrics.map((m) => (
                                        <Area
                                            key={m}
                                            yAxisId="cnt"
                                            dataKey={barKeyFor(m)}
                                            name={metricLabel(m)}
                                            stroke={metricColors[m]}
                                            fill={metricColors[m]}
                                            fillOpacity={0.18}
                                            strokeWidth={1.5}
                                            zIndex={350}
                                            isAnimationActive={false}
                                        />
                                    ))}
                                    {/* Per-strike put/call ratios: one line each on the ratio
                                        axis, gaps where a strike has no call side. */}
                                    {ratioMetrics.map((m) => (
                                        <Line
                                            key={m}
                                            yAxisId="ratio"
                                            dataKey={`${m}Plot`}
                                            name={metricLabel(m)}
                                            type="linear"
                                            stroke={metricColors[m]}
                                            strokeWidth={1.5}
                                            dot={false}
                                            activeDot={false}
                                            connectNulls={false}
                                            zIndex={350}
                                            isAnimationActive={false}
                                        />
                                    ))}
                                    {/* AG (design decision, see agBase/agDomain above): rendered
                                        as a filled <Area>, not a <Bar> like every other metric -
                                        matches the reference tool's filled look - composed into
                                        this same <ComposedChart> container (see its own doc
                                        comment above for why Area specifically needs that
                                        container, not <BarChart>) and bound to its own
                                        `yAxisId="ag"` secondary axis rather than the shared
                                        primary one. */}
                                    {hasAbsoluteGamma && (
                                        <Area
                                            yAxisId="ag"
                                            dataKey="absGamma"
                                            name={metricLabelFull('absoluteGamma')}
                                            stroke={metricColors.absoluteGamma}
                                            fill={metricColors.absoluteGamma}
                                            fillOpacity={0.18}
                                            strokeWidth={2}
                                            // recharts layers: Area 100 < Bar 300 < Line/ReferenceLine
                                            // 400. 350 draws AG on top of the GEX bars but below the
                                            // level lines.
                                            zIndex={350}
                                            isAnimationActive={false}
                                        />
                                    )}
                                    {dragStart != null && dragEnd != null && dragStart !== dragEnd && (
                                        <ReferenceArea x1={dragStart} x2={dragEnd} strokeOpacity={0.3} fill="#6366f1" fillOpacity={0.15} />
                                    )}
                                    {/* All 7 toggleable Key Level keys (see ALL_LEVEL_KEYS above),
                                        gated independently on their own toggle (selectedLevels) and
                                        drawn in their own configured color (levelColors).
                                        `levels?.[key]` reads the same computed GexLevels field the
                                        sidebar's Key Levels card already shows (src/gex.ts, rule
                                        R1) - this never recomputes anything. Gamma Flip reads the
                                        single collapsed `levels.gammaFlip` field here, same generic
                                        path as every other level - no special-casing needed.

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
                                        level like the other 6, treating it identically is the
                                        simpler, more consistent choice, and its color (amber-500,
                                        GEX_LEVEL_COLORS.spot) already reads as visually distinct
                                        from every other level's color regardless of rotation. */}
                                    {(() => {
                                        // Every drawn label shares the exact same baseline y
                                        // (see renderRotatedLevelLabel's doc comment) - only each
                                        // level's own strike (x position) and the -45deg rotation
                                        // keep labels apart, no per-drawn-level vertical offset.
                                        // Levels that share a price (e.g. Net GEX+ and Gamma
                                        // Range High both at 778) are drawn as separate lines but
                                        // get ONE merged label on the first of them, so labels
                                        // never clash and every level stays visible.
                                        const drawn: LevelLabelItem[] = [];
                                        for (const key of ALL_LEVEL_KEYS) {
                                            if (!selectedLevels.includes(key)) continue;
                                            const value = levels?.[key];
                                            if (value == null) continue;
                                            drawn.push({ key, value, text: levelChartLabel(key), color: levelColors[key] });
                                        }
                                        const groups = groupLevelLabels(drawn);
                                        return drawn.map((item) => {
                                            const group = groups.find((g) => g.items[0].key === item.key);
                                            return (
                                                <ReferenceLine
                                                    key={item.key}
                                                    x={item.value}
                                                    stroke={item.color}
                                                    strokeDasharray="2 4"
                                                    label={group ? renderRotatedLevelLabel(group) : undefined}
                                                />
                                            );
                                        });
                                    })()}
                                </ComposedChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    {/* Guides under the chart, separated by " | " */}
                    {/* One line; when the screen is too narrow it is cut with an ellipsis and the
                        whole text shows in a tooltip on hover. */}
                    <Tip text={chartGuides} wrap wrapperClassName="mt-1 flex w-full min-w-0 justify-center">
                        <p className="min-w-0 truncate text-center text-xs text-slate-400">{chartGuides}</p>
                    </Tip>
                </section>

                {/* ---- Values: what every level means on its own strike. One table
                    anchored at the bottom whose centered first row "Values" is the
                    toggle: closed, only that row shows; open, the rows slide in below
                    it and the whole table grows upward from the bottom edge. The
                    state is remembered in localStorage. ---- */}
                {valueRows.length > 0 && (
                    <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60">
                        <button
                            type="button"
                            aria-expanded={valuesOpen}
                            onClick={toggleValues}
                            className={'flex w-full items-center justify-center gap-2 rounded-lg px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 ' + HEADING_CLASS}
                        >
                            <span aria-hidden="true" className="text-xs">{valuesOpen ? '▼' : '▲'}</span>
                            {tr('gex.values.title')}
                        </button>
                        <div className={'grid transition-[grid-template-rows] duration-300 ease-out ' + (valuesOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                            <div className="overflow-hidden">
                                <div className="overflow-x-auto border-t border-slate-200 dark:border-slate-700">
                                    <table className="w-full whitespace-nowrap text-sm tabular-nums">
                                    <thead>
                                        <tr className="border-b border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                                            <th className="px-3 py-1.5 text-left font-medium">{tr('gex.values.level')}</th>
                                            <th className="px-3 py-1.5 text-right font-medium">{tr('gex.values.strike')}</th>
                                            <th className="px-3 py-1.5 text-right font-medium">{tr('gex.metric.netGex')}</th>
                                            <th className="px-3 py-1.5 text-right font-medium">{tr('gex.metric.absoluteGamma')}</th>
                                            <th className="px-3 py-1.5 text-right font-medium">{tr('gex.metric.callOi')}</th>
                                            <th className="px-3 py-1.5 text-right font-medium">{tr('gex.metric.putOi')}</th>
                                            <th className="px-3 py-1.5 text-right font-medium">{tr('gex.metric.callVolume')}</th>
                                            <th className="px-3 py-1.5 text-right font-medium">{tr('gex.metric.putVolume')}</th>
                                            <th className="px-3 py-1.5 text-right font-medium">{tr('gex.metric.pcRatioOi')}</th>
                                            <th className="px-3 py-1.5 text-right font-medium">{tr('gex.metric.pcRatioVolume')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {valueRows.map((r) => (
                                            <tr key={r.key} className="border-b border-slate-100 dark:border-slate-700/50 last:border-0 text-slate-800 dark:text-slate-100">
                                                <td className="px-3 py-0.5 text-left">
                                                    <span className="flex items-center gap-2">
                                                        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: levelColors[r.key] }} aria-hidden="true" />
                                                        {r.label}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-0.5 text-right" title={r.exact ? undefined : tr('gex.values.nearest')}>
                                                    {fmt(r.point.strike)}{r.exact ? '' : ' ≈'}
                                                </td>
                                                <td className={'px-3 py-0.5 text-right ' + (r.point.netGex > 0 ? 'text-green-600 dark:text-green-400' : r.point.netGex < 0 ? 'text-red-600 dark:text-red-400' : '')}>{fmtSignedCompact(r.point.netGex)}</td>
                                                <td className="px-3 py-0.5 text-right">{fmtCompact(r.point.absGamma)}</td>
                                                <td className="px-3 py-0.5 text-right">{fmtInt(r.point.callOi)}</td>
                                                <td className="px-3 py-0.5 text-right">{fmtInt(r.point.putOi)}</td>
                                                <td className="px-3 py-0.5 text-right">{fmtInt(r.point.callVolume)}</td>
                                                <td className="px-3 py-0.5 text-right">{fmtInt(r.point.putVolume)}</td>
                                                <td className="px-3 py-0.5 text-right">{r.pc.byOi != null ? fmt(r.pc.byOi) : na}</td>
                                                <td className="px-3 py-0.5 text-right">{r.pc.byVolume != null ? fmt(r.pc.byVolume) : na}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            </div>
                        </div>
                    </section>
                )}
                </div>
            </div>
        </main>
    );
};
