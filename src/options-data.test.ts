/// <reference types="bun" />
/// <reference types="node" />
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PyInt,
  YahooTicker,
  applyCboeRows,
  buildQueue,
  canonical,
  cboeSymbolCandidates,
  cleanCompanyName,
  dedupe,
  expirationLabel,
  fileIsFresh,
  isFreshAt,
  isTradingDay,
  isoWithOffset,
  lastTradingDay,
  mergeAliases,
  mergeUniverse,
  mid,
  normalizeFilesList,
  num,
  parseChartLastClose,
  parseCsvDicts,
  planIndex,
  pyFloatRepr,
  pyJsonDumps,
  pyParseFloat,
  pyParseInt,
  pyQuote,
  resetYahooSession,
  rowsFromChain,
  screenerCap,
  skipIsActive,
  sortedNoOptions,
  symbolVariants,
  tickersOverride,
} from '../scripts/options-data';

const NY = 'America/New_York';
const root = join(import.meta.dir, '..');

describe('python float and json formatting', () => {
  test('pyFloatRepr matches Python repr', () => {
    expect(pyFloatRepr(1)).toBe('1.0');
    expect(pyFloatRepr(0)).toBe('0.0');
    expect(pyFloatRepr(-0)).toBe('-0.0');
    expect(pyFloatRepr(0.0001)).toBe('0.0001');
    expect(pyFloatRepr(0.00001)).toBe('1e-05');
    expect(pyFloatRepr(1.0000000000000003e-5)).toBe('1.0000000000000003e-05');
    expect(pyFloatRepr(1e-7)).toBe('1e-07');
    expect(pyFloatRepr(1e15)).toBe('1000000000000000.0');
    expect(pyFloatRepr(1e16)).toBe('1e+16');
    expect(pyFloatRepr(1.5e300)).toBe('1.5e+300');
    expect(pyFloatRepr(123456789012.0)).toBe('123456789012.0');
    expect(pyFloatRepr(2.2832074169921874)).toBe('2.2832074169921874');
    expect(pyFloatRepr(-12.5)).toBe('-12.5');
  });

  test('pyJsonDumps compact keeps ints and floats apart', () => {
    const doc = { a: 1, b: new PyInt(2), c: null, d: [1.5, true], e: {}, f: [] };
    expect(pyJsonDumps(doc)).toBe('{"a":1.0,"b":2,"c":null,"d":[1.5,true],"e":{},"f":[]}');
  });

  test('pyJsonDumps escapes like ensure_ascii and indents like indent=2', () => {
    expect(pyJsonDumps('é"\\\n\x7f😀')).toBe('"\\u00e9\\"\\\\\\n\\u007f\\ud83d\\ude00"');
    expect(pyJsonDumps({ files: ['A', 'B'], count: new PyInt(2), names: {}, no_options: { X: '2026-01-01' } }, 2)).toBe(
      '{\n  "files": [\n    "A",\n    "B"\n  ],\n  "count": 2,\n  "names": {},\n  "no_options": {\n    "X": "2026-01-01"\n  }\n}',
    );
  });

  test('pyParseFloat and pyParseInt follow Python parsing', () => {
    expect(pyParseFloat(' 1,5')).toBeNull();
    expect(pyParseFloat('1e3')).toBe(1000);
    expect(pyParseFloat('-inf')).toBe(-Infinity);
    expect(Number.isNaN(pyParseFloat('NaN'))).toBe(true);
    expect(pyParseFloat('0x10')).toBeNull();
    expect(pyParseInt(' 12 ')).toBe(12);
    expect(pyParseInt('1_000')).toBe(1000);
    expect(pyParseInt('1.5')).toBeNull();
    expect(pyParseInt('')).toBeNull();
  });

  test('num coerces like _num', () => {
    expect(num(3)).toBe(3);
    expect(num('2.50')).toBe(2.5);
    expect(num(true)).toBe(1);
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num(NaN)).toBeNull();
    expect(num(Infinity)).toBeNull();
    expect(num('nan')).toBeNull();
    expect(num('bad')).toBeNull();
    expect(num({})).toBeNull();
  });

  test('mid needs two positive sides', () => {
    expect(mid(1, 2)).toBe(1.5);
    expect(mid(0, 2)).toBeNull();
    expect(mid(null, 2)).toBeNull();
  });
});

