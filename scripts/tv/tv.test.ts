/// <reference types="node" />
/// <reference types="bun" />
// Offline tests of the TradingView futures scripts over recorded, redacted fixtures (no network, no session).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeGexLevels } from '../../src/gex';
import { setValuationTime } from '../../src/greeks';
import { chainFromCacheFile } from '../../src/providers/cache';
import { rowsFromChain } from '../options-data';
import {
    allocateSessions, buildPayload, familiesOf, futuresPrice, isThirdFriday, MAX_EXPIRATIONS, optionSymbol, parseScan, payloadText, pickSeries, QUOTE_SESSION_LIMIT, SCAN_PAGE, scanBody, scanGreeks, strikesInWindow,
    TV_SCAN, TvRateLimitError, wantedOptions, type Family, type QuoteValues, type ScanRow, type WantedOption,
} from './chain';
import { cookieHeader, jwtExpiresAt, parseEnv, redact } from './env';
import { AUTH_REFRESH_BEFORE_MS, DEFAULT_REFRESH_MS, DEFAULT_WATCH_MS, FuturesWatcher, parseArgs, parseDuration, RATE_LIMIT_BACKOFF_MS, RATE_LIMIT_MAX_MS, rateLimitPauseMs, renewDueAt } from './futures';
import { authTokenFromPage, decodeFrames, encodeFrame, fetchAuthToken, TV_HTTP, type TvMessage } from './ws';

const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

// the recorded data is of Sunday 2026-10-25 (expirations from 2026-10-26): price it at that time, not at the real clock
const RECORDED_AT = new Date('2026-10-25T14:00:00Z');
beforeAll(() => setValuationTime(RECORDED_AT.getTime()));
afterAll(() => setValuationTime(null));

