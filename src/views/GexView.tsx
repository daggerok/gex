// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useMemo, useState } from 'react';
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

/** GexView.tsx's own toggleable-level key: every GexLevelKey except `spot`
 *  (always drawn, never toggleable) and the legacy collapsed `gammaFlip`
 *  (ChartView.tsx-only - see gex-colors.ts's GexLevelKey doc comment; this
 *  view reads gammaFlipPos/gammaFlipNeg directly and never selects it). */
type ToggleableLevelKey = Exclude<GexLevelKey, 'spot' | 'gammaFlip'>;

/** The 7 toggleable Key Levels (everything in GexLevels except `spot`/legacy
 *  `gammaFlip` - see ToggleableLevelKey above; also gex-colors.ts's
 *  LevelColorSet). `gammaFlipPos`/`gammaFlipNeg` each carry their own
 *  selection + color state independently (see the `selectedLevels`/
 *  `levelColors` comment below) even though the toggle/color panel usually
 *  renders them as a single combined "Gamma Flip" entry - see
 *  `gammaFlipPanelKeys` below. */
const ALL_LEVEL_KEYS: ToggleableLevelKey[] = ['callWall', 'callWall2', 'gammaFlipPos', 'gammaFlipNeg', 'putWall', 'putWall2', 'maxPain'];

/** i18n key for each non-gamma-flip level's sidebar/toggle-panel label and
 *  <ReferenceLine> chart label. Gamma Flip is handled separately (see
 *  `levelLabel`/`levelChartLabel` below) since its label is adaptive:
 *  plain "Gamma Flip" when only one of gammaFlipPos/gammaFlipNeg is non-null
 *  for the current data, "Gamma Flip +"/"Gamma Flip -" when both are. */
const LEVEL_LABEL_KEY: Record<Exclude<ToggleableLevelKey, 'gammaFlipPos' | 'gammaFlipNeg'>, string> = {
    callWall: 'gex.level.callWall',
    callWall2: 'gex.level.resistance2',
    putWall: 'gex.level.putWall',
    putWall2: 'gex.level.support2',
    maxPain: 'gex.level.maxPain',
};

/** Same as LEVEL_LABEL_KEY but for the <ReferenceLine> label on the chart
 *  (distinct from gex.level.* - the sidebar/toggle-panel text labels - so the
 *  two can read differently: the chart line stays short even when the
 *  sidebar label carries an "(R1)"/"(S1)" suffix). */
