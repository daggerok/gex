// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useMemo, useState } from 'react';
// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import { Bar, BarChart, CartesianGrid, Legend, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { computeGexProfile, computeOiVolumeTotals, computePCRatio } from '../gex';
import {
    DEFAULT_METRIC_COLORS, GEX_LEVEL_COLORS, loadMetricColors, saveMetricColors, type GexLevelKey, type MetricColorSet,
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

/**
 * Display-only strike window around spot for the bar chart (not GEX math):
 * full chains (SPY: strikes from ~0.2x to ~2x spot) would squeeze the bars
 * that matter into a few pixels. The window is widened to always include the
 * call/put walls, and ignored when it would leave nothing to draw.
 */
const CHART_STRIKE_WINDOW_PCT = 0.15;

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

    // ---- Chart data (display only: windowing + splitting sign for colors) ----
    const chart = useMemo(() => {
        if (!profile.length) return null;
        let visible = profile;
        if (effSpot != null) {
            const lo = Math.min(effSpot * (1 - CHART_STRIKE_WINDOW_PCT), levels?.putWall ?? Infinity, levels?.callWall ?? Infinity);
            const hi = Math.max(effSpot * (1 + CHART_STRIKE_WINDOW_PCT), levels?.putWall ?? -Infinity, levels?.callWall ?? -Infinity);
            const inWindow = profile.filter((p) => p.strike >= lo && p.strike <= hi);
            if (inWindow.length) visible = inWindow;
        }
        let gap = Infinity;
        for (let i = 1; i < visible.length; i++) gap = Math.min(gap, visible[i].strike - visible[i - 1].strike);
        const pad = Number.isFinite(gap) && gap > 0 ? gap : Math.max(1, visible[0].strike * 0.01);
        const minK = Math.min(visible[0].strike, effSpot ?? Infinity);
        const maxK = Math.max(visible[visible.length - 1].strike, effSpot ?? -Infinity);
        // Every GexPoint field is carried through (not just the selected
        // metrics) so toggling metrics on/off never needs to recompute rows -
        // only which Bars/axes get rendered below changes.
        const rows = visible.map((p) => ({
            ...p,
            pos: Math.max(p.netGex, 0),
            neg: Math.min(p.netGex, 0),
        }));
        return { rows, domain: [minK - pad, maxK + pad] as [number, number] };
    }, [profile, effSpot, levels]);

    // ---- Multi-metric selection --------------------------------------------
    // netGex keeps its signed pos/neg stacked treatment; the 4 OI/Volume
    // metrics render as grouped (non-stacked) bars. All metrics now share one
    // Y axis (see "Chart axes + zoom" below) - when netGex is combined with
    // an OI/Volume metric, the OI/Volume bars will look small/flat next to
    // netGex's much larger dollar-gamma magnitude. That's an accepted,
    // explicit tradeoff, not something normalized away.
    const countMetrics = GEX_METRICS.filter((m) => m !== 'netGex' && metrics.includes(m)) as Array<Exclude<GexMetric, 'netGex'>>;
    const hasNetGex = metrics.includes('netGex');
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
    // netGex keeps its symmetric +/-max domain (same visual treatment as
    // before: zero sits in the middle, pos/neg bars scaled identically) -
    // when any OI/Volume metric is also selected, the domain's magnitude
    // grows to fit whichever of the two groups has the larger max, so the
    // OI/Volume bars (always >=0, drawn within the upper half of the same
    // axis) never get clipped. When netGex is combined with an OI/Volume
    // metric, the latter's bars will look small/flat next to netGex's much
    // larger dollar-gamma scale - an accepted tradeoff, not solved here via
    // normalization/log scales/a second axis.
    const yBase = useMemo((): [number, number] => {
        if (!chart) return [0, 1];
        let netGexAbsMax = 0;
        let countMax = 0;
        for (const row of chart.rows) {
            if (hasNetGex) netGexAbsMax = Math.max(netGexAbsMax, Math.abs(row.pos), Math.abs(row.neg));
            for (const m of countMetrics) countMax = Math.max(countMax, row[m] ?? 0);
        }
        if (!hasNetGex) return [0, countMax || 1];
        const max = Math.max(netGexAbsMax, countMax) || 1;
        return [-max, max];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chart, hasNetGex, countMetrics.join(',')]);

    const yDomain = scaleAroundZero(yBase, yZoomFactor);
    // Signed formatting only makes sense once the domain can actually go
    // negative (i.e. netGex is selected); OI/Volume-only domains start at 0.
    const yTickFormatter = (v: number) => (hasNetGex ? fmtSignedCompact(v) : fmtCompact(v));
    const xDomain = xZoom ?? chart?.domain ?? ([0, 1] as [number, number]);

    const keyLevels: Array<{ key: GexLevelKey; label: string; value: number | null; optional?: boolean }> = [
        { key: 'callWall', label: tr('gex.level.callWall'), value: levels?.callWall ?? null },
        { key: 'callWall2', label: tr('gex.level.resistance2'), value: levels?.callWall2 ?? null, optional: true },
        { key: 'gammaFlip', label: tr('gex.level.gammaFlip'), value: levels?.gammaFlip ?? null },
        { key: 'putWall', label: tr('gex.level.putWall'), value: levels?.putWall ?? null },
        { key: 'putWall2', label: tr('gex.level.support2'), value: levels?.putWall2 ?? null, optional: true },
        { key: 'maxPain', label: tr('gex.level.maxPain'), value: levels?.maxPain ?? null },
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
            {/* ---- Controls: metric toggle (expiration picker + Load now live
                in the shared panel in main.tsx, in the same row as the
                Desk/GEX/Chart tab pills) ---- */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className={box} role="group" aria-label={tr('gex.metric.label')}>
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
                                        <Bar key={m} dataKey={m} name={metricLabel(m)} fill={metricColors[m]} isAnimationActive={false} />
                                    ))}
                                    {dragStart != null && dragEnd != null && dragStart !== dragEnd && (
                                        <ReferenceArea x1={dragStart} x2={dragEnd} strokeOpacity={0.3} fill="#6366f1" fillOpacity={0.15} />
                                    )}
                                    {levels?.callWall != null && (
                                        <ReferenceLine
                                            x={levels.callWall}
                                            stroke={GEX_LEVEL_COLORS.callWall.hex}
                                            strokeDasharray="2 4"
                                            label={{ value: tr('gex.chart.callWall'), position: 'insideTopRight', fill: GEX_LEVEL_COLORS.callWall.hex, fontSize: 10, dy: 14 }}
                                        />
                                    )}
                                    {levels?.putWall != null && (
                                        <ReferenceLine
                                            x={levels.putWall}
                                            stroke={GEX_LEVEL_COLORS.putWall.hex}
                                            strokeDasharray="2 4"
                                            label={{ value: tr('gex.chart.putWall'), position: 'insideTopRight', fill: GEX_LEVEL_COLORS.putWall.hex, fontSize: 10, dy: 28 }}
                                        />
                                    )}
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