describe('symbols', () => {
  test('canonical rewrites class-share separators and honors aliases', () => {
    expect(canonical('brk.b')).toBe('BRK-B');
    expect(canonical('BRK/B')).toBe('BRK-B');
    expect(canonical('BRKB')).toBe('BRK-B');
    expect(canonical(' aapl ')).toBe('AAPL');
    expect(canonical('FOO.X', { 'FOO.X': 'BAR' })).toBe('BAR');
    expect(canonical('A.B/C')).toBe('A-B-C');
  });

  test('mergeAliases reads SCREENER=YAHOO pairs', () => {
    const into: Record<string, string> = {};
    mergeAliases('foo.a = bar-a, junk, =x, y=,Z=Q', into);
    expect(into).toEqual({ 'FOO.A': 'BAR-A', Z: 'Q' });
  });

  test('symbolVariants order for plain, class-share and index tickers', () => {
    expect(symbolVariants('AAPL')).toEqual(['AAPL', '^AAPL']);
    expect(symbolVariants('SPX')).toEqual(['SPX', '^SPX']);
    expect(symbolVariants('BRK-B')).toEqual(['BRK-B', 'BRK.B', 'BRK/B', 'BRKB', '^BRKB', '^BRK-B']);
    expect(symbolVariants('brk.b')).toEqual(['BRK-B', 'BRK.B', 'BRK/B', 'BRKB', '^BRKB', '^BRK.B']);
  });

  test('dedupe keeps order and drops falsy values', () => {
    expect(dedupe(['A', '', 'B', 'A', 'C', 'B'])).toEqual(['A', 'B', 'C']);
  });

  test('cleanCompanyName normalizes whitespace and placeholders', () => {
    expect(cleanCompanyName('  Tesla,   Inc.  Common Stock ')).toBe('Tesla, Inc. Common Stock');
    expect(cleanCompanyName('N/A')).toBe('');
    expect(cleanCompanyName(null)).toBe('');
    expect(cleanCompanyName('NaN')).toBe('');
  });

  test('cboeSymbolCandidates puts the underscore index form first', () => {
    expect(cboeSymbolCandidates('SPX', '^SPX')).toEqual(['_SPX', 'SPX']);
    expect(cboeSymbolCandidates('BRK-B', 'BRK-B')).toEqual(['BRK-B', 'BRK.B', 'BRK/B', 'BRKB']);
    expect(cboeSymbolCandidates('AAPL')).toEqual(['AAPL']);
  });

  test('pyQuote matches urllib quote with safe empty', () => {
    expect(pyQuote('BRK/B')).toBe('BRK%2FB');
    expect(pyQuote('_SPX')).toBe('_SPX');
    expect(pyQuote("a b!'()*")).toBe('a%20b%21%27%28%29%2A');
  });

  test('tickersOverride splits commas and spaces, canonicalizes and dedupes', () => {
    expect(tickersOverride({ TICKERS: 'aapl, brk.b  AAPL' })).toEqual(['AAPL', 'BRK-B']);
    expect(tickersOverride({ TICKER: 'spy' })).toEqual(['SPY']);
    expect(tickersOverride({ TICKERS: '' })).toBeNull();
    expect(tickersOverride({})).toBeNull();
  });
});

