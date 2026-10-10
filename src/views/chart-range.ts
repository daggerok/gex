// Chart tab range selector values (plan section 8.2). Kept out of
// ChartView.tsx so App can import the default without pulling the lazily
// loaded lightweight-charts chunk into the initial bundle.

/** Yahoo `range` tokens, all accepted by both proxies' CHART_RANGES. */
export type ChartRange = '1mo' | '3mo' | '6mo' | '1y';
export const CHART_RANGES: ChartRange[] = ['1mo', '3mo', '6mo', '1y'];
export const DEFAULT_RANGE: ChartRange = '6mo';

/** Share of the loaded bars kept in view, the oldest ones scroll off to the left (a little zoom in). */
export const CHART_VISIBLE_SHARE = 0.85;
/** Empty space right of the last candle, as a share of the visible bars, so the level labels do not cover candles. */
export const CHART_RIGHT_PAD_SHARE = 0.12;

/** Logical range for `timeScale().setVisibleLogicalRange` over `count` bars (indexes 0..count-1). */
export function initialVisibleRange(count: number): { from: number; to: number } {
    const visible = Math.max(1, Math.ceil(count * CHART_VISIBLE_SHARE));
    return { from: count - visible - 0.5, to: count - 1 + Math.ceil(visible * CHART_RIGHT_PAD_SHARE) };
}
