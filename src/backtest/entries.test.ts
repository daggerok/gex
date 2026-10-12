/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { liveLabel, mergeEntries, parseLatest, parseSiteIndex, siteZipPath } from './entries';

describe('siteZipPath', () => {
  test('the zip of a day and of a backup sit in the folder of their month', () => {
    expect(siteZipPath('2026-10-09')).toBe('api/history/2026-10/2026-10-09.zip');
    expect(siteZipPath('2026-10-09-15-42')).toBe('api/history/2026-10/2026-10-09-15-42.zip');
  });
});

describe('parseSiteIndex', () => {
  test('reads the snapshots, sorts the tickers, drops bad ids and bad values', () => {
    const m = parseSiteIndex({ version: 1, snapshots: { '2026-10-09': ['SPY', 'NDX'], 'bad': ['A'], '2026-10-10': 'x', '2026-10-11-09-45': ['SPY', 3] } });
    expect([...m]).toEqual([['2026-10-09', ['NDX', 'SPY']], ['2026-10-11-09-45', ['SPY']]]);
  });

  test('a missing, wrong-version or garbage index is an empty list, not an error', () => {
    for (const j of [null, undefined, 1, 'x', {}, { version: 2, snapshots: { '2026-10-09': [] } }, { version: 1 }]) expect(parseSiteIndex(j).size).toBe(0);
  });
});

describe('mergeEntries', () => {
  const site = new Map<string, string[]>([['2026-10-09', ['SPY']], ['2026-10-08', ['SPY', 'QQQ']]]);

  test('newest first, a site snapshot has no local size', () => {
    const list = mergeEntries(site, []);
    expect(list.map((e) => e.id)).toEqual(['2026-10-09', '2026-10-08']);
    expect(list[0]).toEqual({ id: '2026-10-09', label: '2026-10-09', source: 'site', tickers: ['SPY'], size: null });
  });

  test('an imported snapshot that is not on the site is local, a backup shows its time', () => {
    const list = mergeEntries(site, [{ day: '2026-10-09-15-42', source: 'local', size: 10, tickers: ['SPY'] }]);
    expect(list[0]).toMatchObject({ id: '2026-10-09-15-42', label: '2026-10-09 15:42', source: 'local', size: 10 });
  });

  test('the same id on the site and imported is one entry marked both, reading the browser copy', () => {
    const list = mergeEntries(site, [{ day: '2026-10-09', source: 'local', size: 5, tickers: ['SPY', 'TSLA'] }]);
    expect(list.filter((e) => e.id === '2026-10-09')).toEqual([{ id: '2026-10-09', label: '2026-10-09', source: 'both', tickers: ['SPY', 'TSLA'], size: 5 }]);
  });

  test('a site zip only fetched and kept stays a site entry', () => {
    const list = mergeEntries(site, [{ day: '2026-10-09', source: 'site', size: 7, tickers: ['SPY'] }]);
    expect(list[0]).toMatchObject({ id: '2026-10-09', source: 'site', size: 7 });
  });
});

describe('liveLabel and parseLatest', () => {
  test('today while a live provider answers, otherwise the date of the latest cache file', () => {
    expect(liveLabel({ liveReachable: true, latestDate: '2026-10-09' })).toEqual({ kind: 'today', date: null });
    expect(liveLabel({ liveReachable: false, latestDate: '2026-10-09' })).toEqual({ kind: 'latest', date: '2026-10-09' });
  });

  test('api/latest.json: only a real date counts', () => {
    expect(parseLatest({ version: 1, date: '2026-10-09' })).toBe('2026-10-09');
    for (const j of [null, {}, { date: 5 }, { date: '10/09/2026' }]) expect(parseLatest(j)).toBeNull();
  });
});
