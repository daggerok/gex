/// <reference types="bun" />
/// <reference types="node" />
import { afterEach, describe, expect, test } from 'bun:test';
import type { ProviderContext } from '../types';
import { staticProvider, staticTickerSuggestionsFromManifest } from './cache';

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
    const s = staticTickerSuggestionsFromManifest('SPX', { options: ['SPX', 'SPY'], noOptions: ['INDU', 'SPX'], names: {} });
    expect(s.filter((x) => x.symbol === 'SPX').map((x) => x.hasOptions)).toEqual([true]);
  });
});