describe('working days and freshness (market timezone)', () => {
  test('isTradingDay skips weekends and listed holidays', () => {
    expect(isTradingDay({ year: 2026, month: 10, day: 8 })).toBe(true); // Thursday
    expect(isTradingDay({ year: 2026, month: 10, day: 10 })).toBe(false); // Saturday
    expect(isTradingDay({ year: 2026, month: 11, day: 26 })).toBe(false); // Thanksgiving
    expect(lastTradingDay({ year: 2026, month: 10, day: 11 })).toEqual({ year: 2026, month: 10, day: 9 });
    expect(lastTradingDay({ year: 2026, month: 11, day: 27 })).toEqual({ year: 2026, month: 11, day: 27 });
  });

  test('fileIsFresh follows the original business rule', () => {
    const sat = new Date('2026-10-10T16:00:00Z');
    expect(fileIsFresh('2026-10-10T09:00:00-04:00', sat, NY)).toBe(true); // today
    expect(fileIsFresh('2026-10-09T09:00:00-04:00', sat, NY)).toBe(true); // last trading day
    expect(fileIsFresh('2026-10-08T09:00:00-04:00', sat, NY)).toBe(false);
    const thu = new Date('2026-10-08T16:00:00Z');
    expect(fileIsFresh('2026-10-07T09:00:00-04:00', thu, NY)).toBe(false);
  });

  test('isFreshAt is only fresh inside the weekend dead zone, after Friday 20:00', () => {
    const friNight = new Date('2026-10-10T01:00:00Z'); // Fri 21:00 EDT
    expect(isFreshAt('2026-10-09T20:30:00-04:00', friNight, NY)).toBe(true);
    expect(isFreshAt('2026-10-09T19:59:00-04:00', friNight, NY)).toBe(false);
    const sunNoon = new Date('2026-10-11T16:00:00Z'); // Sun 12:00 EDT
    expect(isFreshAt('2026-10-10T08:00:00-04:00', sunNoon, NY)).toBe(true);
    const sun18 = new Date('2026-10-11T22:00:00Z'); // Sun 18:00 EDT, end is exclusive
    expect(isFreshAt('2026-10-10T08:00:00-04:00', sun18, NY)).toBe(false);
    const wed = new Date('2026-10-07T16:00:00Z');
    expect(isFreshAt('2026-10-07T11:00:00-04:00', wed, NY)).toBe(false);
    expect(isFreshAt('', wed, NY)).toBe(false);
    expect(isFreshAt('garbage', wed, NY)).toBe(false);
  });

  test('isFreshAt treats naive timestamps as UTC', () => {
    const friNight = new Date('2026-10-10T01:00:00Z');
    expect(isFreshAt('2026-10-10T00:30:00', friNight, NY)).toBe(true); // 20:30 EDT
    expect(isFreshAt('2026-10-09T23:00:00', friNight, NY)).toBe(false); // 19:00 EDT
  });

  test('skipIsActive honors the re-check window', () => {
    const now = new Date('2026-10-08T16:00:00Z');
    expect(skipIsActive('2026-10-01', 30, now)).toBe(true);
    expect(skipIsActive('2026-09-08', 30, now)).toBe(false); // exactly 30 days
    expect(skipIsActive('2026-09-09', 30, now)).toBe(true);
    expect(skipIsActive('nonsense', 30, now)).toBe(false);
    expect(skipIsActive('2026-02-31', 30, now)).toBe(false);
  });

  test('isoWithOffset writes the market offset and drops zero fractions', () => {
    expect(isoWithOffset(new Date('2026-07-10T18:32:05.000Z'), NY)).toBe('2026-07-10T14:32:05-04:00');
    expect(isoWithOffset(new Date('2026-01-10T18:32:05.120Z'), NY)).toBe('2026-01-10T13:32:05.120000-05:00');
    expect(isoWithOffset(new Date('2026-01-10T18:32:05.000Z'), 'UTC')).toBe('2026-01-10T18:32:05+00:00');
    expect(isoWithOffset(new Date('2026-01-10T18:32:05.000Z'), 'Asia/Kolkata')).toBe('2026-01-11T00:02:05+05:30');
  });
});

