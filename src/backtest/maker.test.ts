/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import type { ChainResult, DataProvider, ProviderContext } from '../types';
import { importArchive, openSnapshot } from './archive';
import { loadFullChain, makeBackup } from './maker';
import { loadBackupTickers, parseTickerInput, saveBackupTickers } from './prefs';

const ctx = {} as ProviderContext;
const NOW = new Date('2026-10-09T19:42:30Z');
const q = (symbol: string, exp: string) => ({ symbol: `${symbol}${exp}`, expiration: exp, side: 'call' as const, strike: 100, bid: 1, ask: 2, mid: 1.5, last: 1.5, volume: 1, openInterest: 2, iv: 0.2, delta: 0.5, gamma: 0.01, theta: -0.1, vega: 0.1, rho: 0.01, greeksSource: 'cboe' as const, greeksMissingReason: null });
const chain = (symbol: string): ChainResult => ({ symbol, underlyingPrice: 100, expirations: ['2026-10-16'], quotes: [q(symbol, '2026-10-16')] });

const bulkProvider = (id: string, tickers: string[], failFor: string[] = []): DataProvider => ({
  id, label: id, description: '', mode: 'bulk', setup: 'none', supportsToken: false, needsProxy: false, needsKeyFor: () => false,
  listTickers: async () => tickers,
  fetchAll: async (symbol) => {
    if (failFor.includes(symbol)) throw new Error(`${symbol} is broken`);
    return chain(symbol);
  },
});

describe('makeBackup', () => {
  test('all data: every ticker the provider lists is in the backup, with the id of the moment', async () => {
    const out = await makeBackup({ provider: bulkProvider('bulk-all', ['SPY', 'QQQ', 'NDX']), ctx, symbols: null, taken: new Set(), now: NOW });
    expect(out.id).toBe('2026-10-09-15-42');
    expect(out.tickers).toEqual(['NDX', 'QQQ', 'SPY']);
    expect(openSnapshot(out.id, out.bytes).tickers).toEqual(['NDX', 'QQQ', 'SPY']);
  });

  test('chosen tickers: only those, and the backup is importable', async () => {
    const out = await makeBackup({ provider: bulkProvider('bulk-some', ['SPY', 'QQQ', 'NDX']), ctx, symbols: ['SPY', 'NDX'], taken: new Set(), now: NOW });
    expect(out.tickers).toEqual(['NDX', 'SPY']);
    expect((await importArchive(out.bytes)).map((s) => s.tickers)).toEqual([['NDX', 'SPY']]);
  });

  test('an id that is taken moves forward instead of overwriting', async () => {
    const out = await makeBackup({ provider: bulkProvider('bulk-taken', ['SPY']), ctx, symbols: null, taken: new Set(['2026-10-09-15-42']), now: NOW });
    expect(out.id).toBe('2026-10-09-15-43');
  });

  test('a ticker that fails is reported and left out, the others still make the backup', async () => {
    const out = await makeBackup({ provider: bulkProvider('bulk-fail', ['SPY', 'BAD', 'QQQ'], ['BAD']), ctx, symbols: null, taken: new Set(), now: NOW });
    expect(out.tickers).toEqual(['QQQ', 'SPY']);
    expect(out.failed).toEqual([{ symbol: 'BAD', reason: 'BAD is broken' }]);
  });

  test('nothing loaded at all is an error that names the reasons', async () => {
    await expect(makeBackup({ provider: bulkProvider('bulk-none', ['BAD'], ['BAD']), ctx, symbols: null, taken: new Set(), now: NOW })).rejects.toThrow(/BAD is broken/);
    await expect(makeBackup({ provider: bulkProvider('bulk-empty', []), ctx, symbols: null, taken: new Set(), now: NOW })).rejects.toThrow(/nothing to back up/);
  });

  test('a cancelled run throws an AbortError and builds nothing', async () => {
    const ac = new AbortController();
    const p = bulkProvider('bulk-abort', ['SPY', 'QQQ']);
    const run = makeBackup({ provider: p, ctx, symbols: null, taken: new Set(), now: NOW, signal: ac.signal, concurrency: 1, onProgress: () => ac.abort() });
    await expect(run).rejects.toThrow(/cancelled/);
  });

  test('progress is reported for every ticker', async () => {
    const seen: number[] = [];
    await makeBackup({ provider: bulkProvider('bulk-progress', ['SPY', 'QQQ', 'NDX']), ctx, symbols: null, taken: new Set(), now: NOW, onProgress: (p) => seen.push(p.done) });
    expect(seen.sort()).toEqual([1, 2, 3]);
  });
});

describe('loadFullChain', () => {
  test('a lazy provider is assembled expiration by expiration', async () => {
    const lazy: DataProvider = {
      id: 'lazy-test', label: 'lazy', description: '', mode: 'lazy', setup: 'none', supportsToken: false, needsProxy: false, needsKeyFor: () => false,
      fetchMeta: async (symbol) => ({ symbol, underlyingPrice: 50, expirations: ['2026-10-16', '2026-10-23'] }),
      fetchExpiration: async (symbol, exp) => [q(symbol, exp)],
    };
    const c = await loadFullChain(lazy, 'SPY', ctx);
    expect(c.expirations).toEqual(['2026-10-16', '2026-10-23']);
    expect(c.quotes.map((x) => x.expiration)).toEqual(['2026-10-16', '2026-10-23']);
  });
});

describe('remembered tickers', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  test('nothing remembered means all data (an empty list)', () => {
    expect(loadBackupTickers(memory())).toEqual([]);
  });

  test('the last choice comes back, choosing all data forgets it', () => {
    const s = memory();
    saveBackupTickers(['SPY', 'NDX', 'SPY'], s);
    expect(loadBackupTickers(s)).toEqual(['SPY', 'NDX']);
    saveBackupTickers([], s);
    expect(loadBackupTickers(s)).toEqual([]);
  });

  test('damaged or blocked storage gives all data, never an error', () => {
    expect(loadBackupTickers({ getItem: () => '{oops', setItem: () => {}, removeItem: () => {} })).toEqual([]);
    expect(loadBackupTickers({ getItem: () => { throw new Error('blocked'); }, setItem: () => {}, removeItem: () => {} })).toEqual([]);
    expect(() => saveBackupTickers(['SPY'], { getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem: () => {} })).not.toThrow();
    expect(loadBackupTickers(null)).toEqual([]);
  });

  test('typed tickers: any separator, any case, no duplicates, bad names are reported', () => {
    expect(parseTickerInput('spy, ndx;qqq  SPY')).toEqual({ tickers: ['SPY', 'NDX', 'QQQ'], rejected: [] });
    expect(parseTickerInput('SPY ../x $(id)')).toEqual({ tickers: ['SPY'], rejected: ['../X', '$(ID)'] });
    expect(parseTickerInput('   ')).toEqual({ tickers: [], rejected: [] });
  });
});
