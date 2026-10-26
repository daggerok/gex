/// <reference lib="esnext" />
import * as React from 'react';
import { useEffect, useRef } from 'react';
import { centerRowInScroll, scrollRowToMiddle } from '../center-row';
import { HelpButton } from '../components/HelpButton';
import { ScrollMarks } from '../components/ScrollMarks';
import { ToolbarRow } from '../components/ToolbarRow';
import { BOARD_COLUMNS, type Board, type BoardColumn, type BoardRow, type NetGexView } from '../gex';
import { BOARD_PEAK_DOT } from '../gex-colors';
import { LEVEL_LABEL_SEPARATOR, levelMarksByStrike, type LevelLabelItem } from '../level-labels';
import { useI18n } from '../i18n';
import { LEVEL_CHART_LABEL_KEY, levelLabelItems, sigmaMode, useLevelPrefs } from '../level-prefs';
import { netGexView, signColor, useMetricColors, type GexMetric } from '../metric-prefs';
import type { ScrollMarkRow } from '../scroll-marks';
import { useDarkClass } from '../theme';
import type { GexLevels, Settings } from '../types';
import { useCustomLevels } from '../use-custom-levels';
import { fmt, fmtCompact, fmtInt, fmtSignedCompact } from '../utils';

// ============================================================================
// BOARD TAB (owner 2026-10-25) - one row per strike of the selected expirations: Net GEX, Abs GEX, notional delta, OI and
// volume (total, calls, puts) and each strike's share of the Abs GEX. The numbers come from src/gex.ts computeBoard
// through useGexLevels (the view only renders). A dot marks each column's peak, light blue in the dark theme and a darker blue in the
// light one (gex-colors.ts BOARD_PEAK_DOT, owner 2026-10-25: no longer the value's sign colour), and tints its row by the sign of the
// row's Net GEX; the runner-up of a column (computeBoard seconds) gets the same dot and, on an untinted row only, its own cell tinted exactly like a peak row (signTint); the ATM row (strike nearest to spot) has the Desk's Spot tint and sits in the middle of the table on open
// and whenever the ticker or the expiration selection changes (src/center-row.ts, like the Desk). The table looks like the
// Desk (font, size, rows, header). The expirations and their OI shares are in the shared Expirations panel. Right of the
// table's scrollbar a minimap strip (components/ScrollMarks.tsx, src/scroll-marks.ts) shows only what the table tints (owner
// 2026-10-26): the ATM row in the Spot colour and the peak and runner-up rows in their Net GEX sign colour, placed by row,
// no frame over the rows in view (owner 2026-10-25); a click glides its row to the middle.
// ============================================================================

interface BoardColumnDef {
    key: string;
    label: string;
    format: (r: BoardRow) => string;
    /** the column whose peak dot this is (computeBoard peaks), none for the ratios */
    peak?: BoardColumn;
}

const ratio = (v: number | null): string => (v === null ? '-' : v.toFixed(2));

/** Every column the Board can show, in order; which are shown follows the Metrics chips (boardColumns). */
const ALL_COLUMNS: Record<string, BoardColumnDef> = {
    netGex: { key: 'netGex', label: 'board.col.netGex', format: (r) => fmtSignedCompact(r.netGex), peak: 'netGex' },
    callGex: { key: 'callGex', label: 'board.col.callGex', format: (r) => fmtSignedCompact(r.callGex), peak: 'callGex' },
    putGex: { key: 'putGex', label: 'board.col.putGex', format: (r) => fmtSignedCompact(r.putGex), peak: 'putGex' },
    absGex: { key: 'absGex', label: 'board.col.absGex', format: (r) => fmtCompact(r.absGex), peak: 'absGex' },
    notionalDelta: { key: 'notionalDelta', label: 'board.col.notionalDelta', format: (r) => fmtSignedCompact(r.notionalDelta), peak: 'notionalDelta' },
    totalOi: { key: 'totalOi', label: 'board.col.totalOi', format: (r) => fmtInt(r.totalOi), peak: 'totalOi' },
    callOi: { key: 'callOi', label: 'board.col.callOi', format: (r) => fmtInt(r.callOi), peak: 'callOi' },
    putOi: { key: 'putOi', label: 'board.col.putOi', format: (r) => fmtInt(r.putOi), peak: 'putOi' },
    pcOi: { key: 'pcOi', label: 'board.col.pcOi', format: (r) => ratio(r.pcRatioOi) },
    totalVolume: { key: 'totalVolume', label: 'board.col.totalVolume', format: (r) => fmtInt(r.totalVolume), peak: 'totalVolume' },
    callVolume: { key: 'callVolume', label: 'board.col.callVolume', format: (r) => fmtInt(r.callVolume), peak: 'callVolume' },
    putVolume: { key: 'putVolume', label: 'board.col.putVolume', format: (r) => fmtInt(r.putVolume), peak: 'putVolume' },
    pcVolume: { key: 'pcVolume', label: 'board.col.pcVolume', format: (r) => ratio(r.pcRatioVolume) },
    absGexShare: { key: 'absGexShare', label: 'board.col.absGexShare', format: (r) => `${(r.absGexShare * 100).toFixed(2)}%`, peak: 'absGexShare' },
};

