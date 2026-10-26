/// <reference lib="esnext" />
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
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
} from 'lightweight-charts';
import { type PriceLevelKey } from '../gex-colors';
import { chartLabelsWithSigma } from '../level-labels';
import { ToolbarRow } from '../components/ToolbarRow';
import { useMetricColors, type GexMetric } from '../metric-prefs';
import { sigmaLines, sigmaMode, useLevelPrefs, zeroGexDisplay } from '../level-prefs';
import { PriceBand, RightSegments } from '../chart-primitives';
import { attachCrosshairMagnet } from '../crosshair-magnet';
import { defaultLevelName, isApplePlatform, levelColorOf, nearestStrike, proposeLevelColor, roundPrice } from '../custom-levels';
import { cutBarsAfter } from '../backtest/bars';
import { attachLongPress } from '../long-press';
import { useFullscreen } from '../use-fullscreen';
import { customLevelsLocked, useCustomLevels } from '../use-custom-levels';
import { CustomLevelEditor, type LevelDraft } from '../components/CustomLevelEditor';
import { ChartHeader } from '../components/ChartHeader';
import { FadePresence } from '../components/FadePresence';
import { useI18n } from '../i18n';
import { DEFAULT_CHART_INTERVAL, loadOhlc } from '../providers/chart';
import { accentOf, useDarkClass } from '../theme';
import type { GexLevels, OhlcBar, Settings } from '../types';
import { errorText, fmt } from '../utils';
import { loadChartViews, saveChartViews, withZoom, zoomFor, type ZoomMap } from '../chart-zoom-store';
import { fromStoredView, loadRangeFor, toStoredView, visibleRangeFor, type ChartRange } from './chart-range';

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
/**
 * The built-in level lines here are 1 px (owner 2026-10-25, Chart tab only; the GEX tab keeps its widths); Sigma
 * (`SIGMA_LINE_WIDTH`) and the user's custom levels (`CUSTOM_LINE_WIDTH`, owner: back to 2 px) are 2 px. The dash tells
 * the kinds apart too: the main levels are long dashes, the secondary ones dots, the custom levels solid.
 */
const LEVEL_LINE_WIDTH = 1;
const SIGMA_LINE_WIDTH = 2;
const CUSTOM_LINE_WIDTH = 2;
const LEVEL_LINES: Array<{ key: PriceLevelKey; label: string; secondary?: boolean }> = [
    { key: 'maxNetGex', label: 'gex.level.maxNetGex' },
    { key: 'netGexPlus', label: 'gex.level.netGexPlus', secondary: true },
    { key: 'gammaFlip', label: 'gex.level.gammaFlip' },
    { key: 'zeroGex', label: 'gex.level.zeroGex' },
    { key: 'minNetGex', label: 'gex.level.minNetGex' },
    { key: 'netGexMinus', label: 'gex.level.netGexMinus', secondary: true },
    { key: 'sumNetGexPlus', label: 'gex.level.sumNetGexPlus', secondary: true },
    { key: 'sumNetGexMinus', label: 'gex.level.sumNetGexMinus', secondary: true },
    { key: 'maxPain', label: 'gex.level.maxPain' },
    { key: 'maxAbsGamma', label: 'gex.level.maxAbsGamma', secondary: true },
    { key: 'spot', label: 'spot.label', secondary: true },
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
    /** The GEX metrics (the Metrics panel above the chart is the same as on the GEX tab). */
    metrics: GexMetric[];
    setMetrics: (metrics: GexMetric[]) => void;
    /** Strikes of the loaded chain: a click or a drag puts a custom level on the nearest one, never between two. */
    strikes?: readonly number[];
    /** Backtest: the archived day (`YYYY-MM-DD`). The candles stop at it and come from the cache files, the live proxy is off. null = live. */
    asOfDate?: string | null;
    /** The data source is live (the proxy was found, or a live provider is fixed): candles come from the proxy first, the
     *  cache is the fallback. False: only the cache, no request to the proxy (owner rule of thumb, 2026-10-25). */
    liveCandles?: boolean;
}

type FetchState =
    | { key: string; status: 'loading' }
    | { key: string; status: 'ok'; bars: OhlcBar[] }
    | { key: string; status: 'error'; error: unknown };

