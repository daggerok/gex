/// <reference types="bun" />
/// <reference types="node" />
import { afterEach, describe, expect, test } from 'bun:test';
import type { OptionQuote, ProviderContext } from '../types';
import { chainFromCacheFile, manifestFromIndex, staticProvider, staticTickerSuggestionsFromManifest } from './cache';
import { lazyHit, withoutExpired } from './loader';

const ctx = {} as ProviderContext;
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// A scan that failed on a rate limit used to list a ticker in BOTH `files` and `no_options` (GEX-H3): SPX here
const INDEX = { files: ['SPX', 'SPY'], count: 2, names: {}, no_options: { INDU: '2026-10-24', SPX: '2026-10-24' } };
const SPX = { symbol: 'SPX', underlyingPrice: 7000, expirations: ['2026-10-30'], quotes: [{ symbol: 'SPXW261030C07000000', expiration: '2026-10-30', side: 'call', strike: 7000, gamma: 0.001, openInterest: 10 }] };

function serve(files: Record<string, unknown>): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const hit = Object.entries(files).find(([path]) => String(input).endsWith(path));
    return hit ? new Response(JSON.stringify(hit[1])) : new Response('missing', { status: 404 });
  }) as typeof fetch;
}

describe('CACHE provider with a ticker in both files and no_options', () => {
  test('the file wins: the chain loads instead of the "(no options)" error', async () => {
    serve({ 'api/options/index.json': INDEX, 'api/options/SPX.json': SPX });
    const chain = await staticProvider.fetchAll!('SPX', ctx);
    expect(chain.quotes.length).toBe(1);
    expect(chain.expirations).toEqual(['2026-10-30']);
  });

  test('a ticker only on the skiplist still reports "(no options)"', async () => {
    serve({ 'api/options/index.json': INDEX });
    await expect(staticProvider.fetchAll!('INDU', ctx)).rejects.toThrow('(no options)');
  });

  test('the suggestions offer it once, with options', () => {
    const s = staticTickerSuggestionsFromManifest('SPX', { options: ['SPX', 'SPY'], noOptions: ['INDU', 'SPX'], names: {}, defaults: [] });
    expect(s.filter((x) => x.symbol === 'SPX').map((x) => x.hasOptions)).toEqual([true]);
  });
});

describe('manifestFromIndex: the default list of the fetcher (index.json `defaults`)', () => {
  test('keeps the order of the list (the order of the hint), normalized, without repeats or bad entries', () => {
    const m = manifestFromIndex({ ...INDEX, defaults: ['SPX', 'ndx', ' SPY ', 'SPX', '', 'not a ticker', null] });
    expect(m.defaults).toEqual(['SPX', 'NDX', 'SPY']);
  });

  test('an index older than the field, or a broken one, gives an empty list instead of throwing', () => {
    expect(manifestFromIndex(INDEX).defaults).toEqual([]);
    expect(manifestFromIndex({ ...INDEX, defaults: 'SPX' }).defaults).toEqual([]);
    expect(manifestFromIndex(null)).toEqual({ options: [], noOptions: [], names: {}, defaults: [] });
  });
});

describe('data age and expired expirations of a cache file (GEX-H4)', () => {
  const file = {
    symbol: 'AAPL', updated: '2026-10-05T18:30:00.120000-04:00', date: '2026-10-05', underlyingPrice: 250,
    expirations: ['2026-10-09', '2026-10-16', '2026-10-24', '2026-10-30'], quotes: [],
  };

  test('the file stamp and trading day reach the chain', () => {
    const chain = chainFromCacheFile('AAPL', file, 'AAPL.json');
    expect(chain.updated).toBe('2026-10-05T18:30:00.120000-04:00');
    expect(chain.dataDate).toBe('2026-10-05');
    expect(chainFromCacheFile('AAPL', { quotes: [] }, 'x').updated).toBeNull();
  });

  test('opened on 2026-10-24 (a Saturday, New York): the expirations before that day are left out and counted', () => {
    const chain = chainFromCacheFile('AAPL', file, 'AAPL.json');
    const meta = withoutExpired(chain, new Date('2026-10-24T12:00:00-04:00'));
    expect(meta.expirations).toEqual(['2026-10-24', '2026-10-30']);
    expect(meta.expiredDropped).toBe(2);
    // the expiration day itself stays until midnight New York, also after the 16:00 settlement
    expect(withoutExpired(chain, new Date('2026-10-16T23:30:00-04:00')).expirations).toEqual(['2026-10-16', '2026-10-24', '2026-10-30']);
    // nothing expired: the same object
    expect(withoutExpired(chain, new Date('2026-10-01T12:00:00-04:00'))).toBe(chain);
  });
});

describe('lazy expiration cache belongs to one meta fetch (GEX-H6)', () => {
  const quotes = [{ symbol: 'AAPL261030C00250000', expiration: '2026-10-30', side: 'call', strike: 250, bid: 1, ask: 1.2, mid: 1.1, last: 1.1, volume: 1, openInterest: 1, iv: 0.3, delta: 0.5, gamma: 0.02, theta: -0.1, vega: 0.1 }] as OptionQuote[];
  test('a hit only for the entry of the current meta fetch', () => {
    // second date in the same session: same fetchedAt -> served from the cache
    expect(lazyHit({ fetchedAt: 1000, quotes }, 1000)).toBe(quotes);
    // reopened the next day: loadMeta stamped a new fetchedAt -> fetched again
    expect(lazyHit({ fetchedAt: 1000, quotes }, 2000)).toBeNull();
    // an entry of an older app version (plain array, no stamp) and a missing meta never hit
    expect(lazyHit(quotes, 1000)).toBeNull();
    expect(lazyHit({ fetchedAt: 1000, quotes }, null)).toBeNull();
    expect(lazyHit(null, 1000)).toBeNull();
    expect(lazyHit({ fetchedAt: 1000 }, 1000)).toBeNull();
  });
});