const LEVEL_CHART_LABEL_KEY: Record<Exclude<ToggleableLevelKey, 'gammaFlipPos' | 'gammaFlipNeg'>, string> = {
    callWall: 'gex.chart.callWall',
    callWall2: 'gex.chart.resistance2',
    putWall: 'gex.chart.putWall',
    putWall2: 'gex.chart.support2',
    maxPain: 'gex.chart.maxPain',
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
    // a valid (if unusual) choice, and Reset always brings all 6 back.
    const [selectedLevels, setSelectedLevels] = useState<Array<ToggleableLevelKey>>(() => [...ALL_LEVEL_KEYS]);
    const [levelColors, setLevelColorsState] = useState<LevelColorSet>(() => loadLevelColors());
    const setLevelColor = (key: ToggleableLevelKey, value: string) => {
        setLevelColorsState((prev) => {
            const next = { ...prev, [key]: value };
            saveLevelColors(next);
            return next;
        });
    };
    const resetLevelsPanel = () => {
        setSelectedLevels([...ALL_LEVEL_KEYS]);
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
    const levelPanelKeys: Array<ToggleableLevelKey> = ['callWall', 'callWall2', ...gammaFlipPanelKeys, 'putWall', 'putWall2', 'maxPain'];

    const levelLabel = (key: ToggleableLevelKey): string => {
        if (key === 'gammaFlipPos' || key === 'gammaFlipNeg') {
            return bothGammaFlip ? tr(key === 'gammaFlipPos' ? 'gex.level.gammaFlipPos' : 'gex.level.gammaFlipNeg') : tr('gex.level.gammaFlip');
        }
        return tr(LEVEL_LABEL_KEY[key]);
    };
    const levelChartLabel = (key: ToggleableLevelKey): string => {
        if (key === 'gammaFlipPos' || key === 'gammaFlipNeg') {
            return bothGammaFlip ? tr(key === 'gammaFlipPos' ? 'gex.chart.gammaFlipPos' : 'gex.chart.gammaFlipNeg') : tr('gex.chart.gammaFlip');
        }
        return tr(LEVEL_CHART_LABEL_KEY[key]);
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
    // row is `optional` (unlike callWall2/putWall2): even with no data at all
    // it still shows one placeholder "Gamma Flip" row reading "-", same as
    // callWall/putWall/maxPain already do.
    const keyLevels: Array<{ key: ToggleableLevelKey; label: string; value: number | null; optional?: boolean }> = [
        { key: 'callWall', label: levelLabel('callWall'), value: levels?.callWall ?? null },
        { key: 'callWall2', label: levelLabel('callWall2'), value: levels?.callWall2 ?? null, optional: true },
        ...gammaFlipPanelKeys.map((key) => ({ key, label: levelLabel(key), value: levels?.[key] ?? null })),
        { key: 'putWall', label: levelLabel('putWall'), value: levels?.putWall ?? null },
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
                match the other's height. ---- */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className={box + ' grow shrink basis-[460px] min-w-[260px] max-w-[670px]'} role="group" aria-label={tr('gex.metric.label')}>
                    <span className="text-xs text-slate-400">{tr('gex.metric.label')}</span>
                    <div className="themed-scroll flex items-center gap-2 overflow-x-auto">
                        {GEX_METRICS.map((m) => {
                            const on = metrics.includes(m);
                            return (
                                <div key={m} className="flex shrink-0 items-center gap-1">
                                    <button
                                        type="button"
                                        // Independently togglable (not radio buttons); the last
                                        // remaining selected metric can't be turned off, so the
                                        // chart is never empty.
                                        onClick={() => setMetrics(on ? (metrics.length > 1 ? metrics.filter((x) => x !== m) : metrics) : [...metrics, m])}
                                        aria-pressed={on}
                                        className={'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ' + (on ? ax.chipActive : ax.chipIdle)}
                                    >
                                        {tr('gex.metric.' + m)}
                                    </button>
                                    {/* Per-metric bar color pickers. Net GEX needs two (its
                                        signed pos/neg stacked halves); the 4 OI/Volume metrics
                                        get one each. Dependency-free <input type="color">,
                                        always visible (not gated on `on`) so a color can be
                                        set up before toggling the metric on. */}
                                    {m === 'netGex' ? (
                                        <>
                                            <input
                                                type="color"
                                                value={metricColors.netGexPos}
                                                onChange={(e) => setMetricColor('netGexPos', e.target.value)}
                                                title={tr('gex.metric.colorNetGexPos')}
                                                aria-label={tr('gex.metric.colorNetGexPos')}
                                                className="h-5 w-5 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700"
                                            />
                                            <input
                                                type="color"
                                                value={metricColors.netGexNeg}
                                                onChange={(e) => setMetricColor('netGexNeg', e.target.value)}
                                                title={tr('gex.metric.colorNetGexNeg')}
                                                aria-label={tr('gex.metric.colorNetGexNeg')}
                                                className="h-5 w-5 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700"
                                            />
                                        </>
                                    ) : (
                                        <input
                                            type="color"
                                            value={metricColors[m]}
                                            onChange={(e) => setMetricColor(m, e.target.value)}
                                            title={tr('gex.metric.color', { metric: metricLabel(m) })}
                                            aria-label={tr('gex.metric.color', { metric: metricLabel(m) })}
                                            className="h-5 w-5 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700"
                                        />
                                    )}
                                </div>
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
                <div className={box + ' grow shrink basis-[600px] min-w-[300px] max-w-[860px]'} role="group" aria-label={tr('gex.sidebar.keyLevels')}>
                    <span className="text-xs text-slate-400">{tr('gex.sidebar.keyLevels')}</span>
                    <div className="themed-scroll flex items-center gap-2 overflow-x-auto">
                        {levelPanelKeys.map((key) => {
                            const on = selectedLevels.includes(key);
                            const label = levelLabel(key);
                            return (
                                <div key={key} className="flex shrink-0 items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedLevels(on ? selectedLevels.filter((x) => x !== key) : [...selectedLevels, key])}
                                        aria-pressed={on}
                                        className={'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ' + (on ? ax.chipActive : ax.chipIdle)}
                                    >
                                        {label}
                                    </button>
                                    <input
                                        type="color"
                                        value={levelColors[key]}
                                        onChange={(e) => setLevelColor(key, e.target.value)}
                                        title={tr('gex.level.color', { level: label })}
                                        aria-label={tr('gex.level.color', { level: label })}
                                        className="h-5 w-5 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700"
                                    />
                                </div>
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

                <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-slate-900 dark:text-slate-50">{symbol}</span>
                    {effSpot != null && (
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                            {tr('spot.label')} <span className="font-semibold text-slate-800 dark:text-slate-200">${fmt(effSpot)}</span>
                            {effSpotIsEstimated && <span className="ml-1 text-[11px] text-amber-500">{tr('spot.estimated')}</span>}
                        </span>
                    )}
                    <span className="text-xs text-slate-400">{tr('spot.delayed', { provider: provider.label.split(' ')[0] })}</span>
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
                        {keyLevels
                            .filter((l) => !(l.optional && l.value == null))
                            .map((l) => (
                                <Row key={l.key} label={l.label} value={l.value != null ? fmt(l.value) : na} dot={GEX_LEVEL_COLORS[l.key].dot} />
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
                                    margin={{ top: 24, right: 16, bottom: 8, left: 8 }}
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
                                    <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
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
                                    {/* All 7 toggleable Key Level keys (gammaFlipPos/gammaFlipNeg
                                        included independently - see ALL_LEVEL_KEYS above), gated
                                        independently on their own toggle (selectedLevels) and drawn
                                        in their own configured color (levelColors). `levels?.[key]`
                                        reads the same computed GexLevels field the sidebar's Key
                                        Levels card already shows (src/gex.ts, rule R1) - this never
                                        recomputes anything. */}
                                    {ALL_LEVEL_KEYS.map((key) => {
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
                                                label={{
                                                    value: levelChartLabel(key),
                                                    position: 'insideTopRight',
                                                    fill: color,
                                                    fontSize: 10,
                                                    dy: 14 * (ALL_LEVEL_KEYS.indexOf(key) + 1),
                                                }}
                                            />
                                        );
                                    })}
                                    {effSpot != null && (
                                        <ReferenceLine
                                            x={effSpot}
                                            stroke={GEX_LEVEL_COLORS.spot.hex}
                                            strokeWidth={1.5}
                                            strokeDasharray="4 3"
                                            label={{ value: tr('gex.chart.spot', { price: fmt(effSpot) }), position: 'insideTopRight', fill: GEX_LEVEL_COLORS.spot.hex, fontSize: 11 }}
                                        />
                                    )}
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
};
