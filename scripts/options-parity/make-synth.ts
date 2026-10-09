// Writes synthetic upstream fixtures for the parity scenarios: a NASDAQ screener page (the real endpoint
// is blocked for scripted clients), Yahoo and Cboe error paths, and odd-value chains.
//   bun scripts/options-parity/make-synth.ts <out.json>
// Temporary tool: delete together with options-data.py.
/// <reference types="bun" />
/// <reference types="node" />
import { writeFileSync } from "node:fs";

const out: Record<string, { status: number; b64: string; enc: string }> = {};
const put = (key: string, body: unknown, status = 200) => {
    out[key] = { status, b64: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)).toString("base64"), enc: "utf8" };
};
const OPT = "https://query2.finance.yahoo.com/v7/finance/options/";
const CHART = "https://query2.finance.yahoo.com/v8/finance/chart/";
const CHART_Q = "?events=div,splits,capitalGains&includePrePost=false&interval=1d&range=1d";

// NASDAQ screener: class share, caret warrant, below the floor, empty and NaN caps, unicode and blank names
const rows = [
    { symbol: "NVDA", name: "NVIDIA Corporation Common Stock", marketCap: "4,300,000,000,000" },
    { symbol: "MSFT", name: "Microsoft Corporation Common Stock", marketCap: "3,900,000,000,000" },
    { symbol: "AAPL", name: "Apple Inc. Common Stock", marketCap: "3,800,000,000,000" },
    { symbol: "BRK/B", name: "Berkshire Hathaway Inc. Class B", marketCap: "1,000,000,000,000" },
    { symbol: "ZZZNOT", name: "Not optionable at Cboe", marketCap: "900,000,000,000" },
    { symbol: "BAD^W", name: "Warrant with caret", marketCap: "800,000,000,000" },
    { symbol: "AMZN", name: "Amazon.com, Inc. Common Stock", marketCap: "2,400,000,000,000" },
    { symbol: "GOOGL", name: "Alphabet Inc. Class A Common Stock", marketCap: "2,300,000,000,000" },
    { symbol: "MSTR", name: "Strategy Inc é Class A", marketCap: "2,300,000,000,000" },
    { symbol: "TINY", name: "Below the floor", marketCap: "1,000" },
    { symbol: "NOCAP", name: "No cap", marketCap: "" },
    { symbol: "NANCAP", name: "Nan cap", marketCap: "NaN" },
    { symbol: "TSLA", name: "  Tesla,   Inc.  Common Stock ", marketCap: "1,500,000,000,000" },
    { symbol: "META", name: "N/A", marketCap: "1,400,000,000,000" },
    { symbol: "SPY", name: "SPDR S&P 500", marketCap: "700,000,000,000" },
];
put("https://api.nasdaq.com/api/screener/stocks?download=true&limit=25000&tableonly=true", { data: { rows } });

// error paths: rate limit text, null optionChain, gateway html, empty result
put(OPT + "ERRA", "Too Many Requests", 429);
put(OPT + "ERRB", { optionChain: null });
put(OPT + "ERRC", "<html>gateway</html>", 502);
for (const e of ["ERRD", "^ERRD"]) put(OPT + e, { optionChain: { result: [], error: null } });

// odd values: missing keys, strings, tiny and huge floats, int strike, missing contractSymbol
const T1 = 1791417600;
const T2 = 1791504000;
const T3 = 1791763200;
const calls = [
    { contractSymbol: "WEIRDA261008C00100000", strike: 100, lastPrice: 1.5, bid: 1.4, ask: 1.6, volume: 10, openInterest: 5, impliedVolatility: 0.00001 },
    { contractSymbol: "WEIRDA261008C00000000", strike: 0, lastPrice: null, bid: 0, ask: 0, openInterest: null, impliedVolatility: 0.5 },
    { strike: 7.0, lastPrice: "2.50", bid: 1, ask: 3, volume: 2, openInterest: 3, impliedVolatility: 1e-7 },
    { contractSymbol: "WEIRDA261008C00200000", strike: 200, lastPrice: 1e16, bid: -1, ask: 2, volume: 1e16, openInterest: 123456789012, impliedVolatility: 123456.789 },
    { contractSymbol: "WEIRDA261008C00300000", strike: 300.5, lastPrice: 0.0001, bid: 0.00012, ask: 0.5, volume: 3, openInterest: 4, impliedVolatility: 2.2832074169921874 },
];
const chain = (sym: string, exps: number[], options: object[]) => ({ optionChain: { result: [{ underlyingSymbol: sym, expirationDates: exps, quote: {}, options }], error: null } });
put(OPT + "WEIRDA", chain("WEIRDA", [T1, T2, T3], [{ expirationDate: T1, calls, puts: [] }]));
put(OPT + `WEIRDA?date=${T1}`, chain("WEIRDA", [T1, T2, T3], [{ expirationDate: T1, calls, puts: [] }]));
put(OPT + `WEIRDA?date=${T2}`, chain("WEIRDA", [T1, T2, T3], [{ expirationDate: T2, calls: [], puts: [] }]));
put(OPT + `WEIRDA?date=${T3}`, chain("WEIRDA", [T1, T2, T3], [{ expirationDate: T3, calls }])); // no puts: KeyError, expiration skipped
put(OPT + "WEIRDB", chain("WEIRDB", [T1], [{ calls, puts: [] }]));
put(OPT + `WEIRDB?date=${T1}`, chain("WEIRDB", [T1], [])); // empty payload: null frames, hard error
put("https://cdn.cboe.com/api/global/delayed_quotes/options/WEIRDA.json", {
    data: {
        options: [
            { option: "weirda261008c00100000", delta: 0.5, gamma: "0.01", theta: null, vega: 0.2, rho: "bad", open_interest: 99, volume: 7.5 },
            { option: "WEIRDA261008C00300000", delta: 0.4, gamma: 0.02, theta: -0.1, vega: 0.1, rho: 0.01, open_interest: null, volume: "x" },
            { option: "WEIRDA261008C00200000", delta: 0.4 },
        ],
    },
});
// chart: two bars on one day (live plus final) and an adjclose that differs from close
const meta = {
    currency: "USD", symbol: "WEIRDA", exchangeName: "NMS", fullExchangeName: "NasdaqGS", instrumentType: "EQUITY",
    firstTradeDate: 728317800, regularMarketTime: 1791489600, hasPrePostMarketData: true, gmtoffset: -14400, timezone: "EDT",
    exchangeTimezoneName: "America/New_York", regularMarketPrice: 10.3, priceHint: 2,
    currentTradingPeriod: {
        pre: { timezone: "EDT", start: 1791446400, end: 1791466200, gmtoffset: -14400 },
        regular: { timezone: "EDT", start: 1791466200, end: 1791489600, gmtoffset: -14400 },
        post: { timezone: "EDT", start: 1791489600, end: 1791504000, gmtoffset: -14400 },
    },
    dataGranularity: "1d", range: "1d", validRanges: ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"],
};
const day = T1 + 13.5 * 3600;
put(CHART + "WEIRDA" + CHART_Q, {
    chart: {
        result: [{ meta, timestamp: [day - 86400, day, day + 3600], indicators: { quote: [{ open: [9, 10, 10], high: [9, 11, 11], low: [8, 9, 9], close: [9, 10.3, 10.37], volume: [5, 6, 7] }], adjclose: [{ adjclose: [8.9, 10.25, 10.31234567891] }] } }],
        error: null,
    },
});
put(CHART + "WEIRDB" + CHART_Q, { chart: { result: null, error: { code: "Not Found", description: "x" } } }, 404);

writeFileSync(process.argv[2], JSON.stringify(out));
