/// <reference lib="esnext" />
// ============================================================================
// The required tickers: the preset the partial data refresh updates every hour and the
// default of every backup (the ticker search hint shows the same list, a unit test in
// scripts/options-data.test.ts keeps them equal). The order is the order of the hint.
// ============================================================================

export const DEFAULT_TICKERS: readonly string[] = ['SPX', 'NDX', 'DJX', 'RUT', 'IWM', 'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'TSM', 'META', 'AVGO', 'MU', 'GOOG', 'SPY', 'QQQ', 'DIA'];
