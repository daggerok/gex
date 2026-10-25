/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { buildBackupZip, chainToCacheFile } from './backup';
import { createBacktestController, type SiteReader } from './controller';
import { siteZipPath } from './entries';
import { openSnapshot } from './archive';
import { createMemoryStore } from './store';
import type { ChainResult } from '../types';

const chain = (symbol: string, spot = 100): ChainResult => ({ symbol, underlyingPrice: spot, expirations: ['2026-10-16'], quotes: [{ symbol: `${symbol}C`, expiration: '2026-10-16', side: 'call', strike: 100, bid: 1, ask: 2, mid: 1.5, last: 1.5, volume: 1, openInterest: 2, iv: 0.2, delta: 0.5, gamma: 0.01, theta: -0.1, vega: 0.1, rho: 0.01, greeksSource: 'cboe', greeksMissingReason: null }] });
const zip = (id: string, symbols: string[], levels: string | null = null) =>
  buildBackupZip(id, symbols.map((s) => ({ symbol: s, text: chainToCacheFile(chain(s), new Date('2026-10-09T19:42:00Z')) })), levels);

/** A fake site: index.json, latest.json and the zips by path; counts the zip downloads. */
async function fakeSite(snapshots: Record<string, string[]>, extra: Record<string, unknown> = {}) {
  const bytes = new Map<string, Uint8Array>();
  for (const [id, tickers] of Object.entries(snapshots)) bytes.set(siteZipPath(id), await zip(id, tickers));
  const downloads: string[] = [];
  const reader: SiteReader = {
    async json(path) {
      if (path === 'api/history/index.json') return { version: 1, snapshots };
      if (path === 'api/latest.json') return { version: 1, date: '2026-10-09' };
      if (path in extra) return extra[path];
      throw new Error('404');
    },
    async bytes(path) {
      downloads.push(path);
      const b = bytes.get(path);
      if (!b) throw new Error(`HTTP 404 ${path}`);
      return b;
    },
  };
  return { reader, downloads, bytes };
}

const setup = async (snapshots: Record<string, string[]> = { '2026-10-08': ['SPY'], '2026-10-09': ['SPY', 'QQQ'] }) => {
  const site = await fakeSite(snapshots);
  const store = createMemoryStore();
  const c = createBacktestController({ store, site: site.reader, now: () => 1000 });
  await c.refresh();
  return { c, store, site };
};

describe('refresh', () => {
  test('lists the site snapshots newest first and reads the latest date', async () => {
    const { c } = await setup();
    expect(c.getState().entries.map((e) => [e.id, e.source])).toEqual([['2026-10-09', 'site'], ['2026-10-08', 'site']]);
    expect(c.getState().latestDate).toBe('2026-10-09');
  });

  test('a site without history still works: empty list, no error, the local ones are listed', async () => {
    const store = createMemoryStore();
    const bytes = await zip('2026-10-07', ['SPY']);
    await store.put({ day: '2026-10-07', source: 'local', size: bytes.length, tickers: ['SPY'], addedAt: 1, bytes });
    const c = createBacktestController({ store, site: { json: async () => { throw new Error('404'); }, bytes: async () => { throw new Error('404'); } } });
    await c.refresh();
    expect(c.getState().entries.map((e) => [e.id, e.source])).toEqual([['2026-10-07', 'local']]);
    expect(c.getState().error).toBeNull();
    expect(c.getState().latestDate).toBeNull();
  });
});

describe('select', () => {
  test('a site snapshot is fetched once, kept in the browser and opened; the next open does not download again', async () => {
    const { c, site, store } = await setup();
    await c.select('2026-10-09');
    expect(c.getState().active?.id).toBe('2026-10-09');
    expect(c.getState().active?.snapshot.tickers).toEqual(['QQQ', 'SPY']);
    expect(site.downloads).toEqual(['api/history/2026-10/2026-10-09.zip']);
    expect((await store.list()).map((m) => [m.day, m.source])).toEqual([['2026-10-09', 'site']]);
    await c.select(null);
    await c.select('2026-10-09');
    expect(site.downloads.length).toBe(1);
    expect(c.getState().entries.find((e) => e.id === '2026-10-09')?.size).toBeGreaterThan(0);
  });

  test('null returns to live', async () => {
    const { c } = await setup();
    await c.select('2026-10-09');
    await c.select(null);
    expect(c.getState().active).toBeNull();
  });

  test('an id that is nowhere, or a site path that is not a zip, is an error that keeps the previous mode', async () => {
    const { c, site } = await setup();
    await c.select('2026-10-08');
    await c.select('2020-01-01');
    expect(c.getState().error).toMatch(/not in the archive/);
    expect(c.getState().active?.id).toBe('2026-10-08');
    site.bytes.set(siteZipPath('2026-10-09'), new TextEncoder().encode('<!doctype html><html></html>')); // an SPA fallback page with 200
    await c.select('2026-10-09');
    expect(c.getState().error).toMatch(/Could not open 2026-10-09/);
    expect(c.getState().active?.id).toBe('2026-10-08');
    expect(c.getState().loading).toBe(false);
  });

  test("a backup's custom levels come with the snapshot", async () => {
    const { c } = await setup({});
    const levels = JSON.stringify({ version: 1, levels: { SPY: [{ id: 'a', name: 'L', price: 99 }] } });
    await c.saveBackup('2026-10-09-15-42', await zip('2026-10-09-15-42', ['SPY'], levels), ['SPY']);
    await c.select('2026-10-09-15-42');
    expect(c.getState().active?.customLevels).toEqual({ SPY: [{ id: 'a', name: 'L', price: 99 }] });
  });
});