/**
 * The Board columns for the chosen metrics (owner, 2026-10-25: the Metrics chips show or hide their columns): Net GEX ->
 * NET GEX, or CALL GEX and PUT GEX in the Abs GEX view (`split`), AG -> ABS GEX, Call / Put OI and volume -> their columns,
 * P/C OI / volume -> the ratio columns. Notional delta, total OI, total volume and % always show.
 */
export function boardColumns(metrics: readonly GexMetric[], view: NetGexView): string[] {
    const on = (m: GexMetric) => metrics.includes(m);
    const cols: string[] = [];
    if (on('netGex')) cols.push(...(view === 'split' ? ['callGex', 'putGex'] : ['netGex']));
    if (on('absoluteGamma')) cols.push('absGex');
    cols.push('notionalDelta', 'totalOi');
    if (on('callOi')) cols.push('callOi');
    if (on('putOi')) cols.push('putOi');
    if (on('pcRatioOi')) cols.push('pcOi');
    cols.push('totalVolume');
    if (on('callVolume')) cols.push('callVolume');
    if (on('putVolume')) cols.push('putVolume');
    if (on('pcRatioVolume')) cols.push('pcVolume');
    cols.push('absGexShare');
    return cols;
}

/** Strength of a peak row's tint and of a runner-up cell's tint (one value, owner 2026-10-25: exactly the same tint). */
const PEAK_TINT_PCT = 16;

/**
 * The tint of a peak's row and of a runner-up's cell, by the sign of the row's Net GEX: the sign colour mixed into the
 * table's opaque base (`--board-base`, index.css), so it reads the same on a row and on a cell and never stacks on the
 * zebra. null for a zero Net GEX (no sign).
 */
export function signTint(netGex: number, colors: { netGexPos: string; netGexNeg: string }): string | undefined {
    const color = signColor(netGex, colors);
    return color ? `color-mix(in srgb, ${color} ${PEAK_TINT_PCT}%, var(--board-base))` : undefined;
}

/** A zero Net GEX (no sign) on the scroll marks: grey. */
const NEUTRAL_DOT = '#94a3b8';

