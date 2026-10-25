/// <reference lib="esnext" />
import * as React from 'react';
import { useEffect, useRef } from 'react';
import { centerRowInScroll } from '../center-row';
import { HelpButton } from '../components/HelpButton';
import type { Board, BoardColumn, BoardRow } from '../gex';
import { useI18n } from '../i18n';
import { useMetricColors } from '../metric-prefs';
import { accentOf } from '../theme';
import type { ColorThemeId } from '../types';
import { fmt, fmtCompact, fmtInt, fmtSignedCompact } from '../utils';

// ============================================================================
// BOARD TAB (owner 2026-10-25) - one row per strike of the selected expirations: Net GEX, Abs GEX, notional delta, OI and
// volume (total, calls, puts) and each strike's share of the Abs GEX. The numbers come from src/gex.ts computeBoard
// through useGexLevels (the view only renders). A green dot marks each column's peak and tints its row by the sign of the
// row's Net GEX; the ATM row (strike nearest to spot) is grey and sits in the middle of the table on open and whenever
// the ticker or the expiration selection changes (src/center-row.ts, like the Desk). Above the table the expirations
// with their share of the open interest; a click toggles one in the shared selection.
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

/** Opaque header / strike cell backgrounds (sticky cells must hide what scrolls under them). */
const STICKY_BG = 'bg-slate-50 dark:bg-slate-900';

export const BoardView: React.FC<{
    symbol: string;
    board: Board | null;
    /** every expiration of the ticker, in order */
    expirations: readonly string[];
    selectedExps: readonly string[];
    /** each LOADED expiration's share (0..1) of the open interest of all loaded expirations */
    oiShares: Readonly<Record<string, number>>;
    onToggleExpiration: (exp: string) => void;
    colorTheme: ColorThemeId;
}> = ({ symbol, board, expirations, selectedExps, oiShares, onToggleExpiration, colorTheme }) => {
    const { t: tr } = useI18n();
    const ax = accentOf(colorTheme);
    const colors = useMetricColors();
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
        if (row.netGex === 0) return undefined;
        return `color-mix(in srgb, ${row.netGex > 0 ? colors.netGexPos : colors.netGexNeg} 16%, transparent)`;
    };

    return (
        <main className="mx-auto w-full px-4 pt-4 lg:px-6 h-full flex flex-col min-h-0" data-board>
            {/* expiration chips with their share of the open interest (the shared selection, like the Expirations panel) */}
            <div className="mb-2 flex shrink-0 items-center gap-2">
                <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{tr('board.expirations')}</span>
                <div className="themed-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" data-board-expirations>
                    {expirations.map((exp) => {
                        const on = selectedExps.includes(exp);
                        const share = oiShares[exp];
                        const pct = share === undefined ? null : `${(share * 100).toFixed(1)}%`;
                        return (
                            <button
                                key={exp}
                                type="button"
                                onClick={() => onToggleExpiration(exp)}
                                aria-pressed={on}
                                aria-label={pct === null ? `${exp}: ${tr('board.notLoaded')}` : tr('board.expShare', { exp, pct })}
                                data-board-exp={exp}
                                className={'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums ' + (on ? ax.chipActive : ax.chipIdle)}
                            >
                                {exp} <span className="opacity-70">{pct ?? '-'}</span>
                            </button>
                        );
                    })}
                </div>
                <HelpButton label={tr('board.help.label')} paragraphs={[tr('board.help.rows'), tr('board.help.gex'), tr('board.help.delta'), tr('board.help.counts')]} align="right" />
            </div>

            <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800" data-board-scroll>
                {!board || !hasRows ? (
                    <p className="p-4 text-sm text-slate-500 dark:text-slate-400">{tr('board.empty')}</p>
                ) : (
                    <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-xs tabular-nums" aria-label={tr('board.label')}>
                        <thead ref={headRef} className="sticky top-0 z-10">
                            <tr className={STICKY_BG + ' text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400'}>
                                <th scope="col" className={`sticky left-0 z-10 ${STICKY_BG} border-b border-slate-200 px-3 py-2 text-right font-semibold dark:border-slate-700`}>{tr('board.col.strike')}</th>
                                {COLUMNS.map((c) => (
                                    <th key={c.key} scope="col" className="border-b border-slate-200 px-3 py-2 text-right font-semibold dark:border-slate-700">{tr(c.label)}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {board.rows.map((row) => {
                                const atm = row.strike === board.atmStrike;
                                const bg = tint(row);
                                return (
                                    <tr
                                        key={row.strike}
                                        ref={atm ? atmRef : undefined}
                                        data-board-row={row.strike}
                                        data-board-atm={atm ? '' : undefined}
                                        aria-current={atm ? 'true' : undefined}
                                        className={(atm ? 'bg-slate-200/80 font-semibold dark:bg-slate-700/70 ' : '') + 'text-slate-700 dark:text-slate-200'}
                                        style={bg && !atm ? { backgroundColor: bg } : atm && bg ? { boxShadow: `inset 3px 0 0 0 ${row.netGex > 0 ? colors.netGexPos : colors.netGexNeg}` } : undefined}
                                    >
                                        <th
                                            scope="row"
                                            className={`sticky left-0 ${atm ? 'bg-slate-200 dark:bg-slate-700' : STICKY_BG} border-b border-slate-100 px-3 py-1 text-right font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100`}
                                            // the sticky strike cell is opaque; the row tint is laid over its background
                                            style={bg && !atm ? { backgroundImage: `linear-gradient(${bg}, ${bg})` } : undefined}
                                        >
                                            {fmt(row.strike)}
                                            {atm && <span className="sr-only"> {tr('board.atm')}</span>}
                                        </th>
                                        {COLUMNS.map((c) => {
                                            const peak = peakSets[c.key].has(row.strike);
                                            return (
                                                <td key={c.key} className="whitespace-nowrap border-b border-slate-100 px-3 py-1 text-right dark:border-slate-800" data-board-peak={peak ? c.key : undefined}>
                                                    {peak && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: colors.netGexPos }} role="img" aria-label={tr('board.peak')} />}
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