/** Non-null level prices, in LEVEL_LINES order. */
function levelEntries(levels: GexLevels | null) {
    if (!levels) return [];
    return LEVEL_LINES.flatMap((l) => {
        const price = levels[l.key];
        return price != null && Number.isFinite(price) ? [{ ...l, price }] : [];
    });
}

export const ChartView: React.FC<ChartViewProps> = ({ settings, symbol, levels, isFuturesPriced, levelExpCount, range, setRange, metrics, setMetrics, strikes = [], asOfDate = null, liveCandles = false }) => {
    const agEnabled = metrics.includes('absoluteGamma');
    const fs = useFullscreen();
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

    // Which levels are on and their colours: the Levels panel above the chart, shared with the GEX tab
    const { selected: selectedLevels, colors: levelColors } = useLevelPrefs();
    // Zero GEX as an area (the switch in its Levels chip): a band from the zone's low to its high strike (PriceBand)
    const zeroArea = zeroGexDisplay.use() === 'area';
    const bandRef = useRef<PriceBand | null>(null);
    // Sigma levels (off by default): dotted grey segments from the next day to the right edge (RightSegments), labels as
    // price lines without a line, so they stack with the other level labels
    const sigmaView = sigmaMode.use();
    const segmentsRef = useRef<RightSegments | null>(null);

    // ---- Custom levels (right click adds, drag moves, shared with the GEX tab) ----
    const [customLevels, setCustomLevels] = useCustomLevels(symbol);
    const customRef = useRef(customLevels);
    customRef.current = customLevels;
    const strikesRef = useRef(strikes);
    strikesRef.current = strikes;
    const levelsRef = useRef(levels);
    levelsRef.current = levels;
    /** A price from the chart as a level price: the nearest strike, or cents when there are no strikes. */
    const snap = (price: number) => nearestStrike(price, strikesRef.current) ?? roundPrice(price);
    const setCustomRef = useRef(setCustomLevels);
    setCustomRef.current = setCustomLevels;
    const [draft, setDraft] = useState<LevelDraft | null>(null);

    // ---- OHLC fetch (symbol; always LOAD_RANGE of daily bars, the range buttons only change the visible part) ----
    const loadRange = loadRangeFor(range);
    const proxyBase = liveCandles ? settings.proxyBase : '';
    const fetchKey = `${symbol}|${loadRange}|${proxyBase}|${asOfDate ?? ''}`;
    const [state, setState] = useState<FetchState>({ key: '', status: 'loading' });
    useEffect(() => {
        if (!symbol) return;
        const ac = new AbortController();
        setState({ key: fetchKey, status: 'loading' });
        loadOhlc(symbol, { proxyBase, signal: ac.signal }, { range: loadRange, interval: DEFAULT_CHART_INTERVAL }, asOfDate !== null)
            .then((bars) => { if (!ac.signal.aborted) setState({ key: fetchKey, status: 'ok', bars: asOfDate ? cutBarsAfter(bars, asOfDate) : bars }); })
            .catch((e: unknown) => {
                if (ac.signal.aborted) return;
                setState({ key: fetchKey, status: 'error', error: e });
            });
        return () => ac.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchKey]);
    const current = state.key === fetchKey ? state : { key: fetchKey, status: 'loading' as const };
    const bars = current.status === 'ok' ? current.bars : null;
    // the Sigma segments start at the slot after the last candle: logical index = number of bars
    const barCount = bars?.length ?? 0;

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
            // A double click on the TIME axis is ours (see the effect below): the library's own reset puts the last candle against the
            // right edge, under the level labels. A double click on the price axis keeps the library's autoscale reset.
            handleScale: { axisDoubleClickReset: { time: false, price: true } },
        });
        const series = chart.addSeries(CandlestickSeries, {
            // no built-in last-close line and axis label: the named Spot level is the only line at the current price
            // (owner 2026-10-25: an unnamed orange 7623.68 sat on top of "Spot 7623.68" on SPX)
            priceLineVisible: false,
            lastValueVisible: false,
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
        const band = new PriceBand();
        series.attachPrimitive(band);
        bandRef.current = band;
        const segments = new RightSegments();
        series.attachPrimitive(segments);
        segmentsRef.current = segments;
        chartRef.current = chart;
        seriesRef.current = series;
        // for the browser checks: the library's own last-close line and label stay off (only the named Spot level shows)
        const own = series.options();
        el.dataset.seriesLastPrice = own.priceLineVisible || own.lastValueVisible ? 'on' : 'off';
        // the crosshair snaps to the hovered candle's open, high, low or close only when the cursor is close to it
        // (crosshair-magnet.ts); data-crosshair-snap is the snapped price or '' (free), for the browser checks
        const detachMagnet = attachCrosshairMagnet(chart, series, (price) => { el.dataset.crosshairSnap = price === null ? '' : String(price); });
        return () => {
            detachMagnet();
            bandRef.current = null;
            segmentsRef.current = null;
            priceLinesRef.current = [];
            // the lines belong to this chart: a rebuilt chart must not try to remove them from its new series
            customLinesRef.current = [];
            seriesRef.current = null;
            chartRef.current = null;
            chart.remove();
        };
    }, [hasSymbol]);

    // ---- Candles in the sign colours (owner, 2026-10-25): bull = Net GEX (+), bear = Net GEX (-), body, border and wick.
    // The same token as the GEX bars and the Board row tints, so a custom colour and a reset of the Metrics panel reach them too.
    const signColors = useMetricColors();
    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;
        const up = signColors.netGexPos;
        const down = signColors.netGexNeg;
        series.applyOptions({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
        // for the browser checks (the candles are drawn on a canvas)
        const el = containerRef.current;
        if (el) { el.dataset.candleUp = up; el.dataset.candleDown = down; }
    }, [signColors.netGexPos, signColors.netGexNeg, hasSymbol]);

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

    // ---- Visible part ----
    // The window a ticker was left at (pan and zoom, remembered per ticker, offsets from the last bar) comes back after a
    // refresh and when the ticker is opened again. A click on a range button, or no saved window, gives the chosen range
    // of the loaded history. A backtest never reads or writes the saved window (it shows another stretch of the history).
    const viewsRef = useRef<ZoomMap | null>(null);
    const lastRangeRef = useRef(range);
    const saveTimer = useRef<number | null>(null);
    const suppressSaveUntil = useRef(0);
    const barsRef = useRef(bars);
    barsRef.current = bars;
    const rangeRef = useRef(range);
    rangeRef.current = range;
    const views = () => (viewsRef.current ??= loadChartViews());
    useEffect(() => {
        if (!bars?.length) return;
        const times = bars.map((b) => b.time);
        const rangeClicked = lastRangeRef.current !== range;
        lastRangeRef.current = range;
        if (rangeClicked && !asOfDate) { viewsRef.current = withZoom(views(), symbol, null); saveChartViews(viewsRef.current); }
        const stored = asOfDate ? null : zoomFor(views(), symbol);
        const target = stored ? fromStoredView(stored, times.length) : visibleRangeFor(times, range);
        chartRef.current?.timeScale().setVisibleLogicalRange(target);
    }, [bars, range, hasSymbol]);
    // The user's own pan and zoom are saved (a little after they stop). The chart reports EVERY change of the window, also the
    // ones the code makes (a new range, new data, a resize), so a change counts only while the user is touching the chart:
    // a wheel turn, a press or a drag on it, or a finger on it.
    useEffect(() => {
        const scale = chartRef.current?.timeScale();
        const el = containerRef.current;
        if (!scale || !el || !hasSymbol || asOfDate) return;
        let touchedAt = 0;
        const touch = () => { touchedAt = Date.now(); };
        const drag = (e: PointerEvent) => { if (e.buttons) touchedAt = Date.now(); };
        el.addEventListener('wheel', touch, { passive: true });
        el.addEventListener('pointerdown', touch);
        el.addEventListener('pointermove', drag);
        const onChange = (r: { from: number; to: number } | null) => {
            const count = bars?.length ?? 0;
            // for the browser checks: the window on screen, offsets from the last bar
            if (r && count) el.dataset.view = toStoredView(r, count).map((n) => n.toFixed(1)).join(',');
            if (!r || !count || Date.now() - touchedAt > 1500 || Date.now() < suppressSaveUntil.current) return;
            if (saveTimer.current) window.clearTimeout(saveTimer.current);
            saveTimer.current = window.setTimeout(() => {
                viewsRef.current = withZoom(views(), symbol, toStoredView(r, count));
                saveChartViews(viewsRef.current);
            }, 300);
        };
        scale.subscribeVisibleLogicalRangeChange(onChange);
        return () => {
            scale.unsubscribeVisibleLogicalRangeChange(onChange);
            el.removeEventListener('wheel', touch);
            el.removeEventListener('pointerdown', touch);
            el.removeEventListener('pointermove', drag);
            if (saveTimer.current) window.clearTimeout(saveTimer.current);
        };
    }, [bars, symbol, hasSymbol, asOfDate]);

    // A double click on the time axis (the dates under the chart) puts the chart back to the chosen interval WITH empty space
    // right of the last candle, so the candles end well before the level labels and can be read, and forgets the saved window.
    useEffect(() => {
        const el = containerRef.current;
        if (!el || !hasSymbol) return;
        const onDouble = (e: MouseEvent) => {
            const chart = chartRef.current;
            const list = barsRef.current;
            if (!chart || !list?.length) return;
            const y = e.clientY - el.getBoundingClientRect().top;
            if (y <= chart.paneSize().height) return; // the plot or the price axis: not ours
            suppressSaveUntil.current = Date.now() + 1500;
            if (!asOfDate) { viewsRef.current = withZoom(views(), symbol, null); saveChartViews(viewsRef.current); }
            chart.timeScale().setVisibleLogicalRange(visibleRangeFor(list.map((b) => b.time), rangeRef.current));
            e.preventDefault();
        };
        el.addEventListener('dblclick', onDouble);
        return () => el.removeEventListener('dblclick', onDouble);
    }, [symbol, hasSymbol, asOfDate]);

    // ---- Level price lines: remove the previous set, then draw the new one ----
    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;
        for (const line of priceLinesRef.current) series.removePriceLine(line);
        const entries = levelEntries(levels).filter((l) => selectedLevels.includes(l.key) && (l.key !== 'maxAbsGamma' || agEnabled));
        const zone = zeroArea && selectedLevels.includes('zeroGex') ? levels?.zeroGexZone ?? null : null;
        const sigma = selectedLevels.includes('sigma') ? sigmaLines(levels, sigmaView) : [];
        // a Sigma strike on a shown level joins its title ("Max Net GEX + 1σ"), the others get "7770 1σ" (level-labels.ts)
        const labels = chartLabelsWithSigma(
            entries.map((l) => ({ key: l.key, value: l.price, text: tr(l.label) })),
            sigma.map((l) => ({ key: l.key, value: l.strike, text: l.text })),
            (v) => String(Number(v.toFixed(2))),
        );
        const sigmaLabelLines = labels.sigma.map((l) => series.createPriceLine({
            price: l.value,
            color: levelColors.sigma,
            lineWidth: SIGMA_LINE_WIDTH,
            lineStyle: LineStyle.Dotted,
            lineVisible: false, // the line itself is the segment from the next day on
            axisLabelVisible: true,
            title: l.text,
        }));
        segmentsRef.current?.set(sigma.length ? { prices: sigma.map((l) => l.strike), color: levelColors.sigma, width: SIGMA_LINE_WIDTH, fromLogical: barCount } : null);
        priceLinesRef.current = [...sigmaLabelLines, ...entries.map((l) => series.createPriceLine({
            price: l.price,
            color: levelColors[l.key],
            lineWidth: LEVEL_LINE_WIDTH,
            lineStyle: l.secondary ? LineStyle.Dotted : LineStyle.LargeDashed,
            // Zero GEX drawn as a band: no line of its own, its title and axis label stay
            lineVisible: !(l.key === 'zeroGex' && zone),
            axisLabelVisible: true,
            title: labels.titles[l.key] ?? tr(l.label),
        }))];
        bandRef.current?.set(zone ? { low: zone.low, high: zone.high, color: levelColors.zeroGex } : null);
        levelPricesRef.current = [...entries.map((l) => l.price), ...(zone ? [zone.low, zone.high] : []), ...sigma.map((l) => l.strike)];
        // Re-run autoscale so newly in-range levels are pulled into view.
        chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
    }, [levels, tr, hasSymbol, selectedLevels, levelColors, agEnabled, zeroArea, sigmaView, barCount]);

    // ---- Custom level price lines ----
    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;
        for (const line of customLinesRef.current) series.removePriceLine(line);
        const shown = customLevels.filter((c) => !c.hidden);
        customLinesRef.current = shown.map((c) => series.createPriceLine({
            price: c.price,
            color: levelColorOf(c),
            lineWidth: CUSTOM_LINE_WIDTH,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: c.name,
        }));
        customPricesRef.current = shown.map((c) => c.price);
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
            if (customLevelsLocked()) return false; // a backtest shows the snapshot's levels, read-only
            const pt = plotPoint(e);
            const price = pt && seriesRef.current ? seriesRef.current.coordinateToPrice(pt.y) : null;
            if (!pt || price == null || !Number.isFinite(price)) return false;
            // Right click on an existing custom level edits its name instead of adding a new one
            const hitId = levelAt(pt.y);
            const hit = hitId ? customRef.current.find((c) => c.id === hitId) : undefined;
            if (hit) {
                setDraft({ x: pt.x, y: pt.y, price: hit.price, name: hit.name, color: levelColorOf(hit), editId: hit.id });
                return true;
            }
            setDraft({ x: pt.x, y: pt.y, price: snap(price), name: defaultLevelName(customRef.current, snap(price), levelsRef.current?.spot, { above: tr('chart.custom.buyside'), below: tr('chart.custom.sellside'), plain: tr('chart.custom.defaultName') }), color: proposeLevelColor(customRef.current, snap(price), levelsRef.current?.spot) });
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
            if (e.button !== 0 || customLevelsLocked()) return;
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
        // a touch screen has no right click: holding one finger still opens the same editor at the finger
        const stopLong = attachLongPress(el, (p) => openEditorAt(p as MouseEvent));
        return () => {
            stopLong();
            el.removeEventListener('contextmenu', onContextMenu);
            el.removeEventListener('mousedown', onDown, true);
            el.removeEventListener('mousemove', onHover);
        };
    }, [hasSymbol, tr]);

    const commitDraft = (name: string, color: string) => {
        if (!draft) return;
        if (draft.editId) {
            setCustomLevels(customLevels.map((c) => (c.id === draft.editId ? { ...c, name, color } : c)));
            setDraft(null);
            return;
        }
        const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random();
        setCustomLevels([...customLevels, { id, name, price: draft.price, color }]);
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
            ? `${tr('chart.error', { error: errorText(current.error, lang) })}\n\n${tr('chart.proxyHint')}`
            : bars && bars.length === 0 ? tr('chart.empty.noBars', { symbol }) : null;

    return (
        <main className="mx-auto flex w-full flex-1 flex-col px-4 pt-4 lg:min-h-0 lg:px-6">
            {/* ---- The Metrics and Levels panels: the toolbar row shared with the Board and GEX tabs (the symbol and the range
                selector are on the chart itself, top left, see ChartHeader) ---- */}
            <ToolbarRow metrics={metrics} setMetrics={setMetrics} levels={levels} symbol={symbol} colorTheme={settings.colorTheme} />
            {entries.length === 0 && (
                <p className="mb-3 text-xs text-slate-400">{isFuturesPriced ? tr('chart.levels.futuresPriced', { symbol }) : tr('chart.levels.none')}</p>
            )}
            {entries.length > 0 && isFuturesPriced && <p className="mb-3 text-xs text-slate-400">{tr('chart.levels.futuresPricedHint')}</p>}

            {/* ---- Chart (container always mounted so the instance survives refetches) ---- */}
            <section ref={fs.ref as React.RefObject<HTMLElement>} className={'relative flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-2 lg:min-h-0 lg:flex-1' + (fs.full ? ' !fixed inset-0 z-[60] !rounded-none !bg-white dark:!bg-slate-900' : '')}>
                {/* The chart takes the height that is left (no hand-made window height formula: it went stale every time the rows above
                    changed and left a gap above the footer), at least 240 px */}
                <div className={'relative h-[420px] lg:h-auto lg:min-h-[240px] lg:flex-1' + (fs.full ? ' !h-auto flex-1' : '')}>
                    <div ref={containerRef} className="absolute inset-0" data-bars={bars?.length ?? 0} data-last-bar={bars && bars.length ? new Date(bars[bars.length - 1].time * 1000).toISOString().slice(0, 10) : ''} />
                    <div className="absolute left-0 top-0 z-20">
                        <ChartHeader symbol={symbol} range={range} setRange={setRange} colorTheme={settings.colorTheme} fullscreen={fs} />
                    </div>
                    <FadePresence value={draft}>
                        {(d) => (
                            <CustomLevelEditor
                                key={`${d.x}:${d.y}`}
                                draft={d}
                                boxWidth={containerRef.current?.clientWidth ?? 0}
                                onSave={commitDraft}
                                onCancel={() => setDraft(null)}
                                onDelete={removeDraftLevel}
                            />
                        )}
                    </FadePresence>
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