describe('work queue', () => {
  const base = {
    skip: {},
    explicit: false,
    isFresh: () => false,
    updatedOf: () => '',
    skipActive: () => true,
  };

  test('missing symbols come first in universe order, then stale oldest first', () => {
    const updated: Record<string, string> = { A: '2026-10-03T00:00:00-04:00', B: '2026-10-01T00:00:00-04:00', C: '2026-10-02T00:00:00-04:00' };
    const q = buildQueue(['Z', 'A', 'Y', 'X'], { ...base, cached: ['A', 'B', 'C'], updatedOf: (s) => updated[s] ?? '' });
    expect(q.queue).toEqual(['Z', 'Y', 'X', 'B', 'C', 'A']);
    expect([q.nMissing, q.nStale, q.nFresh]).toEqual([3, 3, 0]);
  });

  test('active skiplist entries are not queued as missing, expired ones are', () => {
    const skip = { DEAD: '2026-10-07', OLD: '2026-01-01' };
    const q = buildQueue(['DEAD', 'OLD', 'NEW'], {
      ...base,
      cached: [],
      skip,
      skipActive: (d) => d === '2026-10-07',
    });
    expect(q.queue).toEqual(['OLD', 'NEW']);
  });

  test('fresh files are skipped and counted', () => {
    const q = buildQueue([], { ...base, cached: ['A', 'B'], isFresh: (s) => s === 'A', updatedOf: () => 'x' });
    expect(q.queue).toEqual(['B']);
    expect(q.nFresh).toBe(1);
  });

  test('without an explicit list every cached file is a refresh candidate, with it only the universe', () => {
    const d = { ...base, cached: ['A', 'B'], updatedOf: (s: string) => (s === 'A' ? '2' : '1') };
    expect(buildQueue(['A'], d).queue).toEqual(['B', 'A']);
    expect(buildQueue(['A'], { ...d, explicit: true }).queue).toEqual(['A']);
  });

  test('undated files sort first and ties keep a stable order', () => {
    const q = buildQueue([], { ...base, cached: ['C', 'B', 'A'], updatedOf: (s) => (s === 'B' ? '' : '2026') });
    expect(q.queue).toEqual(['B', 'A', 'C']);
  });
});

describe('universe', () => {
  test('mergeUniverse keeps NASDAQ order for optionable symbols and appends Cboe-only names', () => {
    expect(mergeUniverse(['NVDA', 'ZZZ', 'AAPL'], ['AAPL', 'NVDA', 'SPY'], 100)).toEqual(['NVDA', 'AAPL', 'SPY']);
    expect(mergeUniverse(['NVDA', 'AAPL'], [], 1)).toEqual(['NVDA']);
    expect(mergeUniverse([], ['SPY', 'AAPL'], 100).slice(0, 3)).toEqual(['AAPL', 'MSFT', 'NVDA']);
    expect(mergeUniverse([], [], 2)).toEqual(['AAPL', 'MSFT']);
    expect(mergeUniverse([], [], 100)).toContain('BRK-B');
  });

  test('screenerCap parses like float(str.replace) with ValueError -> 0', () => {
    expect(screenerCap({ marketCap: '3,000,000' })).toBe(3000000);
    expect(screenerCap({ marketCap: '' })).toBe(0);
    expect(screenerCap({})).toBe(0);
    expect(screenerCap({ marketCap: null })).toBe(0);
    expect(screenerCap({ marketCap: 'N/A' })).toBe(0);
    expect(Number.isNaN(screenerCap({ marketCap: 'NaN' }))).toBe(true);
  });

  test('parseCsvDicts handles quotes, embedded commas, CRLF and short rows', () => {
    const rows = parseCsvDicts('Symbol,Company,X\r\nAAA,"Foo, Inc ""A""",1\r\nBBB,Bar\r\n\r\nCCC,"multi\nline",3');
    expect(rows).toEqual([
      { Symbol: 'AAA', Company: 'Foo, Inc "A"', X: '1' },
      { Symbol: 'BBB', Company: 'Bar' },
      { Symbol: 'CCC', Company: 'multi\nline', X: '3' },
    ]);
  });
});

