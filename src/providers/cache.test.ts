/// <reference types="bun" />
/// <reference types="node" />
import { afterEach, describe, expect, test } from 'bun:test';
import type { DataProvider, OptionQuote, ProviderContext } from '../types';
import { chainFromCacheFile, futuresFile, manifestFromIndex, staticProvider, staticTickerSuggestionsFromManifest } from './cache';
import { lazyHit, loadExpiration, withoutExpired } from './loader';

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
    // the expiration day itself stays up to its 16:00 settlement and is over after it (batch 4, owner 2026-10-25)
    expect(withoutExpired(chain, new Date('2026-10-16T16:00:00-04:00')).expirations).toEqual(['2026-10-16', '2026-10-24', '2026-10-30']);
    expect(withoutExpired(chain, new Date('2026-10-16T16:01:00-04:00')).expirations).toEqual(['2026-10-24', '2026-10-30']);
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

describe('a lazy expiration is fetched once while a request for it runs', () => {
  test('the prefetch and the Load of the same date share one request; a later call fetches again', async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const lazy = {
      id: 'lazy-dedupe', label: 'lazy', description: '', mode: 'lazy', setup: 'none', supportsToken: false, needsProxy: false, needsKeyFor: () => false,
      fetchMeta: async (symbol: string) => ({ symbol, underlyingPrice: 50, expirations: ['2099-10-16'] }),
      fetchExpiration: async () => { calls++; await gate; return [] as OptionQuote[]; },
    } as unknown as DataProvider;
    const a = loadExpiration(lazy, 'SPY', '2099-10-16', ctx);
    const b = loadExpiration(lazy, 'SPY', '2099-10-16', ctx);
    release();
    await Promise.all([a, b]);
    expect(calls).toBe(1);
    await loadExpiration(lazy, 'SPY', '2099-10-16', ctx);
    expect(calls).toBe(2);
  });
});

describe('CACHE provider: local futures files (bun run tv:futures, never in index.json)', () => {
  const ES_FILE = { symbol: 'ES', updated: '2026-10-25T10:00:00-04:00', date: '2026-10-23', underlyingPrice: 7672.5, expirations: ['2026-10-30'], quotes: [{ symbol: 'EW261030C07650', expiration: '2026-10-30', side: 'call', strike: 7650, gamma: 0.004, openInterest: 10 }] };
  const EVERSOURCE = { ...SPX, symbol: 'ES', underlyingPrice: 70 };

  test('/ES and ES1! open api/futures/ES.json although index.json does not list it', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith('api/options/index.json')) return new Response(JSON.stringify(INDEX));
      if (url.endsWith('api/futures/ES.json')) return new Response(JSON.stringify(ES_FILE));
      return new Response('missing', { status: 404 });
    }) as typeof fetch;
    for (const t of ['/ES', 'es1!']) {
      const chain = await staticProvider.fetchAll!(t, ctx);
      expect(chain.symbol).toBe('/ES');
      expect(chain.underlyingPrice).toBe(7672.5);
      expect(chain.quotes.length).toBe(1);
    }
    expect(seen.filter((u) => u.includes('api/futures/'))).toEqual(['api/futures/ES.json', 'api/futures/ES.json']);
  });

  test('a bare ES stays the Eversource stock file of api/options', async () => {
    serve({ 'api/options/index.json': { ...INDEX, files: ['ES', 'SPX'] }, 'api/options/ES.json': EVERSOURCE, 'api/futures/ES.json': ES_FILE });
    const chain = await staticProvider.fetchAll!('ES', ctx);
    expect(chain.underlyingPrice).toBe(70);
  });

  test('a missing futures file says how to make it (local only), not "not in the static cache"', async () => {
    serve({ 'api/options/index.json': INDEX });
    await expect(staticProvider.fetchAll!('/NQ', ctx)).rejects.toThrow('bun run tv:futures');
  });

  test('futuresFile maps only the futures forms', () => {
    expect(futuresFile('/m2k')).toEqual({ root: 'M2K', symbol: '/M2K', url: 'api/futures/M2K.json' });
    expect(futuresFile('ES')).toBeNull();
    expect(futuresFile('SPX')).toBeNull();
  });
});
