// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useRef, useState } from 'react';
import {
    CandlestickSeries,
    ColorType,
    createChart,
    LineStyle,
    type AutoscaleInfo,
    type CandlestickData,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type UTCTimestamp,
    // @ts-ignore -- resolved by the Parcel/Bun build toolchain
} from 'lightweight-charts';
import { GEX_LEVEL_COLORS, type GexLevelKey } from '../gex-colors';
import { useI18n } from '../i18n';
import { DEFAULT_CHART_INTERVAL, fetchOhlc } from '../providers/chart';
import { accentOf } from '../theme';
import type { GexLevels, OhlcBar, Settings } from '../types';
import { fmt } from '../utils';
import { CHART_RANGES, LOAD_RANGE, visibleRangeFor, type ChartRange } from './chart-range';

// ============================================================================
// CHART VIEW (Tab 3) - plan section 8.2 (`agentic-workspace docs/repos/gex/spec-gex-app.md`). Daily candles of the loaded symbol (OHLC from the companion
// proxy's /api/chart via providers/chart.ts) with the SAME GexLevels object
// the GEX tab renders, drawn as horizontal price lines. This view never
// computes levels (rule R1): App computes them once (useGexLevels) and passes
// them in. lightweight-charts is used only here (plan section 9).
// ============================================================================

/**
 * Levels within this fraction beyond the candle range are pulled into the
 * price scale so their lines are visible. A level further away (e.g. a far
 * OTM wall on a whole-chain selection) would squash the candles, so it stays
 * off-scale (still listed in the legend; drag the price axis to see it).
 */
const LEVEL_AUTOSCALE_PAD_PCT = 0.25;

/** Empty share of the pane above the highest and below the lowest value on the price scale (library default is 0.2 / 0.1). */
const PRICE_SCALE_MARGINS = { top: 0.04, bottom: 0.04 };

/** Price-line order and labels match the GEX tab's Key Levels card. */
const LEVEL_LINES: Array<{ key: Exclude<GexLevelKey, 'spot'>; label: string; secondary?: boolean }> = [
    { key: 'maxNetGex', label: 'gex.level.maxNetGex' },
    { key: 'netGexPlus', label: 'gex.level.netGexPlus', secondary: true },
    { key: 'gammaFlip', label: 'gex.level.gammaFlip' },
    { key: 'minNetGex', label: 'gex.level.minNetGex' },
    { key: 'netGexMinus', label: 'gex.level.netGexMinus', secondary: true },
    { key: 'sumNetGexPlus', label: 'gex.level.sumNetGexPlus', secondary: true },
    { key: 'sumNetGexMinus', label: 'gex.level.sumNetGexMinus', secondary: true },
    { key: 'maxPain', label: 'gex.level.maxPain' },
];

export interface ChartViewProps {
    settings: Settings;
    /** Symbol of the loaded chain ('' when nothing is loaded). */
    symbol: string;
    /** Shared GexLevels computed ONCE in App (same object the GEX tab renders). */
    levels: GexLevels | null;
    /** True when `symbol` is a futures-priced volatility index (VIX, VXN).
     *  When `levels` is also null, the legend shows a "not supported" message
     *  instead of "none" (toggle off, or Black-76 pricing failed for every
     *  selected quote). When `levels` is present (pricing succeeded), the
     *  legend instead adds a small note that the lines are futures-terms-
     *  based. The candlestick price chart itself is unaffected either way -
     *  real spot price data, not GEX-model output. */
    isFuturesPriced: boolean;
    /** Number of expirations the levels were computed from (GEX tab selection). */
    levelExpCount: number;
    range: ChartRange;
    setRange: (range: ChartRange) => void;
}

type FetchState =
    | { key: string; status: 'loading' }
    | { key: string; status: 'ok'; bars: OhlcBar[] }
    | { key: string; status: 'error'; error: string };