describe('index manifest', () => {
  const names = new Map<string, string>();

  test('normalizeFilesList reads legacy maps and lists', () => {
    expect(normalizeFilesList({ B: 'x', A: 'y' })).toEqual(['A', 'B']);
    expect(normalizeFilesList(['B', 'A', 'B'])).toEqual(['A', 'B']);
    expect(normalizeFilesList(null)).toEqual([]);
  });

  test('sortedNoOptions sorts keys', () => {
    expect(Object.keys(sortedNoOptions({ B: '1', A: '2' }))).toEqual(['A', 'B']);
  });

  test('unchanged manifest is not rewritten', () => {
    const prev = { files: ['A', 'B'], count: 2, names: { A: 'Alpha' }, no_options: { Z: '2026-10-01' } };
    expect(planIndex(['B', 'A'], prev, { Z: '2026-10-01' }, names)).toBeNull();
    expect(planIndex(['A', 'B'], prev, null, names)).toBeNull();
  });

  test('changed tickers, names or skiplist rewrite it with the exact shape', () => {
    const prev = { files: ['A'], count: 1, names: {}, no_options: {} };
    const p = planIndex(['A', 'B'], prev, { Z: '2026-10-01' }, new Map([['B', ' Beta  Corp '], ['Z', 'None'], ['Q', 'Not wanted']]));
    expect(p).not.toBeNull();
    expect(pyJsonDumps(p, 2)).toBe(
      '{\n  "files": [\n    "A",\n    "B"\n  ],\n  "count": 2,\n  "names": {\n    "B": "Beta Corp"\n  },\n  "no_options": {\n    "Z": "2026-10-01"\n  }\n}',
    );
  });

  test('previous names survive when the run discovered none', () => {
    const prev = { files: ['A'], count: 1, names: { A: 'Alpha' }, no_options: {} };
    const p = planIndex(['A', 'B'], prev, {}, names);
    expect(p?.names).toEqual({ A: 'Alpha' });
  });

  test('legacy shapes force one rewrite', () => {
    expect(planIndex(['A'], { files: { A: '2026-01-01' }, count: 1, names: {}, no_options: {} }, {}, names)).not.toBeNull();
    expect(planIndex(['A'], { generated: 'x', files: ['A'], count: 1, names: {}, no_options: {} }, {}, names)).not.toBeNull();
    expect(planIndex(['A'], {}, {}, names)).not.toBeNull();
  });

  test('names never fall back to a cleaned-away placeholder', () => {
    const p = planIndex(['A'], { files: [], names: { A: 'N/A' } }, {}, names);
    expect(p?.names).toEqual({});
  });
});

describe('quote rows and Cboe overlay', () => {
  const calls = [
    { contractSymbol: 'X261008C00100000', strike: 100, lastPrice: 1.5, bid: 1.4, ask: 1.6, volume: 10, openInterest: 5, impliedVolatility: 0.00001 },
    { strike: 0, bid: 0, ask: 0 },
  ];

  test('rowsFromChain keeps the Python key order, ints only for a missing strike', () => {
    const rows = rowsFromChain(calls, '2026-10-08', 'call');
    expect(Object.keys(rows[0])).toEqual([
      'symbol', 'expiration', 'side', 'strike', 'bid', 'ask', 'mid', 'last', 'volume', 'openInterest', 'iv',
      'delta', 'gamma', 'theta', 'vega', 'rho', 'greeksSource', 'greeksMissingReason',
    ]);
    expect(pyJsonDumps(rows[0])).toContain('"strike":100.0,"bid":1.4,"ask":1.6,"mid":1.5,"last":1.5,"volume":10.0,"openInterest":5.0,"iv":1e-05');
    expect(rows[1].symbol).toBe('nan');
    expect(rows[1].strike).toBeInstanceOf(PyInt);
    expect(rows[1].mid).toBeNull();
    expect(rows[1].greeksMissingReason).toBe('not_enriched');
  });

  test('applyCboeRows overlays greeks, open interest and volume and counts stats', () => {
    const quotes = rowsFromChain(calls, '2026-10-08', 'call');
    quotes.push(...rowsFromChain([{ contractSymbol: 'X261008P00100000', strike: 100 }], '2026-10-08', 'put'));
    const cboe = new Map<string, Record<string, unknown>>([
      ['X261008C00100000', { option: 'x261008c00100000', delta: 0.5, gamma: '0.01', theta: null, vega: 0.2, rho: 'bad', open_interest: 99, volume: 7.5 }],
      ['X261008P00100000', { delta: 0.4 }],
    ]);
    const stats = applyCboeRows(quotes, cboe, true);
    expect(quotes[0]).toMatchObject({ delta: 0.5, gamma: 0.01, theta: null, vega: 0.2, rho: null, openInterest: 99, volume: 7.5, greeksSource: 'cboe', greeksMissingReason: null });
    expect(quotes[1].greeksMissingReason).toBe('cboe_unmatched');
    expect(quotes[2]).toMatchObject({ delta: 0.4, gamma: null, greeksSource: null, greeksMissingReason: 'cboe_unmatched' });
    expect(pyJsonDumps(stats)).toBe(
      '{"enabled":true,"primarySource":"cboe","fallbackSource":"client-black-scholes","riskFreeRate":null,"dividendYield":null,"total":3,"cboeMatched":1,"computed":0,"missing":2,"cboeContracts":2}',
    );
  });

  test('missing reason distinguishes disabled, unavailable and unmatched', () => {
    const q = () => rowsFromChain([{ contractSymbol: 'A' }], 'e', 'call');
    const a = q();
    applyCboeRows(a, new Map(), true);
    expect(a[0].greeksMissingReason).toBe('cboe_unavailable');
    const b = q();
    const stats = applyCboeRows(b, new Map(), false);
    expect(b[0].greeksMissingReason).toBe('cboe_disabled');
    expect(stats.primarySource).toBeNull();
  });
});

