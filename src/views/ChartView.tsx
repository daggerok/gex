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
import { CUSTOM_LEVEL_COLOR, GEX_LEVEL_COLORS, type GexLevelKey } from '../gex-colors';
import { isApplePlatform, nearestStrike, nextLevelName, roundPrice } from '../custom-levels';
import { useCustomLevels } from '../use-custom-levels';
import { CustomLevelEditor, type LevelDraft } from '../components/CustomLevelEditor';
import { HelpButton } from '../components/HelpButton';
import { useI18n } from '../i18n';
import { DEFAULT_CHART_INTERVAL, loadOhlc } from '../providers/chart';
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

/** Platform of the viewer, read once. */
const APPLE = isApplePlatform();

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
    /** Strikes of the loaded chain: a click or a drag puts a custom level on the nearest one, never between two. */
    strikes?: readonly number[];
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

export const ChartView: React.FC<ChartViewProps> = ({ settings, symbol, levels, isFuturesPriced, levelExpCount, range, setRange, strikes = [] }) => {
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
    // Custom (user) levels: their price lines, prices for the autoscale and the drag in progress.
    const customLinesRef = useRef<IPriceLine[]>([]);
    const customPricesRef = useRef<number[]>([]);
    const dragRef = useRef<string | null>(null);

    // ---- Custom levels (right click adds, drag moves, shared with the GEX tab) ----
    const [customLevels, setCustomLevels] = useCustomLevels(symbol);
    const customRef = useRef(customLevels);
    customRef.current = customLevels;
    const strikesRef = useRef(strikes);
    strikesRef.current = strikes;
    /** A price from the chart as a level price: the nearest strike, or cents when there are no strikes. */
    const snap = (price: number) => nearestStrike(price, strikesRef.current) ?? roundPrice(price);
    const setCustomRef = useRef(setCustomLevels);
    setCustomRef.current = setCustomLevels;
    const [draft, setDraft] = useState<LevelDraft | null>(null);

    // ---- OHLC fetch (symbol; always LOAD_RANGE of daily bars, the range buttons only change the visible part) ----
    const fetchKey = `${symbol}|${LOAD_RANGE}|${settings.proxyBase}|${settings.providerId}`;
    const [state, setState] = useState<FetchState>({ key: '', status: 'loading' });
    useEffect(() => {
        if (!symbol) return;
        const ac = new AbortController();
        setState({ key: fetchKey, status: 'loading' });
        loadOhlc(symbol, { proxyBase: settings.proxyBase, signal: ac.signal }, { range: LOAD_RANGE, interval: DEFAULT_CHART_INTERVAL }, settings.providerId === 'static')
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
                for (const p of [...levelPricesRef.current, ...customPricesRef.current]) {
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

    // ---- Custom level price lines ----
    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;
        for (const line of customLinesRef.current) series.removePriceLine(line);
        customLinesRef.current = customLevels.map((c) => series.createPriceLine({
            price: c.price,
            color: CUSTOM_LEVEL_COLOR.hex,
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: c.name,
        }));
        customPricesRef.current = customLevels.map((c) => c.price);
        if (!dragRef.current) chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
    }, [customLevels, hasSymbol]);

    // A draft belongs to one symbol
    useEffect(() => { setDraft(null); }, [symbol]);

    // ---- Right click adds a level, a left-button drag on one moves it ----
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const HIT_PX = 6;
        /** Pointer position inside the plot area (not on the price or time axis), or null. */
        const plotPoint = (e: MouseEvent) => {
            const chart = chartRef.current;
            if (!chart) return null;
            const rect = el.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const pane = chart.paneSize();
            return x >= 0 && y >= 0 && x <= pane.width && y <= pane.height ? { x, y } : null;
        };
        const levelAt = (y: number) => {
            const series = seriesRef.current;
            if (!series) return null;
            let best: { id: string; dist: number } | null = null;
            for (const c of customRef.current) {
                const cy = series.priceToCoordinate(c.price);
                if (cy == null) continue;
                const dist = Math.abs(cy - y);
                if (dist <= HIT_PX && (!best || dist < best.dist)) best = { id: c.id, dist };
            }
            return best?.id ?? null;
        };
        /**
         * Opens the editor at the pointer (a new level, or the existing one when the pointer is on it). Used by a right
         * click, a two-finger click on a trackpad (both arrive as `contextmenu`) and Ctrl+click on macOS (handled in
         * onDown, see there). Returns true when it did, so the caller can stop the browser's own menu.
         */
        const openEditorAt = (e: MouseEvent): boolean => {
            const pt = plotPoint(e);
            const price = pt && seriesRef.current ? seriesRef.current.coordinateToPrice(pt.y) : null;
            if (!pt || price == null || !Number.isFinite(price)) return false;
            // Right click on an existing custom level edits its name instead of adding a new one
            const hitId = levelAt(pt.y);
            const hit = hitId ? customRef.current.find((c) => c.id === hitId) : undefined;
            if (hit) {
                setDraft({ x: pt.x, y: pt.y, price: hit.price, name: hit.name, editId: hit.id });
                return true;
            }
            setDraft({ x: pt.x, y: pt.y, price: snap(price), name: nextLevelName(customRef.current, tr('chart.custom.defaultName')) });
            return true;
        };
        const onContextMenu = (e: MouseEvent) => {
            if (openEditorAt(e)) e.preventDefault();
        };
        const onDown = (e: MouseEvent) => {
            // Ctrl+click is the secondary click on macOS: the browser sends a left-button mousedown with Ctrl held, and its own
            // menu opens right after. Handle it here and suppress that menu, instead of relying on the `contextmenu` event.
            if (e.button === 0 && e.ctrlKey && isApplePlatform()) {
                if (openEditorAt(e)) { e.preventDefault(); e.stopPropagation(); }
                return;
            }
            if (e.button !== 0) return;
            const pt = plotPoint(e);
            const id = pt ? levelAt(pt.y) : null;
            if (!id) return;
            // Keep the chart from panning while a level is dragged
            e.preventDefault();
            e.stopPropagation();
            dragRef.current = id;
            el.style.cursor = 'ns-resize';
            const move = (ev: MouseEvent) => {
                const series = seriesRef.current;
                if (!series || !dragRef.current) return;
                const y = Math.min(Math.max(ev.clientY - el.getBoundingClientRect().top, 0), chartRef.current?.paneSize().height ?? 0);
                const price = series.coordinateToPrice(y);
                if (price == null || !Number.isFinite(price)) return;
                const rounded = snap(price);
                setCustomRef.current(customRef.current.map((c) => (c.id === dragRef.current ? { ...c, price: rounded } : c)), false);
            };
            const up = () => {
                window.removeEventListener('mousemove', move);
                window.removeEventListener('mouseup', up);
                dragRef.current = null;
                el.style.cursor = '';
                // drop: save the final position
                setCustomRef.current(customRef.current, true);
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
        };
        const onHover = (e: MouseEvent) => {
            if (dragRef.current) return;
            const pt = plotPoint(e);
            el.style.cursor = pt && levelAt(pt.y) ? 'ns-resize' : '';
        };
        el.addEventListener('contextmenu', onContextMenu);
        el.addEventListener('mousedown', onDown, true);
        el.addEventListener('mousemove', onHover);
        return () => {
            el.removeEventListener('contextmenu', onContextMenu);
            el.removeEventListener('mousedown', onDown, true);
            el.removeEventListener('mousemove', onHover);
        };
    }, [hasSymbol, tr]);

    const commitDraft = (name: string) => {
        if (!draft) return;
        if (draft.editId) {
            setCustomLevels(customLevels.map((c) => (c.id === draft.editId ? { ...c, name } : c)));
            setDraft(null);
            return;
        }
        const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random();
        setCustomLevels([...customLevels, { id, name, price: draft.price }]);
        setDraft(null);
    };

    const removeDraftLevel = () => {
        if (!draft?.editId) return;
        setCustomLevels(customLevels.filter((c) => c.id !== draft.editId));
        setDraft(null);
    };

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
                    <HelpButton label={tr('chart.help.label')} paragraphs={[tr('chart.help.addLevel'), tr('chart.help.editLevel'), tr('chart.help.moveLevel'), tr('chart.help.removeLevel')]} align="left" />
                </div>
            </div>

            {/* ---- Level legend (same labels/colors as the GEX tab's Key Levels) ---- */}
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-400">{tr('chart.levels.source', { count: levelExpCount })}</span>
                <span className="text-slate-400">{tr('chart.custom.hint')}</span>
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
                {customLevels.map((c) => (
                    <span key={c.id} className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${CUSTOM_LEVEL_COLOR.dot}`} aria-hidden="true" />
                        {c.name}
                        <span className="font-medium tabular-nums text-slate-800 dark:text-slate-100">{fmt(c.price)}</span>
                        <button
                            type="button"
                            onClick={() => setCustomLevels(customLevels.filter((x) => x.id !== c.id))}
                            aria-label={tr('chart.custom.remove', { name: c.name })}
                            title={tr('chart.custom.remove', { name: c.name })}
                            className="rounded px-1 leading-none text-slate-400 hover:text-red-500"
                        >
                            ×
                        </button>
                    </span>
                ))}
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
                <div className="relative">
                    <div ref={containerRef} className="h-[420px] lg:h-[calc(100dvh-270px)] lg:min-h-[420px]" />
                    {draft && (
                        <CustomLevelEditor
                            key={`${draft.x}:${draft.y}`}
                            draft={draft}
                            boxWidth={containerRef.current?.clientWidth ?? 0}
                            onSave={commitDraft}
                            onCancel={() => setDraft(null)}
                            onDelete={removeDraftLevel}
                        />
                    )}
                </div>
                {overlay && (
                    <div className="absolute inset-2 grid place-items-center whitespace-pre-line rounded-lg bg-white/80 dark:bg-slate-900/80 px-4 text-center text-sm text-slate-500 dark:text-slate-400">
                        {overlay}
                    </div>
                )}
            </section>
        </main>
    );
};