/** Follow the `.dark` class useThemeController toggles on <html> (same as TabSwitcher). */
function useDarkClass(): boolean {
    const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
    useEffect(() => {
        const root = document.documentElement;
        const sync = () => setDark(root.classList.contains('dark'));
        sync();
        const obs = new MutationObserver(sync);
        obs.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, []);
    return dark;
}

/** Non-null level prices, in LEVEL_LINES order. */
function levelEntries(levels: GexLevels | null) {
    if (!levels) return [];
    return LEVEL_LINES.flatMap((l) => {
        const price = levels[l.key];
        return price != null && Number.isFinite(price) ? [{ ...l, price }] : [];
    });
}

export const ChartView: React.FC<ChartViewProps> = ({ settings, symbol, levels, isFuturesPriced, levelExpCount, range, setRange }) => {
    const { t: tr, lang } = useI18n();
    const ax = accentOf(settings.colorTheme);
    const dark = useDarkClass();

    const containerRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    // Handles of the price lines currently drawn; removed before redrawing so
    // stale lines never accumulate across ticker / level / range changes.
    const priceLinesRef = useRef<IPriceLine[]>([]);
    // Level prices the autoscale provider may pull into view (read lazily).
    const levelPricesRef = useRef<number[]>([]);

    // ---- OHLC fetch (symbol; always LOAD_RANGE of daily bars, the range buttons only change the visible part) ----
    const fetchKey = `${symbol}|${LOAD_RANGE}|${settings.proxyBase}`;
    const [state, setState] = useState<FetchState>({ key: '', status: 'loading' });
    useEffect(() => {
        if (!symbol) return;
        const ac = new AbortController();
        setState({ key: fetchKey, status: 'loading' });
        fetchOhlc(symbol, { proxyBase: settings.proxyBase, signal: ac.signal }, { range: LOAD_RANGE, interval: DEFAULT_CHART_INTERVAL })
            .then((bars) => { if (!ac.signal.aborted) setState({ key: fetchKey, status: 'ok', bars }); })
            .catch((e: unknown) => {
                if (ac.signal.aborted) return;
                setState({ key: fetchKey, status: 'error', error: e instanceof Error ? e.message : String(e) });
            });
        return () => ac.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchKey]);
    const current = state.key === fetchKey ? state : { key: fetchKey, status: 'loading' as const };
    const bars = current.status === 'ok' ? current.bars : null;

    // ---- Chart instance: created when the container mounts (first symbol), removed on unmount ----
    // The container only exists once a symbol is loaded, so the instance is
    // keyed on hasSymbol: opening this tab first and loading a ticker after
    // still creates the chart. Effects below list hasSymbol too, so they
    // re-apply onto a freshly created instance.
    const hasSymbol = symbol !== '';
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const chart = createChart(el, {
            autoSize: true,
            layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#94a3b8', fontSize: 11 },
            grid: { vertLines: { color: 'rgba(148, 163, 184, 0.15)' }, horzLines: { color: 'rgba(148, 163, 184, 0.15)' } },
            rightPriceScale: { borderColor: 'rgba(148, 163, 184, 0.4)', scaleMargins: PRICE_SCALE_MARGINS },
            timeScale: { borderColor: 'rgba(148, 163, 184, 0.4)' },
        });
        const series = chart.addSeries(CandlestickSeries, {
            autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
                const info = base();
                if (!info?.priceRange) return info;
                let { minValue, maxValue } = info.priceRange;
                const lo = minValue * (1 - LEVEL_AUTOSCALE_PAD_PCT);
                const hi = maxValue * (1 + LEVEL_AUTOSCALE_PAD_PCT);
                for (const p of levelPricesRef.current) {
                    if (p < lo || p > hi) continue;
                    minValue = Math.min(minValue, p);
                    maxValue = Math.max(maxValue, p);
                }
                return { ...info, priceRange: { minValue, maxValue } };
            },
        });
        chartRef.current = chart;
        seriesRef.current = series;
        return () => {
            priceLinesRef.current = [];
            seriesRef.current = null;
            chartRef.current = null;
            chart.remove();
        };
    }, [hasSymbol]);

    // ---- Theme + date locale follow the app ----
    useEffect(() => {
        chartRef.current?.applyOptions({
            layout: { textColor: dark ? '#94a3b8' : '#64748b' },
            localization: { locale: lang === 'ru' ? 'ru-RU' : 'en-US' },
        });
    }, [dark, lang, hasSymbol]);

    // ---- Candles ----
    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;
        const data: CandlestickData<UTCTimestamp>[] = (bars ?? []).map((b) => ({
            time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close,
        }));
        series.setData(data);
    }, [bars, hasSymbol]);

    // ---- Visible part: the chosen range of the loaded history (new data or a range click resets pan and zoom) ----
    useEffect(() => {
        if (!bars?.length) return;
        chartRef.current?.timeScale().setVisibleLogicalRange(visibleRangeFor(bars.map((b) => b.time), range));
    }, [bars, range, hasSymbol]);

    // ---- Level price lines: remove the previous set, then draw the new one ----
    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;
        for (const line of priceLinesRef.current) series.removePriceLine(line);
        const entries = levelEntries(levels);
        priceLinesRef.current = entries.map((l) => series.createPriceLine({
            price: l.price,
            color: GEX_LEVEL_COLORS[l.key].hex,
            lineWidth: l.secondary ? 1 : 2,
            lineStyle: l.secondary ? LineStyle.Dotted : LineStyle.Dashed,
            axisLabelVisible: true,
            title: tr(l.label),
        }));
        levelPricesRef.current = entries.map((l) => l.price);
        // Re-run autoscale so newly in-range levels are pulled into view.
        chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
    }, [levels, tr, hasSymbol]);

    const box = 'flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5';
    const emptyBox = 'grid h-full min-h-[240px] place-items-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 text-center text-sm text-slate-400';

    if (!symbol) {
        return (
            <main className="mx-auto w-full px-4 pt-4 lg:px-6">
                <div className={emptyBox}>{tr('chart.empty.noData')}</div>
            </main>
        );
    }

    const entries = levelEntries(levels);
    const overlay = current.status === 'loading'
        ? tr('chart.loading')
        : current.status === 'error'
            ? `${tr('chart.error', { error: current.error })}\n\n${tr('chart.proxyHint')}`
            : bars && bars.length === 0 ? tr('chart.empty.noBars', { symbol }) : null;

    return (
        <main className="mx-auto w-full px-4 pt-4 lg:px-6">
            {/* ---- Controls: range selector + symbol ---- */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className={box} role="group" aria-label={tr('chart.range.label')}>
                    <span className="text-xs text-slate-400">{tr('chart.range.label')}</span>
                    <div className="flex items-center gap-1">
                        {CHART_RANGES.map((r) => (
                            <button
                                key={r}
                                type="button"
                                onClick={() => setRange(r)}
                                aria-pressed={range === r}
                                className={'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ' + (range === r ? ax.chipActive : ax.chipIdle)}
                            >
                                {tr('chart.range.' + r)}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-slate-900 dark:text-slate-50">{symbol}</span>
                    <span className="text-xs text-slate-400">{tr('chart.interval')}</span>
                </div>
            </div>

            {/* ---- Level legend (same labels/colors as the GEX tab's Key Levels) ---- */}
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-400">{tr('chart.levels.source', { count: levelExpCount })}</span>
                {entries.length === 0 ? (
                    <span className="text-slate-400">
                        {isFuturesPriced ? tr('chart.levels.futuresPriced', { symbol }) : tr('chart.levels.none')}
                    </span>
                ) : isFuturesPriced && (
                    // Real levels for a futures-priced symbol (toggle on,
                    // pricing succeeded): a brief note that these lines are
                    // futures-terms-based (section 9), not spot-based.
                    <span className="text-slate-400">{tr('chart.levels.futuresPricedHint')}</span>
                )}
                {entries.map((l) => (
                    <span key={l.key} className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${GEX_LEVEL_COLORS[l.key].dot}`} aria-hidden="true" />
                        {tr(l.label)}
                        <span className="font-medium tabular-nums text-slate-800 dark:text-slate-100">{fmt(l.price)}</span>
                    </span>
                ))}
            </div>

            {/* ---- Chart (container always mounted so the instance survives refetches) ---- */}
            <section className="relative rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-2">
                <div ref={containerRef} className="h-[420px] lg:h-[calc(100dvh-270px)] lg:min-h-[420px]" />
                {overlay && (
                    <div className="absolute inset-2 grid place-items-center whitespace-pre-line rounded-lg bg-white/80 dark:bg-slate-900/80 px-4 text-center text-sm text-slate-500 dark:text-slate-400">
                        {overlay}
                    </div>
                )}
            </section>
        </main>
    );
};
