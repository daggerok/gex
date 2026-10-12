import type { OhlcBar } from '../types';

// ============================================================================
// Chart candles in a backtest: the Chart tab shows the daily candles up to and including the
// archived day, none after it (the file of api/charts has candles up to today).
// ============================================================================

/** Keeps the bars up to and including `date` (`YYYY-MM-DD`). Bars carry Unix seconds (UTC midnight for daily bars). */
export function cutBarsAfter(bars: readonly OhlcBar[], date: string): OhlcBar[] {
    const end = Date.parse(`${date}T23:59:59Z`) / 1000;
    if (!Number.isFinite(end)) return [...bars];
    return bars.filter((b) => b.time <= end);
}
