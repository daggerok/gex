/// <reference types="node" />
/// <reference types="bun" />
// TradingView hybrid for stock and index options (scripts/tv/hybrid.ts) and the shared OI rule (chain.ts trustedOi):
// symbols, the window, scanner names, Cboe OI. No network.
import { describe, expect, test } from 'bun:test';
import { occSymbol, oiDay, opraStrike, optionSymbol, trustedOi, type Family, type ScanRow } from './chain';
import { fetchCboeOi, hybridWanted, underlyingCandidates, withOpraNames } from './hybrid';

describe('OPRA symbols', () => {
    test('the strike always carries a decimal; OCC for Cboe; futures unchanged', () => {
        expect(opraStrike(760)).toBe('760.0');
        expect(opraStrike(207.5)).toBe('207.5');
        expect(optionSymbol('OPRA', 'SPY', 20261026, 'call', 760)).toBe('OPRA:SPY261026C760.0');
        expect(optionSymbol('OPRA', 'SPXW', 20261026, 'put', 7625)).toBe('OPRA:SPXW261026P7625.0');
        expect(optionSymbol('CME_MINI', 'E4A', 20261026, 'call', 7630)).toBe('CME_MINI:E4A261026C7630');
        expect(occSymbol('SPY', 20261026, 'call', 760)).toBe('SPY261026C00760000');
        expect(occSymbol('NVDA', 20261030, 'put', 207.5)).toBe('NVDA261030P00207500');
        expect(occSymbol('SPXW', 20261026, 'put', 7625)).toBe('SPXW261026P07625000');
    });

    test('underlyings to try: indices by their TradingView name, stocks on the usual exchanges, junk none', () => {
        expect(underlyingCandidates('SPX')).toEqual(['SP:SPX']);
        expect(underlyingCandidates('spy')).toEqual(['NASDAQ:SPY', 'NYSE:SPY', 'AMEX:SPY', 'CBOE:SPY', 'NYSEARCA:SPY']);
        expect(underlyingCandidates('../x')).toEqual([]);
        expect(underlyingCandidates('')).toEqual([]);
    });
});

describe('which open interest to trust (one rule for every TradingView chain)', () => {
    const day = (iso: string) => Date.parse(`${iso}T02:40:00Z`) / 1000;
    test('Cboe first; else TradingView only on the newest OI day; else unknown (null, not 0)', () => {
        expect(trustedOi({ time: day('2026-10-23'), value: 100 }, '2026-10-23', 117)).toBe(117);
        expect(trustedOi({ time: day('2026-10-23'), value: 100 }, '2026-10-23', null)).toBe(100);
        expect(trustedOi({ time: day('2026-10-15'), value: 268 }, '2026-10-23', undefined)).toBeNull();
        expect(trustedOi(undefined, '2026-10-23', undefined)).toBeNull();
        expect(trustedOi({ time: day('2026-10-23') }, '2026-10-23', null)).toBeNull();
        // no latest day given (the futures today, owner question G10): TradingView's value whatever its day
        expect(trustedOi({ time: day('2026-09-21'), value: 5 }, null, null)).toBe(5);
        expect(oiDay(day('2026-10-22'))).toBe('2026-10-22');
    });
});

describe('the hybrid window', () => {
    const now = new Date('2026-10-26T14:00:00Z');
    const series = (exp: number, expTime: string, strikes: number[], root = 'SPY') => ({ exp, expTime, root, strikes, underlying: 'AMEX:SPY' });
    const families: Family[] = [{ name: 'SPY', prefix: 'OPRA', series: [
        series(20261023, '2026-10-23T20:00:00Z', [740, 760]), // over
        series(20261026, '2026-10-26T20:00:00Z', [700, 740, 760, 780, 850]),
        series(20261204, '2026-12-04T21:00:00Z', [760]), // 39 days
        series(20261218, '2026-12-18T21:00:00Z', [760]), // 53 days: out
    ] }];
    test('open expirations within 42 days, strikes within +/-6%, calls and puts in order', () => {
        const w = hybridWanted(families, 760, now);
        expect(Array.from(new Set(w.map((x) => x.exp)))).toEqual([20261026, 20261204]);
        expect(Array.from(new Set(w.filter((x) => x.exp === 20261026).map((x) => x.strike)))).toEqual([740, 760, 780]);
        expect(w[0].symbol).toBe('OPRA:SPY261026C740.0');
        expect(w[1].symbol).toBe('OPRA:SPY261026P740.0');
    });

    test('scanner names of whole strikes found under the quote symbol too', () => {
        const row: ScanRow = { name: 'SPY261026C760', iv: 0.2, delta: 0.5, gamma: 0.01, theta: null, vega: null, rho: null };
        const half: ScanRow = { ...row, name: 'NVDA261030P207.5' };
        const m = withOpraNames(new Map([[row.name, row], [half.name, half]]));
        expect(m.get('SPY261026C760.0')).toBe(row);
        expect(m.get('NVDA261030P207.5')).toBe(half);
        expect(m.has('NVDA261030P207.5.0')).toBe(false);
    });
});

describe('Cboe open interest', () => {
    test('by OCC symbol; an index as _SPX; any error -> empty, never a throw', async () => {
        const urls: string[] = [];
        const ok = (async (url: string) => {
            urls.push(url);
            return new Response(JSON.stringify({ data: { options: [{ option: 'SPXW261026P07625000', open_interest: 42 }, { option: 'X', open_interest: null }] } }));
        }) as unknown as typeof fetch;
        const m = await fetchCboeOi('SPX', ok);
        expect(urls[0]).toBe('https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json');
        expect(Array.from(m.entries())).toEqual([['SPXW261026P07625000', 42]]);
        const bad = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
        expect((await fetchCboeOi('SPY', bad)).size).toBe(0);
        const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
        expect((await fetchCboeOi('SPY', boom)).size).toBe(0);
    });
});
