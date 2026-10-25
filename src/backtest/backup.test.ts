/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createBackup } from '../../scripts/backtest-backup';
import { chainFromCacheFile } from '../providers/cache';
import { extractEntry, parseZipDirectory } from '../history-zip';
import type { ChainResult, OptionQuote } from '../types';
import { customLevelsFileText, parseCustomLevelsFile } from '../custom-levels';
import { importArchive, openSnapshot } from './archive';
import { buildBackupZip, chainToCacheFile } from './backup';
import { isoMarketTime, marketDay } from './snapshot';

const NOW = new Date('2026-10-09T19:42:30.250Z'); // Fri 15:42 in New York (summer time)
const ID = '2026-10-09-15-42';
const inflate = (d: Uint8Array) => new Uint8Array(inflateRawSync(d));
const dec = new TextDecoder();

const quote = (strike: number, side: 'call' | 'put'): OptionQuote => ({
  symbol: `SPY261016${side === 'call' ? 'C' : 'P'}${strike}`, expiration: '2026-10-16', side, strike, bid: 1.5, ask: 1.6, mid: 1.55, last: 1.52, volume: 12, openInterest: 340,
  iv: 0.21, delta: side === 'call' ? 0.5 : -0.5, gamma: 0.01, theta: -0.1, vega: 0.2, rho: 0.05, lambda: 9, vanna: 1, vomma: 2, charm: 3, speed: 4, zomma: 5, color: 6,
  greeksSource: 'cboe', greeksMissingReason: null,
});
const chain = (symbol: string): ChainResult => ({ symbol, underlyingPrice: 778.57, expirations: ['2026-10-16'], quotes: [quote(775, 'call'), quote(775, 'put')], greeks: { enabled: true, primarySource: 'cboe', total: 2, cboeMatched: 2 } });

const entries = (zip: Uint8Array) => parseZipDirectory(zip).map((e) => ({ name: e.name, text: dec.decode(extractEntry(zip, e, inflate)) }));

describe('chainToCacheFile', () => {
  const file = JSON.parse(chainToCacheFile(chain('SPY'), NOW));

  test('has the keys of a cache file in the order the fetcher writes them', () => {
    expect(Object.keys(file)).toEqual(['symbol', 'updated', 'date', 'underlyingPrice', 'greeks', 'expirations', 'quotes']);
    expect(Object.keys(file.greeks)).toEqual(['enabled', 'primarySource', 'fallbackSource', 'riskFreeRate', 'dividendYield', 'total', 'cboeMatched', 'computed', 'missing', 'cboeContracts']);
    expect(Object.keys(file.quotes[0])).toEqual(['symbol', 'expiration', 'side', 'strike', 'bid', 'ask', 'mid', 'last', 'volume', 'openInterest', 'iv', 'delta', 'gamma', 'theta', 'vega', 'rho', 'greeksSource', 'greeksMissingReason']);
  });

  test('time stamp and trading day are the ones the fetcher would write', () => {
    expect(file.updated).toBe(isoMarketTime(NOW));
    expect(file.updated).toBe('2026-10-09T15:42:30.250000-04:00');
    expect(file.date).toBe('2026-10-09');
    expect(marketDay(new Date('2026-10-10T16:00:00Z'))).toBe('2026-10-09'); // a weekend is still Friday
  });

  test('model-only fields are left out, NaN and missing values become null', () => {
    expect('lambda' in file.quotes[0]).toBe(false);
    const odd = chain('SPY');
    odd.underlyingPrice = NaN;
    odd.quotes[0].bid = NaN as unknown as number;
    const j = JSON.parse(chainToCacheFile(odd, NOW));
    expect(j.underlyingPrice).toBeNull();
    expect(j.quotes[0].bid).toBeNull();
  });

  test('the app reads it back as the same chain', () => {
    const back = chainFromCacheFile('SPY', file, 'test');
    expect(back.symbol).toBe('SPY');
    expect(back.underlyingPrice).toBe(778.57);
    expect(back.expirations).toEqual(['2026-10-16']);
    expect(back.quotes.map((q) => [q.side, q.strike, q.bid, q.openInterest, q.iv, q.delta])).toEqual([['call', 775, 1.5, 340, 0.21, 0.5], ['put', 775, 1.5, 340, 0.21, -0.5]]);
  });
});

