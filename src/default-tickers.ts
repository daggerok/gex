/// <reference lib="esnext" />
// ============================================================================
// The required tickers: the preset the partial data refresh updates every hour and the
// default of every backup (the ticker search hint shows the same list, a unit test in
// scripts/options-data.test.ts keeps them equal). The order is the order of the hint.
// Every fetcher run fetches this list (scripts/options-data.ts: the DEFAULT_TICKERS env replaces
// it, TICKERS adds to it). COMP is Compass, Inc. and DJIA the Global X Dow 30 Covered Call ETF on
// Yahoo and Cboe (the Nasdaq Composite ^IXIC and the Dow ^DJI have no listed options); INDU and
// NYA have no listed options at all and end on the no-options skiplist.
// ============================================================================

export const DEFAULT_TICKERS: readonly string[] = ['SPX', 'NDX', 'DJX', 'RUT', 'IWM', 'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'TSM', 'META', 'AVGO', 'MU', 'GOOG', 'SPY', 'QQQ', 'DIA', 'XSP', 'COMP', 'DJIA', 'INDU', 'NYA'];