describe('import', () => {
  test('a good file is kept as local and listed, a bad one is reported and does not stop the others', async () => {
    const { c } = await setup({});
    const good = await zip('2026-10-05', ['SPY']);
    const report = await c.importFiles([
      { name: 'bad.zip', bytes: async () => new Uint8Array([1, 2, 3]) },
      { name: 'good.zip', bytes: async () => good },
    ]);
    expect(report.added).toEqual(['2026-10-05']);
    expect(report.errors.length).toBe(1);
    expect(report.errors[0]).toMatch(/^bad\.zip: /);
    expect(c.getState().entries.map((e) => [e.id, e.source])).toEqual([['2026-10-05', 'local']]);
  });

  test('the same id as on the site becomes both and opens from the browser copy, no download', async () => {
    const { c, site } = await setup();
    await c.importFiles([{ name: 'x.zip', bytes: async () => zip('2026-10-09', ['SPY', 'QQQ', 'NDX']) }]);
    expect(c.getState().entries.find((e) => e.id === '2026-10-09')?.source).toBe('both');
    await c.select('2026-10-09');
    expect(c.getState().active?.snapshot.tickers).toEqual(['NDX', 'QQQ', 'SPY']);
    expect(site.downloads).toEqual([]);
  });
});

describe('clean up', () => {
  const held = async () => {
    const s = await setup({});
    for (const id of ['2026-09-01', '2026-10-05', '2026-10-09', '2026-10-09-15-42']) await s.c.saveBackup(id, await zip(id, ['SPY']), ['SPY']);
    return s;
  };

  test('older than a date removes the days before it and keeps that date and everything after, backups of that date included', async () => {
    const { c } = await held();
    expect(await c.removeOlderThan('2026-10-09')).toEqual(['2026-09-01', '2026-10-05']);
    expect(c.getState().entries.map((e) => e.id)).toEqual(['2026-10-09-15-42', '2026-10-09']);
  });

  test('remove one, remove all; removing the open snapshot returns to live', async () => {
    const { c } = await held();
    await c.select('2026-10-05');
    await c.remove(['2026-10-09']);
    expect(c.getState().entries.map((e) => e.id)).toEqual(['2026-10-09-15-42', '2026-10-05', '2026-09-01']);
    expect(c.getState().active?.id).toBe('2026-10-05');
    await c.remove(['2026-10-05']);
    expect(c.getState().active).toBeNull();
    await c.clearAll();
    expect(c.getState().entries).toEqual([]);
  });

  test('removing a day that the site still has keeps the mode, the entry stays as a site one', async () => {
    const { c } = await setup();
    await c.select('2026-10-09');
    await c.remove(['2026-10-09']);
    expect(c.getState().active?.id).toBe('2026-10-09');
    expect(c.getState().entries.find((e) => e.id === '2026-10-09')?.size).toBeNull();
  });
});

describe('download', () => {
  test('one id is its own zip, several are bundled into one that imports back to the same snapshots', async () => {
    const { c } = await setup({});
    for (const id of ['2026-10-08', '2026-10-09']) await c.saveBackup(id, await zip(id, ['SPY']), ['SPY']);
    const one = await c.download(['2026-10-09']);
    expect(one.filename).toBe('2026-10-09.zip');
    expect(openSnapshot('2026-10-09', one.bytes).tickers).toEqual(['SPY']);
    const both = await c.download(['2026-10-09', '2026-10-08']);
    expect(both.filename).toBe('gex-history-2026-10-08_2026-10-09.zip');
    const other = (await setup({})).c;
    const report = await other.importFiles([{ name: both.filename, bytes: async () => both.bytes }]);
    expect(report.added).toEqual(['2026-10-08', '2026-10-09']);
  });

  test('a site day that was never opened is fetched for the download; nothing selected is an error', async () => {
    const { c, site } = await setup();
    const one = await c.download(['2026-10-08']);
    expect(openSnapshot('2026-10-08', one.bytes).tickers).toEqual(['SPY']);
    expect(site.downloads).toEqual(['api/history/2026-10/2026-10-08.zip']);
    await expect(c.download([])).rejects.toThrow(/nothing selected/);
  });
});

describe('takenIds', () => {
  test('site and browser ids, so a new backup never takes one', async () => {
    const { c } = await setup();
    await c.saveBackup('2026-10-09-15-42', await zip('2026-10-09-15-42', ['SPY']), ['SPY']);
    expect(Array.from(c.takenIds()).sort()).toEqual(['2026-10-08', '2026-10-09', '2026-10-09-15-42']);
  });
});