describe('a backup made in the app has the structure of the one the CI job makes', () => {
  const texts = { SPY: chainToCacheFile(chain('SPY'), NOW), NDX: chainToCacheFile(chain('NDX'), NOW) };

  const ciBackup = () => {
    const root = mkdtempSync(join(tmpdir(), 'gex-compat-'));
    const optionsDir = join(root, 'options');
    mkdirSync(optionsDir);
    for (const [t, text] of Object.entries(texts)) writeFileSync(join(optionsDir, `${t}.json`), text);
    const r = createBackup({ optionsDir, historyDir: join(root, 'history'), symbols: null, now: NOW });
    return { r, zip: new Uint8Array(readFileSync(r.path)) };
  };

  test('same id, same entry names in the same order, same contents, same manifest', async () => {
    const ci = ciBackup();
    const app = await buildBackupZip(ID, [{ symbol: 'SPY', text: texts.SPY }, { symbol: 'NDX', text: texts.NDX }]);
    expect(ci.r.id).toBe(ID);
    expect(entries(app)).toEqual(entries(ci.zip));
    expect(entries(app).map((e) => e.name)).toEqual([`${ID}/NDX.json`, `${ID}/SPY.json`, `${ID}/manifest.json`]);
    expect(JSON.parse(entries(app)[2].text)).toEqual({ version: 1, id: ID, date: '2026-10-09', tickers: ['NDX', 'SPY'] });
  });

  test('each side reads the other: the app opens the CI zip, the CI zip bundles with the app one, importing gives both back', async () => {
    const ci = ciBackup();
    const app = await buildBackupZip(ID, [{ symbol: 'SPY', text: texts.SPY }]);
    expect(openSnapshot(ID, ci.zip).tickers).toEqual(['NDX', 'SPY']);
    expect(await openSnapshot(ID, app).read('SPY')).toBe(texts.SPY);
    const second = await buildBackupZip('2026-10-09-16-05', [{ symbol: 'SPY', text: texts.SPY }]);
    const imported = await importArchive(new Uint8Array(await buildBackupZip(ID, [{ symbol: 'QQQ', text: texts.SPY }])));
    expect(imported.map((s) => s.id)).toEqual([ID]);
    expect((await importArchive(second)).map((s) => s.id)).toEqual(['2026-10-09-16-05']);
  });

  test('a bad id or a bad ticker name is refused', async () => {
    await expect(buildBackupZip('2026-10-09', [])).resolves.toBeDefined(); // an end-of-day id is fine too
    await expect(buildBackupZip('latest', [])).rejects.toThrow(/bad snapshot id/);
    await expect(buildBackupZip(ID, [{ symbol: '../x', text: '{}' }])).rejects.toThrow(/not a ticker name/);
  });
});

describe('custom levels in a backup', () => {
  const levels = { SPY: [{ id: 'a', name: 'Level 1', price: 775, color: '#fb7185' }], QQQ: [{ id: 'b', name: 'Q', price: 700 }], TSLA: [{ id: 'c', name: 'Not backed up', price: 1 }] };
  const files = [{ symbol: 'SPY', text: chainToCacheFile(chain('SPY'), NOW) }, { symbol: 'QQQ', text: chainToCacheFile(chain('QQQ'), NOW) }];

  test('the file holds only the tickers of the backup that have levels, nothing when there are none', () => {
    expect(JSON.parse(customLevelsFileText(levels, ['SPY', 'QQQ'])!)).toEqual({ version: 1, levels: { QQQ: levels.QQQ, SPY: levels.SPY } });
    expect(customLevelsFileText(levels, ['NDX'])).toBeNull();
    expect(customLevelsFileText({}, ['SPY'])).toBeNull();
  });

  test('the entry sits between the tickers and the manifest, the manifest is the same as without levels', async () => {
    const withLevels = entries(await buildBackupZip(ID, files, customLevelsFileText(levels, ['SPY', 'QQQ'])));
    const without = entries(await buildBackupZip(ID, files));
    expect(withLevels.map((e) => e.name)).toEqual([`${ID}/QQQ.json`, `${ID}/SPY.json`, `${ID}/custom-levels.json`, `${ID}/manifest.json`]);
    expect(withLevels.find((e) => e.name.endsWith('manifest.json'))).toEqual(without.find((e) => e.name.endsWith('manifest.json')));
  });

  test('opening the snapshot gives the levels back and does not list the file as a ticker; no file means no levels', async () => {
    const zip = await buildBackupZip(ID, files, customLevelsFileText(levels, ['SPY', 'QQQ']));
    const snap = openSnapshot(ID, zip);
    expect(snap.tickers).toEqual(['QQQ', 'SPY']);
    expect(await snap.customLevels()).toEqual({ QQQ: levels.QQQ, SPY: levels.SPY });
    expect(await openSnapshot(ID, await buildBackupZip(ID, files)).customLevels()).toEqual({});
  });

  test('importing keeps the levels entry', async () => {
    const zip = await buildBackupZip(ID, files, customLevelsFileText(levels, ['SPY', 'QQQ']));
    const [imported] = await importArchive(zip);
    expect(await openSnapshot(imported.id, imported.bytes).customLevels()).toEqual({ QQQ: levels.QQQ, SPY: levels.SPY });
  });

  test('a damaged or foreign file gives no levels and bad entries are dropped', () => {
    expect(parseCustomLevelsFile('not json')).toEqual({});
    expect(parseCustomLevelsFile(JSON.stringify({ version: 2, levels: { SPY: [{ id: 'a', name: 'x', price: 1 }] } }))).toEqual({});
    expect(parseCustomLevelsFile(JSON.stringify({ version: 1, levels: { SPY: [{ id: 'a', name: 'x', price: 'no' }, { id: 'b', name: 'ok', price: 2 }] } }))).toEqual({ SPY: [{ id: 'b', name: 'ok', price: 2 }] });
  });
});
