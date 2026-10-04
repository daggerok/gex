// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useMemo } from 'react';
// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ExpirationChips } from '../components/ExpirationChips';
import { computeGexProfile, computeOiVolumeTotals, computePCRatio } from '../gex';
import { GEX_BAR_COLORS, GEX_LEVEL_COLORS, type GexLevelKey } from '../gex-colors';
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
    /** Expirations selectable on this tab (keys of quotesByExp, ascending). */
    expirations: string[];
    /** This tab's OWN expiration selection (independent of Desk). */
    selectedExps: string[];
    setSelectedExps: (exps: string[]) => void;
    metric: GexMetric;
    setMetric: (metric: GexMetric) => void;
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
    settings, provider, symbol, spot: effSpot, spotIsEstimated: effSpotIsEstimated, quotes, levels, isFuturesPriced, expirations,
    selectedExps, setSelectedExps, metric, setMetric,
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
        const rows = visible.map((p) => ({
            strike: p.strike,
            pos: Math.max(p.netGex, 0),
            neg: Math.min(p.netGex, 0),
            value: p[metric],
            point: p,
        }));
        return { rows, domain: [minK - pad, maxK + pad] as [number, number] };
    }, [profile, effSpot, levels, metric]);

    const metricColor = metric === 'callOi' || metric === 'callVolume' ? GEX_BAR_COLORS.call : GEX_BAR_COLORS.put;
    const metricLabel = tr('gex.metric.' + metric);
    const fmtMetric = (v: number) => (metric === 'netGex' ? `${fmtSignedCompact(v)} ${tr('gex.unit')}` : fmtInt(v));

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

    if (!symbol || expirations.length === 0) {
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
            {/* ---- Controls: expiration chips (own selection) + metric toggle ---- */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className={box}>
                    <ExpirationChips
                        expirations={expirations}
                        selected={selectedExps}
                        onToggle={(exp) => setSelectedExps(selectedExps.includes(exp) ? selectedExps.filter((e) => e !== exp) : [...selectedExps, exp])}
                        onSetAll={setSelectedExps}
                        colorTheme={settings.colorTheme}
                    />
                </div>
                <div className={box} role="group" aria-label={tr('gex.metric.label')}>
                    <span className="text-xs text-slate-400">{tr('gex.metric.label')}</span>
                    <div className="themed-scroll flex items-center gap-1 overflow-x-auto">
                        {GEX_METRICS.map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setMetric(m)}
                                aria-pressed={metric === m}
                                className={'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ' + (metric === m ? ax.chipActive : ax.chipIdle)}
                            >
                                {tr('gex.metric.' + m)}
                            </button>
                        ))}
                    </div>
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
                    <h3 className="mb-2 text-xs text-slate-500 dark:text-slate-400">{tr('gex.chart.title', { metric: metricLabel })}</h3>
                    <div className="h-[360px] lg:h-[calc(100dvh-304px)] lg:min-h-[420px]">
                        {chartMessage || !chart ? (
                            <div className={emptyBox}>{chartMessage}</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chart.rows} margin={{ top: 24, right: 16, bottom: 8, left: 8 }} stackOffset="sign" barCategoryGap="15%">
                                    <CartesianGrid stroke="#94a3b8" strokeOpacity={0.15} vertical={false} />
                                    <XAxis
                                        dataKey="strike"
                                        type="number"
                                        domain={chart.domain}
                                        allowDataOverflow
                                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                                        stroke="#94a3b8"
                                        tickFormatter={(v: number) => fmt(v, v % 1 === 0 ? 0 : 1)}
                                    />
                                    <YAxis
                                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                                        stroke="#94a3b8"
                                        width={64}
                                        tickFormatter={(v: number) => (metric === 'netGex' ? fmtSignedCompact(v) : fmtCompact(v))}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#94a3b8', fillOpacity: 0.12 }}
                                        content={({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
                                            const row = active && payload && payload[0] ? payload[0].payload as { strike: number; value: number } | undefined : null;
                                            if (!row) return null;
                                            return (
                                                <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs shadow">
                                                    <div className="text-slate-500 dark:text-slate-400">{tr('chain.strike')} {fmt(row.strike)}</div>
                                                    <div className="font-semibold text-slate-800 dark:text-slate-100">{metricLabel}: {fmtMetric(row.value)}</div>
                                                </div>
                                            );
                                        }}
                                    />
                                    {metric === 'netGex' && <ReferenceLine y={0} stroke="#94a3b8" />}
                                    {metric === 'netGex' ? (
                                        <>
                                            <Bar dataKey="pos" stackId="net" fill={GEX_BAR_COLORS.call} isAnimationActive={false} />
                                            <Bar dataKey="neg" stackId="net" fill={GEX_BAR_COLORS.put} isAnimationActive={false} />
                                        </>
                                    ) : (
                                        <Bar dataKey="value" fill={metricColor} isAnimationActive={false} />
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