describe('Yahoo parsing', () => {
  test('expirationLabel is the UTC date', () => {
    expect(expirationLabel(1791417600)).toBe('2026-10-08');
    expect(expirationLabel(1791503999)).toBe('2026-10-08');
  });

  const meta = { exchangeTimezoneName: 'America/New_York' };
  const chart = (timestamp: number[], q: Record<string, Array<number | null>>, adj?: Array<number | null>) => ({
    chart: { result: [{ meta, timestamp, indicators: { quote: [q], ...(adj ? { adjclose: [{ adjclose: adj }] } : {}) } }], error: null },
  });

  test('parseChartLastClose returns the adjusted close of the last bar', () => {
    const t = 1791489600;
    expect(parseChartLastClose(chart([t], { open: [1], high: [2], low: [1], close: [773.93], volume: [5] }, [773.93]))).toBe(773.93);
    expect(parseChartLastClose(chart([t], { open: [1], high: [2], low: [1], close: [10], volume: [5] }, [9.5]))).toBe(9.5);
    expect(parseChartLastClose(chart([t], { open: [1], high: [2], low: [1], close: [10], volume: [5] }))).toBe(10);
  });

  test('two bars on the same exchange day keep only the last one', () => {
    const t = 1791489600;
    const c = chart([t - 100, t], { open: [1, 1], high: [2, 2], low: [1, 1], close: [10, 11], volume: [5, 6] }, [10, 11]);
    expect(parseChartLastClose(c)).toBe(11);
    const prevDay = chart([t - 86400, t], { open: [1, 1], high: [2, 2], low: [1, 1], close: [10, 11], volume: [5, 6] }, [10, 11]);
    expect(parseChartLastClose(prevDay)).toBe(11);
  });

  test('all-empty rows and error payloads give null', () => {
    const t = 1791489600;
    expect(parseChartLastClose(chart([t], { open: [null], high: [null], low: [null], close: [null], volume: [null] }, [null]))).toBeNull();
    expect(parseChartLastClose(chart([t], { open: [0], high: [0], low: [0], close: [0], volume: [0] }, [0]))).toBeNull();
    expect(parseChartLastClose({ chart: { result: null, error: { code: 'Not Found' } } })).toBeNull();
    expect(parseChartLastClose(null)).toBeNull();
    expect(parseChartLastClose({ chart: { result: [{ indicators: { quote: [{}] } }] } })).toBeNull();
  });
});

