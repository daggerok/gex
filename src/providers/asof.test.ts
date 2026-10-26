/// <reference types="bun" />
/// <reference types="node" />
import { afterEach, describe, expect, test } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import { openSnapshot } from '../backtest/archive';
import { buildBackupZip } from '../backtest/backup';
import { setValuationTime, yearsToExpiration } from '../greeks';
import { bulkCache, bulkKey } from '../settings-store';
import type { ProviderContext } from '../types';
import { ASOF_PREFIX, asOfDayOf, asOfProviderId, isAsOfProviderId, makeAsOfProvider, valuationTimeOf } from './asof';
import { loadMeta } from './loader';

void deflateRawSync;
const ctx = { proxyBase: '', token: '', secret: '' } as unknown as ProviderContext;
const chainText = (symbol: string, price: number) => JSON.stringify({
  symbol, updated: '2026-10-09T15:30:00-04:00', date: '2026-10-09', underlyingPrice: price, expirations: ['2026-10-16'],
  quotes: [{ symbol: `${symbol}261016C00100000`, expiration: '2026-10-16', side: 'call', strike: 100, bid: 1, ask: 1.2, mid: 1.1, last: 1.1, volume: 5, openInterest: 50, iv: 0.2, delta: 0.5, gamma: 0.02, theta: -0.1, vega: 0.1, rho: 0.01, greeksSource: 'cboe', greeksMissingReason: null }],
});
const ID = '2026-10-09-15-42';
const snapshot = async () => openSnapshot(ID, await buildBackupZip(ID, [{ symbol: 'SPY', text: chainText('SPY', 778.5) }, { symbol: 'NDX', text: chainText('NDX', 30000) }]));

afterEach(() => setValuationTime(null));

describe('as-of provider', () => {
  test('its id marks an archived snapshot, the four real providers are never taken for one', () => {
    expect(asOfProviderId(ID)).toBe(`${ASOF_PREFIX}${ID}`);
    expect(isAsOfProviderId(asOfProviderId(ID))).toBe(true);
    for (const id of ['static', 'cboe', 'nasdaq', 'yahoo']) expect(isAsOfProviderId(id)).toBe(false);
  });

  test('lists and suggests only the tickers of the snapshot', async () => {
    const p = makeAsOfProvider(await snapshot());
    expect(await p.listTickers!(ctx)).toEqual(['NDX', 'SPY']);
    expect((await p.suggestTickers!('s', ctx)).map((s) => s.symbol)).toEqual(['SPY']);
    expect((await p.suggestTickers!('', ctx)).map((s) => s.symbol)).toEqual(['NDX', 'SPY']);
    expect(await p.suggestTickers!('zzz', ctx)).toEqual([]);
  });

  test('loads a ticker of the snapshot as it was archived', async () => {
    const p = makeAsOfProvider(await snapshot());
    const chain = await p.fetchAll!('spy', ctx);
    expect(chain.symbol).toBe('SPY');
    expect(chain.underlyingPrice).toBe(778.5);
    expect(chain.quotes).toHaveLength(1);
  });

  test('a ticker that is not in the snapshot is an error that says so', async () => {
    const p = makeAsOfProvider(await snapshot());
    await expect(p.fetchAll!('AAPL', ctx)).rejects.toThrow(/"AAPL" is not in the archive of 2026-10-09 15:42/);
  });

  test('loadMeta keeps the result in memory under its own key, apart from the live CACHE provider', async () => {
    const p = makeAsOfProvider(await snapshot());
    const meta = await loadMeta(p, 'SPY', ctx);
    expect(meta.underlyingPrice).toBe(778.5);
    expect(bulkCache.get(bulkKey(p.id, 'SPY'))?.symbol).toBe('SPY');
    expect(bulkCache.get(bulkKey('static', 'SPY'))).toBeUndefined();
  });
});

describe('model greeks are valued at the snapshot time (GEX-M1)', () => {
  const HOUR = 1 / (365 * 24);
  test('a backup is valued at its own minute, a day archive at the 16:00 close, both New York time', () => {
    // 2026-10-09 15:42 EDT = 19:42 UTC; the day archive 16:00 EDT = 20:00 UTC
    expect(valuationTimeOf('2026-10-09-15-42')).toBe(Date.UTC(2026, 9, 9, 19, 42));
    expect(valuationTimeOf('2026-10-09')).toBe(Date.UTC(2026, 9, 9, 20, 0));
    // winter time: 16:00 EST = 21:00 UTC
    expect(valuationTimeOf('2026-12-04')).toBe(Date.UTC(2026, 11, 4, 21, 0));
    expect(valuationTimeOf('yesterday')).toBeNull();
    expect(asOfDayOf('2026-10-09-15-42')).toBe('2026-10-09');
  });

  test('time to expiration counts from the snapshot time, then from the real clock again', () => {
    setValuationTime(valuationTimeOf(ID));
    // 15:42 Friday -> 16:00 next Friday: 7 days and 18 minutes
    expect(yearsToExpiration('2026-10-16') as number).toBeCloseTo(7 / 365 + (18 / 60) * HOUR, 12);
    // the same day: 18 minutes to the settlement, above the 15-minute floor
    expect(yearsToExpiration('2026-10-09') as number).toBeCloseTo((18 / 60) * HOUR, 12);
    expect(yearsToExpiration('2026-10-08')).toBeNull(); // already expired on that day
    // a day archive is valued at the close: its 0DTE gets the 15-minute floor
    setValuationTime(valuationTimeOf('2026-10-09'));
    expect(yearsToExpiration('2026-10-09') as number).toBeCloseTo(0.25 * HOUR, 12);
    setValuationTime(null);
    expect(yearsToExpiration('2020-01-01')).toBeNull(); // the real clock: long expired
  });

  test('a malformed time is ignored', () => {
    setValuationTime(Number.NaN);
    expect(yearsToExpiration('2020-01-01')).toBeNull();
  });
});