export const BoardView: React.FC<{
    symbol: string;
    board: Board | null;
    selectedExps: readonly string[];
    levels: GexLevels | null;
    metrics: GexMetric[];
    setMetrics: (metrics: GexMetric[]) => void;
    colorTheme: Settings['colorTheme'];
    spotEstimated?: boolean;
}> = ({ symbol, board, selectedExps, levels, metrics, setMetrics, colorTheme, spotEstimated = false }) => {
    const { t: tr } = useI18n();
    const colors = useMetricColors();
    // the peak and runner-up dots: one blue per theme, not the sign colours (owner 2026-10-25)
    const dotColor = BOARD_PEAK_DOT[useDarkClass() ? 'dark' : 'light'];
    const { selected: selectedLevels, colors: levelColors } = useLevelPrefs();
    // the ATM row is tinted with the Spot level colour exactly like the Desk's (index.css `.od-atm`, --od-atm)
    const atmColor = levelColors.spot;
    const netView = netGexView.use();
    const sigmaView = sigmaMode.use();
    const [customLevels] = useCustomLevels(symbol);
    const columns = React.useMemo(() => boardColumns(metrics, netView).map((k) => ALL_COLUMNS[k]), [metrics, netView]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const headRef = useRef<HTMLTableSectionElement>(null);
    const atmRef = useRef<HTMLTableRowElement>(null);
    const peakSets = React.useMemo(() => {
        const out = {} as Record<BoardColumn, Set<number>>;
        for (const c of BOARD_COLUMNS) out[c] = new Set(board?.peaks[c] ?? []);
        return out;
    }, [board]);
    const secondSets = React.useMemo(() => {
        const out = {} as Record<BoardColumn, Set<number>>;
        for (const c of BOARD_COLUMNS) out[c] = new Set(board?.seconds[c] ?? []);
        return out;
    }, [board]);
    // the enabled levels on their (nearest) strikes, with the chart's level names and colours (level-labels.ts)
    const marks = React.useMemo(() => {
        if (!board) return new Map<number, LevelLabelItem[]>();
        const items = levelLabelItems({ levels, selected: selectedLevels, colors: levelColors, showMaxAg: metrics.includes('absoluteGamma'), sigma: sigmaView, label: (k) => tr(LEVEL_CHART_LABEL_KEY[k]), customLevels });
        return levelMarksByStrike(items, board.rows.map((r) => r.strike));
    }, [board, levels, selectedLevels, levelColors, metrics, sigmaView, tr, customLevels]);

    // The ATM row in the vertical middle of the table (below the sticky header) on open and on a new ticker or selection
    const selectionKey = selectedExps.join(',');
    const hasRows = (board?.rows.length ?? 0) > 0;
    useEffect(() => {
        if (!hasRows) return undefined;
        return centerRowInScroll(() => scrollRef.current, () => atmRef.current, () => headRef.current?.getBoundingClientRect().height ?? 0);
    }, [symbol, selectionKey, hasRows]);

    // ---- the scroll marks strip: only what the table tints (owner 2026-10-26): the ATM row in the Spot colour and the rows
    // and cells of the shown columns' peaks and runner-ups in the Net GEX sign colours; no level colours, no plain rows ----
    const markRows = React.useMemo<ScrollMarkRow[]>(() => (board?.rows ?? []).map((r) => ({
        strike: r.strike,
        netGex: r.netGex,
        atm: r.strike === board?.atmStrike,
        peaks: columns.filter((c) => c.peak && peakSets[c.peak].has(r.strike)).map((c) => c.key),
        seconds: columns.filter((c) => c.peak && !peakSets[c.peak].has(r.strike) && secondSets[c.peak].has(r.strike)).map((c) => c.key),
    })), [board, columns, peakSets, secondSets]);
    const markColors = React.useMemo(() => ({ pos: colors.netGexPos, neg: colors.netGexNeg, zero: NEUTRAL_DOT, atm: atmColor }), [colors.netGexPos, colors.netGexNeg, atmColor]);
    const headHeight = React.useCallback(() => headRef.current?.getBoundingClientRect().height ?? 0, []);
    const pickRow = React.useCallback((r: ScrollMarkRow) => {
        const box = scrollRef.current;
        const row = box?.querySelector<HTMLElement>(`[data-board-row="${r.strike}"]`);
        if (box && row) scrollRowToMiddle(box, row, headHeight());
    }, [headHeight]);
    const describeMark = React.useCallback((r: ScrollMarkRow): string => {
        const parts = [`${fmt(r.strike)}   ${tr('board.col.netGex')} ${fmtSignedCompact(r.netGex)}`];
        if (r.atm) parts.push(tr('board.atm'));
        if (r.peaks?.length) parts.push(`${tr('board.peak')}: ${r.peaks.map((k) => tr(ALL_COLUMNS[k].label)).join(', ')}`);
        if (r.seconds?.length) parts.push(`${tr('board.second')}: ${r.seconds.map((k) => tr(ALL_COLUMNS[k].label)).join(', ')}`);
        return parts.join(' · ');
    }, [tr]);

    /** A peak's row tint (null when no shown column peaks on this row). */
    const peakRowTint = (row: BoardRow): string | undefined =>
        columns.some((c) => c.peak && peakSets[c.peak].has(row.strike)) ? signTint(row.netGex, colors) : undefined;

    return (
        <main className="mx-auto w-full px-4 pt-4 lg:px-6 h-full flex flex-col min-h-0" data-board>
            {/* the Metrics + Levels row of the GEX and Chart tabs (the expirations and their OI shares are in the shared panel) */}
            <ToolbarRow metrics={metrics} setMetrics={setMetrics} levels={levels} symbol={symbol} colorTheme={colorTheme} spotEstimated={spotEstimated} />
            {/* the card and, as an absolute overlay in the gutter right of it, the scroll marks strip (layout unchanged) */}
            <div className="relative flex flex-1 min-h-0 flex-col">
                <div
                    ref={scrollRef}
                    className="themed-scroll flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800"
                    style={{ ['--od-atm' as string]: atmColor }}
                    data-board-scroll
                >
                    {!board || !hasRows ? (
                        <p className="p-4 text-sm text-slate-500 dark:text-slate-400">{tr('board.empty')}</p>
                    ) : (
                        // the Desk's look (ChainTable): 16 px tabular numbers, 3 px x 8 px cells, 30 px rows, the zebra and the
                        // 11 px uppercase header on slate-100 / slate-800 (index.css `.board-*`, next to the `.od-*` rules)
                        <table className="w-full min-w-[60rem] border-separate border-spacing-0 tabular-nums text-slate-700 dark:text-slate-200" aria-label={tr('board.label')}>
                            <thead ref={headRef} className="sticky top-0 z-10">
                                <tr className="board-head text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    <th scope="col" className="sticky left-0 z-10 px-2 py-[3px] text-center font-medium">
                                        <span className="inline-flex items-center gap-1">
                                            {tr('board.col.strike')}
                                            <HelpButton label={tr('board.help.label')} paragraphs={[tr('board.help.rows'), tr('board.help.gex'), tr('board.help.delta'), tr('board.help.counts'), tr('board.help.toolbar'), tr('board.help.marks')]} align="left" />
                                        </span>
                                    </th>
                                    <th scope="col" className="px-2 py-[3px] text-left font-medium">{tr('board.col.levels')}</th>
                                    {columns.map((c) => (
                                        <th key={c.key} scope="col" className="px-2 py-[3px] text-right font-medium">{tr(c.label)}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {board.rows.map((row) => {
                                    const atm = row.strike === board.atmStrike;
                                    // the ATM tint wins over a peak tint (the peak dots stay)
                                    const bg = atm ? undefined : peakRowTint(row);
                                    // a row with a background of its own (ATM, peak) never gets a second one in a runner-up cell
                                    const rowTinted = atm || bg != null;
                                    return (
                                        <tr
                                            key={row.strike}
                                            ref={atm ? atmRef : undefined}
                                            data-board-row={row.strike}
                                            data-board-atm={atm ? '' : undefined}
                                            data-board-sign={row.netGex > 0 ? 'pos' : row.netGex < 0 ? 'neg' : undefined}
                                            data-board-tinted={bg ? '' : undefined}
                                            aria-current={atm ? 'true' : undefined}
                                            className={'board-row' + (atm ? ' od-atm' : '')}
                                            style={bg ? { backgroundColor: bg } : undefined}
                                        >
                                            <th
                                                scope="row"
                                                className="od-strike-cell sticky left-0 px-1.5 py-[3px] text-center font-semibold text-slate-900 dark:text-slate-100"
                                                // the sticky strike cell is opaque, so it takes the (opaque) peak tint itself
                                                style={bg ? { backgroundColor: bg } : undefined}
                                            >
                                                {fmt(row.strike)}
                                                {atm && <span className="sr-only"> {tr('board.atm')}</span>}
                                            </th>
                                            <td className="whitespace-nowrap px-2 py-[3px] text-left text-[11px] font-semibold" data-board-marks={marks.has(row.strike) ? '' : undefined}>
                                                {(marks.get(row.strike) ?? []).map((m, i) => (
                                                    <React.Fragment key={m.key}>
                                                        {i > 0 && <span className="text-slate-400">{LEVEL_LABEL_SEPARATOR}</span>}
                                                        <span style={{ color: m.color }} data-board-mark={m.key}>{m.text}</span>
                                                    </React.Fragment>
                                                ))}
                                            </td>
                                            {columns.map((c) => {
                                                const peak = !!c.peak && peakSets[c.peak].has(row.strike);
                                                // the runner-up: the peak's dot (the theme's blue) and, on an untinted row only, this cell
                                                // tinted exactly like a peak's row (signTint by the row's Net GEX) - never two backgrounds stacked
                                                const second = !peak && !!c.peak && secondSets[c.peak].has(row.strike);
                                                const cellBg = second && !rowTinted ? signTint(row.netGex, colors) : undefined;
                                                return (
                                                    <td key={c.key} className="whitespace-nowrap px-2 py-[3px] text-right" style={cellBg ? { backgroundColor: cellBg } : undefined} data-board-peak={peak ? c.key : undefined} data-board-second={second ? c.key : undefined} data-board-col={c.key}>
                                                        {(peak || second) && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: dotColor }} data-board-dot role="img" aria-label={tr(peak ? 'board.peak' : 'board.second')} />}
                                                        {c.format(row)}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
                {hasRows && <ScrollMarks scrollRef={scrollRef} rows={markRows} colors={markColors} onPick={pickRow} describe={describeMark} label={tr('board.marks.label')} markedOnly />}
            </div>
        </main>
    );
};
