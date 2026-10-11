// Chart tab range selector values (plan section 8.2). Kept out of
// ChartView.tsx so App can import the default without pulling the lazily
// loaded lightweight-charts chunk into the initial bundle.

/** Yahoo `range` tokens, all accepted by both proxies' CHART_RANGES. */
export type ChartRange = '1mo' | '3mo' | '6mo' | '1y';
export const CHART_RANGES: ChartRange[] = ['1mo', '3mo', '6mo', '1y'];
export const DEFAULT_RANGE: ChartRange = '6mo';

/** The chart always loads this much history, the range buttons only choose how much of it is in view. */
export const LOAD_RANGE: ChartRange = '1y';

const RANGE_DAYS: Record<ChartRange, number> = { '1mo': 31, '3mo': 92, '6mo': 183, '1y': 366 };

/** Share of the bars inside the chosen range kept in view, the oldest ones scroll off to the left (a little zoom in). */
export const CHART_VISIBLE_SHARE = 0.85;
/** Empty space right of the last candle, as a share of the visible bars, so the level labels do not cover candles. */
export const CHART_RIGHT_PAD_SHARE = 0.12;

/**
 * Logical range for `timeScale().setVisibleLogicalRange`. `times` are the ascending bar times (unix seconds) of the
 * loaded history, `range` picks how far back the view starts. The older bars stay loaded, drag or zoom to see them.
 */
export function visibleRangeFor(times: number[], range: ChartRange): { from: number; to: number } {
    const count = times.length;
    const cutoff = (times[count - 1] ?? 0) - RANGE_DAYS[range] * 86_400;
    let inRange = 0;
    for (let i = count - 1; i >= 0 && times[i] >= cutoff; i--) inRange++;
    const visible = Math.max(1, Math.ceil(inRange * CHART_VISIBLE_SHARE));
    return { from: count - visible - 0.5, to: count - 1 + Math.ceil(visible * CHART_RIGHT_PAD_SHARE) };
}
