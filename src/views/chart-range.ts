// Chart tab range selector values (plan section 8.2). Kept out of
// ChartView.tsx so App can import the default without pulling the lazily
// loaded lightweight-charts chunk into the initial bundle.

/** Yahoo `range` tokens, all accepted by both proxies' CHART_RANGES. */
export type ChartRange = '1mo' | '3mo' | '6mo' | '1y';
export const CHART_RANGES: ChartRange[] = ['1mo', '3mo', '6mo', '1y'];
export const DEFAULT_RANGE: ChartRange = '6mo';