describe('YahooTicker over a mocked network', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    resetYahooSession();
  });

  function mockYahoo(routes: Record<string, (url: string) => { status?: number; body: unknown }>): string[] {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://fc.yahoo.com')) return new Response('', { status: 404, headers: { 'set-cookie': 'A3=x; Path=/' } });
      if (url.includes('getcrumb')) return new Response('CRUMB');
      seen.push(url);
      const hit = Object.entries(routes).find(([k]) => url.includes(k));
      if (!hit) return new Response('no route', { status: 500 });
      const r = hit[1](url);
      return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
    }) as typeof fetch;
    return seen;
  }

  const T1 = 1791417600;
  const T2 = 1791504000;
  const list = (extra: object) => ({ optionChain: { result: [{ expirationDates: [T1, T2], quote: {}, ...extra }], error: null } });

  test('options() lists labelled expirations once and sends the crumb', async () => {
    const seen = mockYahoo({ '/v7/finance/options/SPY': () => ({ body: list({ options: [{ calls: [], puts: [] }] }) }) });
    const t = new YahooTicker('SPY');
    expect(await t.options()).toEqual(['2026-10-08', '2026-10-09']);
    expect(await t.options()).toEqual(['2026-10-08', '2026-10-09']);
    expect(seen).toEqual(['https://query2.finance.yahoo.com/v7/finance/options/SPY?crumb=CRUMB']);
  });

  test('an empty result means no options, a null optionChain is an error', async () => {
    mockYahoo({ '/options/NONE': () => ({ body: { optionChain: { result: [], error: null } } }), '/options/BAD': () => ({ body: { optionChain: null } }) });
    expect(await new YahooTicker('NONE').options()).toEqual([]);
    await expect(new YahooTicker('BAD').options()).rejects.toThrow();
  });

  test('optionChain requests the unix date and returns raw rows', async () => {
    const calls = [{ contractSymbol: 'A' }];
    const seen = mockYahoo({
      '?date=': () => ({ body: list({ options: [{ calls, puts: [] }] }) }),
      '/options/SPY': () => ({ body: list({ options: [{ calls: [], puts: [] }] }) }),
    });
    const t = new YahooTicker('SPY');
    await t.options();
    expect(await t.optionChain('2026-10-09')).toEqual({ calls, puts: [] });
    expect(seen[1]).toBe(`https://query2.finance.yahoo.com/v7/finance/options/SPY?date=${T2}&crumb=CRUMB`);
  });

  test('empty option payload gives null frames, a missing side is a KeyError', async () => {
    mockYahoo({ '?date=': () => ({ body: list({ options: [] }) }), '/options/E': () => ({ body: list({ options: [] }) }) });
    const t = new YahooTicker('E');
    await t.options();
    expect(await t.optionChain('2026-10-08')).toEqual({ calls: null, puts: null });
    mockYahoo({ '?date=': () => ({ body: list({ options: [{ calls: [] }] }) }), '/options/F': () => ({ body: list({ options: [] }) }) });
    const f = new YahooTicker('F');
    await f.options();
    await expect(f.optionChain('2026-10-08')).rejects.toThrow("'puts'");
  });

  test('lastClose never throws and reads the 1d chart', async () => {
    const seen = mockYahoo({
      '/chart/OK': () => ({
        body: { chart: { result: [{ meta: { exchangeTimezoneName: 'UTC' }, timestamp: [1791489600], indicators: { quote: [{ open: [1], high: [1], low: [1], close: [5], volume: [1] }] } }], error: null } },
      }),
      '/chart/BAD': () => ({ status: 404, body: { chart: { result: null, error: { code: 'Not Found' } } } }),
    });
    expect(await new YahooTicker('OK').lastClose()).toBe(5);
    expect(await new YahooTicker('BAD').lastClose()).toBeNull();
    expect(seen[0]).toContain('/v8/finance/chart/OK?range=1d&interval=1d&includePrePost=false&events=div%2Csplits%2CcapitalGains');
  });

  test('HTTP 429 raises a rate-limit error after one retry with a fresh session', async () => {
    const seen = mockYahoo({ '/options/RL': () => ({ status: 429, body: 'Too Many Requests' }) });
    await expect(new YahooTicker('RL').options()).rejects.toThrow('Too Many Requests');
    expect(seen.length).toBe(2);
  });
});

describe('repo wiring', () => {
  test('the script is executable with a bun shebang and writes under data/options', () => {
    const src = readFileSync(join(root, 'scripts/options-data.ts'), 'utf8');
    expect(src.startsWith('#!/usr/bin/env bun\n')).toBe(true);
    expect(src).toContain('"data", "options"');
    expect(existsSync(join(root, 'scripts/options-data.py'))).toBe(true);
  });
});