/** A fake JWT (header {"alg":"none"}, payload {"exp": exp}); not a real token. */
function fakeJwt(exp: number): string {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ exp, plan: 'test' })}.c2lnbmF0dXJlLW5vdC1yZWFs`;
}

describe('websocket frames', () => {
    test('round trip, glued frames and heartbeats', () => {
        expect(decodeFrames(encodeFrame('{"m":"x","p":[]}') + encodeFrame('~h~7'))).toEqual(['{"m":"x","p":[]}', '~h~7']);
        expect(decodeFrames('garbage')).toEqual([]);
    });

    test('the recorded quote carries oi {time, value} and volume (E4A 2026-10-26 C7630: OI 23, volume 123)', () => {
        const msgs = fx('ws-quote-E4A261026C7630.txt').split('\n').filter(Boolean).flatMap(decodeFrames).map((p) => JSON.parse(p) as TvMessage);
        const v: QuoteValues = {};
        msgs.filter((m) => m.m === 'qsd' && (m.p[1] as { n: string }).n === 'CME_MINI:E4A261026C7630').forEach((m) => Object.assign(v, (m.p[1] as { v: QuoteValues }).v));
        expect((v.oi as { value: number }).value).toBe(23);
        expect(v.volume).toBe(123);
        expect(v.update_mode).toBe('streaming');
        expect(msgs.some((m) => m.m === 'quote_completed' && m.p[1] === 'CME_MINI:E4A261026C7630')).toBe(true);
    });

    test('auth token from the page', () => {
        expect(authTokenFromPage('x "auth_token":"abc.def.ghi" y')).toBe('abc.def.ghi');
        expect(authTokenFromPage('<html>anonymous</html>')).toBeNull();
    });
});

describe('secrets', () => {
    test('env parsing', () => {
        expect(parseEnv('# c\nTV_SESSIONID="abc"\nTV_SESSIONID_SIGN=v3:x=\n\nBROKEN\n')).toEqual({ TV_SESSIONID: 'abc', TV_SESSIONID_SIGN: 'v3:x=' });
    });

    test('redaction of the session values and of any JWT', () => {
        const s = { sessionid: 'abc123', sessionidSign: 'v3:sig' };
        expect(redact(`Cookie: ${cookieHeader(s)}`, s)).toBe('Cookie: sessionid=<REDACTED_SESSIONID>; sessionid_sign=<REDACTED_SESSIONID_SIGN>');
        expect(redact(`token ${fakeJwt(1)} end`, null)).toBe('token <REDACTED_JWT> end');
    });

    test('token expiry is read from the exp claim only', () => {
        expect(jwtExpiresAt(fakeJwt(1792800000))).toBe(1792800000 * 1000);
        expect(jwtExpiresAt('not-a-token')).toBeNull();
        expect(jwtExpiresAt(null)).toBeNull();
    });
});

const fam = (name: string, series: [number, string, number[]][]): Family => ({
    name, prefix: 'CME_MINI', series: series.map(([exp, underlying, strikes]) => ({ exp, expTime: `${String(exp).slice(0, 4)}-${String(exp).slice(4, 6)}-${String(exp).slice(6)}T15:00:00-05:00`, root: name, strikes, underlying })),
});

describe('option window', () => {
    test('option symbol format', () => {
        expect(optionSymbol('CME_MINI', 'E4A', 20261026, 'call', 7630)).toBe('CME_MINI:E4A261026C7630');
        expect(optionSymbol('CBOT_MINI', 'EYM', 20261030, 'put', 51400)).toBe('CBOT_MINI:EYM261030P51400');
    });

    test('strikes within +/- the window of the forward', () => {
        expect(strikesInWindow([90, 94, 95, 100, 105, 106, 110], 100, 0.05)).toEqual([95, 100, 105]);
    });

    test('nearest open expirations of the front contract only, every family of a date', () => {
        const families = [
            fam('E4A', [[20261026, 'CME_MINI:ESZ2026', [7600]]]),
            fam('EW3', [[20261218, 'CME_MINI:ESH2027', [7600]]]),
            fam('E4B', [[20261027, 'CME_MINI:ESZ2026', [7600]]]),
            fam('EW', [[20261030, 'CME_MINI:ESZ2026', [7600]]]),
            fam('EW4', [[20261030, 'CME_MINI:ESZ2026', [7600]]]),
            fam('E3D', [[20261022, 'CME_MINI:ESZ2026', [7600]]]),
        ];
        const now = new Date('2026-10-25T12:00:00Z');
        expect(pickSeries(families, 'CME_MINI:ESZ2026', now, 2).map((x) => `${x.series.root}@${x.series.exp}`)).toEqual(['E4A@20261026', 'E4B@20261027']);
        expect(pickSeries(families, 'CME_MINI:ESZ2026', now, 3).map((x) => x.series.root)).toEqual(['E4A', 'E4B', 'EW', 'EW4']);
    });

    test('isThirdFriday: the standard monthly day', () => {
        expect(isThirdFriday(20261120)).toBe(true);
        expect(isThirdFriday(20261218)).toBe(true);
        expect(isThirdFriday(20261016)).toBe(true);
        expect(isThirdFriday(20261113)).toBe(false); // 2nd Friday
        expect(isThirdFriday(20261127)).toBe(false); // 4th Friday
        expect(isThirdFriday(20261119)).toBe(false); // a Thursday
    });

    test('default coverage: every date up to and including the nearest monthly (owner 2026-10-25)', () => {
        const families = [
            fam('E4A', [[20261026, 'CME_MINI:ESZ2026', [7600]], [20261123, 'CME_MINI:ESZ2026', [7600]]]),
            fam('EW', [[20261030, 'CME_MINI:ESZ2026', [7600]]]),
            fam('EW1', [[20261106, 'CME_MINI:ESZ2026', [7600]]]),
            fam('EW2', [[20261113, 'CME_MINI:ESZ2026', [7600]]]),
            fam('E3D', [[20261119, 'CME_MINI:ESZ2026', [7600]]]),
            fam('EW3', [[20261120, 'CME_MINI:ESZ2026', [7600]], [20261218, 'CME_MINI:ESH2027', [7600]]]),
            fam('ES', [[20261218, 'CME_MINI:ESZ2026', [7600]]]),
        ];
        const dates = (now: string) => pickSeries(families, 'CME_MINI:ESZ2026', new Date(now)).map((x) => x.series.exp);
        // Sunday 2026-10-25: through Friday 2026-11-20 (EW3), not the 11-23 Monday after it
        expect(dates('2026-10-25T12:00:00Z')).toEqual([20261026, 20261030, 20261106, 20261113, 20261119, 20261120]);
        // after the November monthly expired: the December quarterly (ES) of the same front contract is the next monthly
        expect(dates('2026-11-21T12:00:00Z')).toEqual([20261123, 20261218]);
        // an explicit max still means the nearest N dates (tv:check uses 1)
        expect(pickSeries(families, 'CME_MINI:ESZ2026', new Date('2026-10-25T12:00:00Z'), 1).map((x) => x.series.exp)).toEqual([20261026]);
    });

    test('no third Friday on the contract: the nearest MAX_EXPIRATIONS dates', () => {
        const families = [fam('EW', [[20261030, 'CME_MINI:ESZ2026', [1]], [20261130, 'CME_MINI:ESZ2026', [1]]]), fam('E4A', [[20261026, 'CME_MINI:ESZ2026', [1]]]), fam('EW1', [[20261106, 'CME_MINI:ESZ2026', [1]]]), fam('EW2', [[20261113, 'CME_MINI:ESZ2026', [1]]])];
        expect(pickSeries(families, 'CME_MINI:ESZ2026', new Date('2026-10-25T12:00:00Z')).map((x) => x.series.exp)).toEqual([20261026, 20261030, 20261106, 20261113].slice(0, MAX_EXPIRATIONS));
    });

    test('wanted options: calls and puts of the window', () => {
        const w = wantedOptions([fam('E4A', [[20261026, 'CME_MINI:ESZ2026', [7000, 7600, 7650, 7700, 8500]]])], 'CME_MINI:ESZ2026', 7650, new Date('2026-10-25T12:00:00Z'));
        expect(w.map((x) => x.symbol)).toEqual(['CME_MINI:E4A261026C7600', 'CME_MINI:E4A261026P7600', 'CME_MINI:E4A261026C7650', 'CME_MINI:E4A261026P7650', 'CME_MINI:E4A261026C7700', 'CME_MINI:E4A261026P7700']);
    });

    test('families of a malformed options-info are empty, not a throw', () => {
        expect(familiesOf(undefined)).toEqual([]);
        expect(familiesOf({ 'options-info': { families: 'x' } })).toEqual([]);
    });

    test('futures price: tight mid, else last', () => {
        expect(futuresPrice({ bid: 7672, ask: 7672.5, lp: 7659.75 })).toEqual({ price: 7672.25, source: 'mid' });
        expect(futuresPrice({ bid: 52000, ask: 53000, lp: 52394 })).toEqual({ price: 52394, source: 'last' });
        expect(futuresPrice({})).toBeNull();
    });
});

describe('scanner', () => {
    test('one request covering the expirations and strikes of the window', () => {
        const wanted: WantedOption[] = [
            { symbol: 'CME_MINI:E4A261026C7600', root: 'E4A', exp: 20261026, side: 'call', strike: 7600 },
            { symbol: 'CME_MINI:E4B261027P7700', root: 'E4B', exp: 20261027, side: 'put', strike: 7700 },
        ];
        const body = scanBody('CME_MINI:ESZ2026', wanted) as { filter: { left: string; right: unknown }[]; index_filters: unknown[] };
        expect(body.filter.map((f) => [f.left, f.right])).toEqual([['type', 'option'], ['expiration', [20261026, 20261027]], ['strike', [7600, 7700]]]);
        expect(body.index_filters).toEqual([{ name: 'underlying_symbol', values: ['CME_MINI:ESZ2026'] }]);
    });

    test('rows by name, nulls kept as null', () => {
        const rows = parseScan({ totalCount: 1, symbols: [{ s: 'CME_MINI:E4A261026C7630', f: ['E4A261026C7630', 'call', 7630, 20261026, 'E4A', 0.1125, 0.71, 0.0044, null, 'x', -1] }, { f: [] }] });
        expect(Array.from(rows.keys())).toEqual(['E4A261026C7630']);
        expect(rows.get('E4A261026C7630')).toEqual({ name: 'E4A261026C7630', iv: 0.1125, delta: 0.71, gamma: 0.0044, theta: null, vega: null, rho: -1 });
        expect(parseScan(null).size).toBe(0);
    });
});

describe('the cache file', () => {
    const now = RECORDED_AT;
    const w = (side: 'call' | 'put', strike: number, exp = 20261026): WantedOption => ({ symbol: optionSymbol('CME_MINI', 'E4A', exp, side, strike), root: 'E4A', exp, side, strike });
    const g = (name: string, gamma: number | null): [string, ScanRow] => [name, { name, iv: 0.12, delta: 0.5, gamma, theta: null, vega: null, rho: null }];
    // parity: C - P at 7650 = 22.5 -> forward ~ 7672.5 (discounting is tiny for one day)
    const wanted = [w('call', 7650), w('put', 7650), w('call', 7700), w('put', 7700), w('call', 7750)];
    const values = new Map<string, QuoteValues>([
        [wanted[0].symbol, { bid: 40, ask: 41, lp: 40.5, volume: 10, oi: { time: 1, value: 100 }, update_mode: 'streaming' }],
        [wanted[1].symbol, { bid: 17.5, ask: 18.5, volume: 20, oi: { time: 1, value: 300 } }],
        [wanted[2].symbol, { bid: 14, ask: 15 }],
        [wanted[3].symbol, { bid: 41, ask: 42, oi: { time: 1, value: 50 } }],
        [wanted[4].symbol, { bid: 3, ask: 3.5 }],
    ]);
    const greeks = new Map<string, ScanRow>([g('E4A261026C7650', 0.004), g('E4A261026P7650', 0.004), g('E4A261026C7700', 0.0035), g('E4A261026P7700', null)]);
    const input = {
        root: 'ES', wanted, values, failed: new Set([wanted[4].symbol]), completed: new Set([wanted[2].symbol]), greeks,
        futures: { price: 7672.25, source: 'mid' as const }, now,
    };

    test('exactly the keys of the fetcher, in its order, and no forward field', () => {
        const { payload } = buildPayload(input);
        expect(Object.keys(payload)).toEqual(['symbol', 'updated', 'date', 'underlyingPrice', 'greeks', 'expirations', 'quotes']);
        const fetcherQuote = rowsFromChain([{ contractSymbol: 'X', strike: 1, bid: 1, ask: 2 }], '2026-10-26', 'call')[0];
        payload.quotes.forEach((q) => expect(Object.keys(q)).toEqual(Object.keys(fetcherQuote)));
        expect(payloadText(payload)).not.toContain('forward');
        expect(Object.keys(payload.greeks)).toEqual(['enabled', 'primarySource', 'fallbackSource', 'riskFreeRate', 'dividendYield', 'total', 'cboeMatched', 'computed', 'missing', 'cboeContracts']);
    });

    test('spot = the parity forward, OI 0 only for a completed quote without oi, failed symbols left out', () => {
        const { payload, stats } = buildPayload(input);
        expect(stats.spotSource).toBe('parity');
        expect(payload.underlyingPrice).toBeCloseTo(7672.5, 0);
        expect(payload.quotes.map((q) => `${q.side}${q.strike}:${q.openInterest}`)).toEqual(['call7650:100', 'put7650:300', 'call7700:0', 'put7700:50']);
        expect(payload.quotes[3].greeksSource).toBeNull();
        expect(payload.quotes[3].greeksMissingReason).toBe('tradingview_missing');
        expect(payload.quotes[0].greeksSource).toBe('tradingview');
        expect(stats).toMatchObject({ quotes: 4, withOi: 3, withGamma: 3, expirations: 1 });
        expect(payload.date).toBe('2026-10-23'); // a Sunday belongs to Friday's trading day
    });

    test('no parity (one-sided quotes) -> the futures price', () => {
        const oneSided = new Map<string, QuoteValues>([[wanted[0].symbol, { bid: 40, ask: 41 }]]);
        const { payload, stats } = buildPayload({ ...input, values: oneSided, greeks: new Map() });
        expect(stats.spotSource).toBe('mid');
        expect(payload.underlyingPrice).toBe(7672.25);
    });

    test('the written text reads back through the CACHE provider with the same quotes', () => {
        const { payload } = buildPayload(input);
        const chain = chainFromCacheFile('/ES', JSON.parse(payloadText(payload)), 'api/futures/ES.json');
        expect(chain.underlyingPrice).toBe(payload.underlyingPrice);
        expect(chain.quotes.length).toBe(4);
        expect(chain.quotes.every((q) => q.forward === undefined)).toBe(true);
        expect(chain.dataDate).toBe('2026-10-23');
    });
});

describe('GEX on the recorded ES file', () => {
    test('levels resolve around the forward and the $ totals use $50 per point', () => {
        const chain = chainFromCacheFile('/ES', JSON.parse(fx('es-file-trimmed.json')), 'es-file-trimmed.json');
        const spot = chain.underlyingPrice as number;
        const es = computeGexLevels(chain.quotes, spot, '/ES');
        const as100 = computeGexLevels(chain.quotes, spot, 'SPX');
        expect(es.maxNetGex).not.toBeNull();
        expect(es.minNetGex).not.toBeNull();
        expect(Math.abs((es.maxPain as number) - spot)).toBeLessThan(150);
        expect([es.maxNetGex, es.minNetGex, es.maxPain, es.maxAbsGamma, es.zeroGex]).toEqual([as100.maxNetGex, as100.minNetGex, as100.maxPain, as100.maxAbsGamma, as100.zeroGex]);
        expect(es.totalNetGex / as100.totalNetGex).toBeCloseTo(0.5, 10);
    });
});

describe('tv:futures arguments', () => {
    test('defaults: the four E-mini roots, a file every minute, greeks every 5 minutes', () => {
        expect(parseArgs([])).toEqual({ roots: ['ES', 'NQ', 'YM', 'RTY'], once: false, watchMs: DEFAULT_WATCH_MS, refreshMs: DEFAULT_REFRESH_MS, help: false });
        expect(DEFAULT_WATCH_MS).toBe(60_000);
    });

    test('token renewal: 15 minutes before it expires, sooner only with the debug TV_RENEW_EVERY_MS', () => {
        const now = 1_000_000_000_000;
        const exp = now + 4 * 3_600_000;
        expect(renewDueAt(exp, now, null)).toBe(exp - AUTH_REFRESH_BEFORE_MS);
        expect(exp - renewDueAt(exp, now, null)).toBe(15 * 60_000);
        expect(renewDueAt(exp, now, 180_000)).toBe(now + 180_000);
        // the debug interval never delays a renewal that is due earlier
        expect(renewDueAt(now + 10 * 60_000, now, 3_600_000)).toBe(now - 5 * 60_000);
    });

    test('rate limits pause longer when they repeat: 15 min, 30 min, 1 h, then 2 h at most', () => {
        expect([1, 2, 3, 4, 5, 9].map(rateLimitPauseMs)).toEqual([15, 30, 60, 120, 120, 120].map((m) => m * 60_000));
        expect(rateLimitPauseMs(0)).toBe(RATE_LIMIT_BACKOFF_MS);
        expect(RATE_LIMIT_MAX_MS).toBe(2 * 3_600_000);
    });

    test('--micros, --once, roots in any form, durations', () => {
        expect(parseArgs(['--micros']).roots).toEqual(['ES', 'NQ', 'YM', 'RTY', 'MES', 'MNQ', 'MYM', 'M2K']);
        expect(parseArgs(['--once', '/es', 'NQ1!,ym']).roots).toEqual(['ES', 'NQ', 'YM']);
        expect(parseArgs(['--watch', '2m', '--refresh', '90s']).watchMs).toBe(120_000);
        expect(parseArgs(['--refresh', '90s']).refreshMs).toBe(90_000);
        expect(parseDuration('1h')).toBe(3_600_000);
        expect(() => parseArgs(['XX'])).toThrow('unknown futures root');
        expect(() => parseArgs(['--watch'])).toThrow('needs a duration');
        expect(() => parseDuration('0.5')).toThrow('too short');
    });
});

describe('quote sessions and scanner pages (coverage through the nearest monthly, owner 2026-10-25)', () => {
    test('allocateSessions fills each session up to the limit, then opens the next', () => {
        expect(allocateSessions([], 5, 2)).toEqual([0, 0, 1, 1, 2]);
        expect(allocateSessions([2, 1], 3, 2)).toEqual([1, 2, 2]);
        expect(allocateSessions([0], 0, 2)).toEqual([]);
        // about 5,200 ES options: two sessions of the default size
        const slots = allocateSessions([], 5200);
        expect(Math.max(...slots)).toBe(1);
        expect(slots.filter((x) => x === 0).length).toBe(QUOTE_SESSION_LIMIT);
    });

    test('scanBody pages the scanner by offset', () => {
        const wanted = [{ symbol: 'CME_MINI:E4A261026C7630', root: 'E4A', exp: 20261026, side: 'call' as const, strike: 7630 }];
        expect((scanBody('CME_MINI:ESZ2026', wanted) as { range: number[] }).range).toEqual([0, SCAN_PAGE]);
        expect((scanBody('CME_MINI:ESZ2026', wanted, SCAN_PAGE) as { range: number[] }).range).toEqual([SCAN_PAGE, 2 * SCAN_PAGE]);
    });
});

describe('HTTP errors from TradingView (local fake server, no real request)', () => {
    let server: ReturnType<typeof Bun.serve>;
    /** what the fake answers next: status and body per path */
    const answers: Record<string, { status: number; body: string }> = {};
    const hits: Record<string, number> = {};
    const saved = { scan: TV_SCAN.url, chart: TV_HTTP.chartUrl, sessionid: process.env.TV_SESSIONID };
    const logs: string[] = [];
    const realLog = console.log;
    const wanted: WantedOption[] = [{ symbol: 'CME_MINI:E4A261026C7630', root: 'E4A', exp: 20261026, side: 'call', strike: 7630 }];

    beforeAll(() => {
        server = Bun.serve({
            port: 0,
            fetch(req) {
                const path = new URL(req.url).pathname;
                hits[path] = (hits[path] ?? 0) + 1;
                const a = answers[path] ?? { status: 404, body: 'not found' };
                return new Response(a.body, { status: a.status });
            },
        });
        TV_SCAN.url = `http://127.0.0.1:${server.port}/scan`;
        TV_HTTP.chartUrl = `http://127.0.0.1:${server.port}/chart/`;
        // a fake session value, so nothing reads the owner's env file
        process.env.TV_SESSIONID = 'fake-session-for-tests-0001';
        console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
    });
    afterAll(() => {
        console.log = realLog;
        TV_SCAN.url = saved.scan;
        TV_HTTP.chartUrl = saved.chart;
        if (saved.sessionid == null) delete process.env.TV_SESSIONID; else process.env.TV_SESSIONID = saved.sessionid;
        server.stop(true);
    });
    const reset = () => {
        for (const k of Object.keys(hits)) delete hits[k];
        logs.length = 0;
    };

    /** The private parts of the watcher the tests drive (no websocket is opened). */
    type WatcherInternals = {
        feeds: { front: string | null; wanted: WantedOption[]; greeks: Map<string, ScanRow> }[];
        refreshGreeks(feed: unknown): Promise<void>;
        authenticate(fatal: boolean): Promise<void>;
        pausedUntil: number;
    };
    const watcher = (): WatcherInternals => {
        const w = new FuturesWatcher(parseArgs(['ES'])) as unknown as WatcherInternals;
        w.feeds[0].front = 'CME_MINI:ESZ2026';
        w.feeds[0].wanted = wanted;
        return w;
    };

    test('scanner 429 and 403: TvRateLimitError after ONE request, no retry', async () => {
        for (const status of [429, 403]) {
            reset();
            answers['/scan'] = { status, body: 'slow down' };
            await expect(scanGreeks('CME_MINI:ESZ2026', wanted, null)).rejects.toBeInstanceOf(TvRateLimitError);
            expect(hits['/scan']).toBe(1);
        }
    });

    test('scanner 500: a plain error naming the status, the echoed body redacted, ONE request', async () => {
        reset();
        answers['/scan'] = { status: 500, body: `boom ${fakeJwt(1)} sessionid=fake-session-for-tests-0001` };
        const err = await scanGreeks('CME_MINI:ESZ2026', wanted, { sessionid: 'fake-session-for-tests-0001', sessionidSign: null }).then(() => new Error('no error thrown'), (e: unknown) => e as Error);
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(TvRateLimitError);
        expect(err.message).toContain('scanner 500');
        expect(err.message).not.toContain('fake-session-for-tests-0001');
        expect(err.message).not.toContain('eyJ');
        expect(hits['/scan']).toBe(1);
    });

    test('watcher: a scanner 429 pauses every request for RATE_LIMIT_BACKOFF_MS with one clear log line', async () => {
        reset();
        answers['/scan'] = { status: 429, body: 'slow down' };
        const w = watcher();
        const before = Date.now();
        await w.refreshGreeks(w.feeds[0]);
        expect(hits['/scan']).toBe(1);
        expect(w.pausedUntil).toBeGreaterThanOrEqual(before + RATE_LIMIT_BACKOFF_MS);
        expect(logs.filter((l) => l.includes('ES greeks: rate limited, no requests to TradingView until'))).toHaveLength(1);
        // during the pause: no request at all, neither greeks nor a token (no tight loop)
        for (let i = 0; i < 5; i++) {
            await w.refreshGreeks(w.feeds[0]);
            await w.authenticate(false);
        }
        expect(hits['/scan']).toBe(1);
        expect(hits['/chart/'] ?? 0).toBe(0);
    });

    test('watcher: a scanner 500 keeps the previous greeks, logs it, no pause and no retry', async () => {
        reset();
        answers['/scan'] = { status: 502, body: 'bad gateway' };
        const w = watcher();
        const old = new Map<string, ScanRow>([['E4A261026C7630', { name: 'E4A261026C7630', iv: 0.2, delta: 0.5, gamma: 0.01, theta: null, vega: null, rho: null }]]);
        w.feeds[0].greeks = old;
        await w.refreshGreeks(w.feeds[0]);
        expect(hits['/scan']).toBe(1);
        expect(w.feeds[0].greeks).toBe(old);
        expect(w.pausedUntil).toBe(0);
        expect(logs.some((l) => l.includes('ES greeks: scanner 502') && l.includes('keeping the previous ones'))).toBe(true);
    });

    test('auth page 429: rate limited message, paused, the next token request waits', async () => {
        reset();
        answers['/chart/'] = { status: 429, body: '' };
        const w = watcher();
        await expect(w.authenticate(true)).rejects.toThrow('tradingview.com answered 429: rate limited, wait 15 minutes');
        await w.authenticate(false);
        expect(hits['/chart/']).toBe(1);
    });

    test('auth page without a token (session expired): the "run bun run tv:session" message', async () => {
        reset();
        answers['/chart/'] = { status: 200, body: '<html>"auth_token":"","is_pro":false</html>' };
        const w = watcher();
        await expect(w.authenticate(true)).rejects.toThrow('session expired -> run bun run tv:session');
        expect((await fetchAuthToken({ sessionid: 'x', sessionidSign: null })).token).toBeNull();
    });
});
