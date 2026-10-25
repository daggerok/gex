/// <reference lib="esnext" />
import * as React from 'react';
import { useEffect, useRef } from 'react';
import { centerRowInScroll } from '../center-row';
import { HelpButton } from '../components/HelpButton';
import type { Board, BoardColumn, BoardRow } from '../gex';
import { useI18n } from '../i18n';
import { signColor, useMetricColors } from '../metric-prefs';
import { useLevelPrefs } from '../level-prefs';
import { fmt, fmtCompact, fmtInt, fmtSignedCompact } from '../utils';

// ============================================================================
// BOARD TAB (owner 2026-10-25) - one row per strike of the selected expirations: Net GEX, Abs GEX, notional delta, OI and
// volume (total, calls, puts) and each strike's share of the Abs GEX. The numbers come from src/gex.ts computeBoard
// through useGexLevels (the view only renders). A dot marks each column's peak, coloured by the sign of the value it marks
// (the Net GEX (+) / (-) colours, metric-prefs signColor), and tints its row by the sign of the
// row's Net GEX; the ATM row (strike nearest to spot) has the Desk's Spot tint and sits in the middle of the table on open
// and whenever the ticker or the expiration selection changes (src/center-row.ts, like the Desk). The table looks like the
// Desk (font, size, rows, header). The expirations and their OI shares are in the shared Expirations panel.
// ============================================================================

const COLUMNS: ReadonlyArray<{ key: BoardColumn; label: string; format: (r: BoardRow) => string }> = [
    { key: 'netGex', label: 'board.col.netGex', format: (r) => fmtSignedCompact(r.netGex) },
    { key: 'absGex', label: 'board.col.absGex', format: (r) => fmtCompact(r.absGex) },
    { key: 'notionalDelta', label: 'board.col.notionalDelta', format: (r) => fmtSignedCompact(r.notionalDelta) },
    { key: 'totalOi', label: 'board.col.totalOi', format: (r) => fmtInt(r.totalOi) },
    { key: 'callOi', label: 'board.col.callOi', format: (r) => fmtInt(r.callOi) },
    { key: 'putOi', label: 'board.col.putOi', format: (r) => fmtInt(r.putOi) },
    { key: 'totalVolume', label: 'board.col.totalVolume', format: (r) => fmtInt(r.totalVolume) },
    { key: 'callVolume', label: 'board.col.callVolume', format: (r) => fmtInt(r.callVolume) },
    { key: 'putVolume', label: 'board.col.putVolume', format: (r) => fmtInt(r.putVolume) },
    { key: 'absGexShare', label: 'board.col.absGexShare', format: (r) => `${(r.absGexShare * 100).toFixed(2)}%` },
];

/** A peak dot of a zero value (no sign): grey. A positive value's dot is the Net GEX (+) colour, a negative one's (-). */
const NEUTRAL_DOT = '#94a3b8';

export const BoardView: React.FC<{
    symbol: string;
    board: Board | null;
    selectedExps: readonly string[];
}> = ({ symbol, board, selectedExps }) => {
    const { t: tr } = useI18n();
    const colors = useMetricColors();
    // the ATM row is tinted with the Spot level colour exactly like the Desk's (index.css `.od-atm`, --od-atm)
    const atmColor = useLevelPrefs().colors.spot;
    const scrollRef = useRef<HTMLDivElement>(null);
    const headRef = useRef<HTMLTableSectionElement>(null);
    const atmRef = useRef<HTMLTableRowElement>(null);
    const peakSets = React.useMemo(() => {
        const out = {} as Record<BoardColumn, Set<number>>;
        for (const c of COLUMNS) out[c.key] = new Set(board?.peaks[c.key] ?? []);
        return out;
    }, [board]);

    // The ATM row in the vertical middle of the table (below the sticky header) on open and on a new ticker or selection
    const selectionKey = selectedExps.join(',');
    const hasRows = (board?.rows.length ?? 0) > 0;
    useEffect(() => {
        if (!hasRows) return undefined;
        return centerRowInScroll(() => scrollRef.current, () => atmRef.current, () => headRef.current?.getBoundingClientRect().height ?? 0);
    }, [symbol, selectionKey, hasRows]);

    const tint = (row: BoardRow): string | undefined => {
        if (!COLUMNS.some((c) => peakSets[c.key].has(row.strike))) return undefined;
        const color = signColor(row.netGex, colors);
        return color ? `color-mix(in srgb, ${color} 16%, transparent)` : undefined;
    };

    return (
        <main className="mx-auto w-full px-4 pt-4 lg:px-6 h-full flex flex-col min-h-0" data-board>
            {/* the expirations and their OI shares are in the shared Expirations panel above (main.tsx), like on every tab */}
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
                                        <HelpButton label={tr('board.help.label')} paragraphs={[tr('board.help.rows'), tr('board.help.gex'), tr('board.help.delta'), tr('board.help.counts')]} align="left" />
                                    </span>
                                </th>
                                {COLUMNS.map((c) => (
                                    <th key={c.key} scope="col" className="px-2 py-[3px] text-right font-medium">{tr(c.label)}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {board.rows.map((row) => {
                                const atm = row.strike === board.atmStrike;
                                // the ATM tint wins over a peak tint (the peak dots stay)
                                const bg = atm ? undefined : tint(row);
                                return (
                                    <tr
                                        key={row.strike}
                                        ref={atm ? atmRef : undefined}
                                        data-board-row={row.strike}
                                        data-board-atm={atm ? '' : undefined}
                                        aria-current={atm ? 'true' : undefined}
                                        className={'board-row' + (atm ? ' od-atm' : '')}
                                        style={bg ? { backgroundColor: bg } : undefined}
                                    >
                                        <th
                                            scope="row"
                                            className="od-strike-cell sticky left-0 px-1.5 py-[3px] text-center font-semibold text-slate-900 dark:text-slate-100"
                                            // the sticky strike cell is opaque; a peak's tint is laid over its background
                                            style={bg ? { backgroundImage: `linear-gradient(${bg}, ${bg})` } : undefined}
                                        >
                                            {fmt(row.strike)}
                                            {atm && <span className="sr-only"> {tr('board.atm')}</span>}
                                        </th>
                                        {COLUMNS.map((c) => {
                                            const peak = peakSets[c.key].has(row.strike);
                                            return (
                                                <td key={c.key} className="whitespace-nowrap px-2 py-[3px] text-right" data-board-peak={peak ? c.key : undefined}>
                                                    {peak && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: signColor(row[c.key], colors) ?? NEUTRAL_DOT }} data-board-dot role="img" aria-label={tr('board.peak')} />}
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
        </main>
    );
};
