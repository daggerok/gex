/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { extractEntry, parseZipDirectory } from '../src/history-zip';
import { archiveEarlierDays, snapshotsOnDisk, readArchived, readHistoryIndex, syncHistoryIndex, zipPathFor } from './history-archive';
import { fileDay } from './options-data';

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'gex-archive-'));
  const optionsDir = join(root, 'options');
  const historyDir = join(root, 'history');
  mkdirSync(optionsDir);
  return { optionsDir, historyDir };
};
const put = (dir: string, symbol: string, date: string, extra = '') => {
  const text = JSON.stringify({ symbol, updated: `${date}T15:30:00-04:00`, date, quotes: [{ strike: 1.5, extra }] });
  writeFileSync(join(dir, `${symbol}.json`), text);
  return text;
};
const names = (path: string) => parseZipDirectory(new Uint8Array(readFileSync(path))).map((e) => e.name);
const run = (d: ReturnType<typeof setup>, symbols: string[], today: string) =>
  archiveEarlierDays({ optionsDir: d.optionsDir, historyDir: d.historyDir, symbols, today, dayOf: fileDay });

describe('archiveEarlierDays', () => {
  test("an earlier day's files go into the zip of their own day, byte for byte, with a manifest and the index", () => {
    const d = setup();
    const spy = put(d.optionsDir, 'SPY', '2026-10-09');
    put(d.optionsDir, 'QQQ', '2026-10-09');
    const r = run(d, ['SPY', 'QQQ'], '2026-10-12');
    expect(r.added).toEqual({ '2026-10-09': ['QQQ', 'SPY'] });
    const zip = zipPathFor('2026-10-09', d.historyDir);
    expect(names(zip)).toEqual(['2026-10-09/QQQ.json', '2026-10-09/SPY.json', '2026-10-09/manifest.json']);
    expect(readArchived(d.historyDir, '2026-10-09', 'SPY')).toBe(spy);
    const bytes = new Uint8Array(readFileSync(zip));
    const manifest = parseZipDirectory(bytes).find((e) => e.name.endsWith('manifest.json'))!;
    expect(JSON.parse(new TextDecoder().decode(extractEntry(bytes, manifest, (x) => new Uint8Array(inflateRawSync(x)))))).toEqual({ version: 1, id: '2026-10-09', date: '2026-10-09', tickers: ['QQQ', 'SPY'] });
    expect(readHistoryIndex(d.historyDir)).toEqual({ version: 1, snapshots: { '2026-10-09': ['QQQ', 'SPY'] } });
  });

  test("today's files, a later day and symbols without a file are not archived", () => {
    const d = setup();
    put(d.optionsDir, 'SPY', '2026-10-12');
    put(d.optionsDir, 'QQQ', '2026-10-13');
    expect(run(d, ['SPY', 'QQQ', 'NDX'], '2026-10-12').added).toEqual({});
    expect(existsSync(d.historyDir)).toBe(false);
  });

  test('running again changes nothing: an entry is never overwritten and the zip is not rewritten', () => {
    const d = setup();
    put(d.optionsDir, 'SPY', '2026-10-09');
    run(d, ['SPY'], '2026-10-12');
    const zip = zipPathFor('2026-10-09', d.historyDir);
    const before = readFileSync(zip);
    put(d.optionsDir, 'SPY', '2026-10-09', 'a different file of the same day');
    const r = run(d, ['SPY'], '2026-10-13');
    expect(r.added).toEqual({});
    expect(r.already).toBe(1);
    expect(readFileSync(zip).equals(before)).toBe(true);
  });

  test('a ticker that arrives later is added to the existing zip of that day', () => {
    const d = setup();
    put(d.optionsDir, 'SPY', '2026-10-09');
    run(d, ['SPY'], '2026-10-12');
    put(d.optionsDir, 'QQQ', '2026-10-09');
    expect(run(d, ['SPY', 'QQQ'], '2026-10-12').added).toEqual({ '2026-10-09': ['QQQ'] });
    expect(names(zipPathFor('2026-10-09', d.historyDir))).toEqual(['2026-10-09/QQQ.json', '2026-10-09/SPY.json', '2026-10-09/manifest.json']);
    expect(readHistoryIndex(d.historyDir).snapshots['2026-10-09']).toEqual(['QQQ', 'SPY']);
  });

  test('files of different days go to their own zips, also when days passed without a run', () => {
    const d = setup();
    put(d.optionsDir, 'SPY', '2026-10-07');
    put(d.optionsDir, 'QQQ', '2026-10-09');
    run(d, ['SPY', 'QQQ'], '2026-10-14');
    expect(existsSync(zipPathFor('2026-10-07', d.historyDir))).toBe(true);
    expect(existsSync(zipPathFor('2026-10-09', d.historyDir))).toBe(true);
    expect(existsSync(zipPathFor('2026-10-13', d.historyDir))).toBe(false);
    expect(Object.keys(readHistoryIndex(d.historyDir).snapshots)).toEqual(['2026-10-07', '2026-10-09']);
  });

  test('a file that is not a cache file is skipped, the same input gives the same zip bytes', () => {
    const a = setup();
    const b = setup();
    for (const d of [a, b]) {
      put(d.optionsDir, 'SPY', '2026-10-09');
      writeFileSync(join(d.optionsDir, 'JUNK.json'), '{oops');
      run(d, ['SPY', 'JUNK'], '2026-10-12');
    }
    expect(names(zipPathFor('2026-10-09', a.historyDir))).not.toContain('2026-10-09/JUNK.json');
    expect(readFileSync(zipPathFor('2026-10-09', a.historyDir)).equals(readFileSync(zipPathFor('2026-10-09', b.historyDir)))).toBe(true);
  });
});

describe('readArchived', () => {
  test('null when the day or the ticker is not archived', () => {
    const d = setup();
    put(d.optionsDir, 'SPY', '2026-10-09');
    run(d, ['SPY'], '2026-10-12');
    expect(readArchived(d.historyDir, '2026-10-09', 'AAPL')).toBeNull();
    expect(readArchived(d.historyDir, '2026-10-08', 'SPY')).toBeNull();
  });
});

describe('the layout is a plain folder tree that can be cleaned up by deleting files', () => {
  const fill = (d: ReturnType<typeof setup>) => {
    for (const [symbol, day] of [['SPY', '2026-09-30'], ['QQQ', '2026-10-07'], ['AAPL', '2026-10-09']] as const) {
      put(d.optionsDir, symbol, day);
      run(d, [symbol], '2026-10-12');
    }
  };

  test('a day zip sits in the folder of its month', () => {
    const d = setup();
    expect(zipPathFor('2026-10-09', '/h')).toBe('/h/2026-10/2026-10-09.zip');
    fill(d);
    expect(snapshotsOnDisk(d.historyDir)).toEqual(['2026-09-30', '2026-10-07', '2026-10-09']);
    expect(existsSync(join(d.historyDir, '2026-09', '2026-09-30.zip'))).toBe(true);
    expect(existsSync(join(d.historyDir, '2026-10', '2026-10-07.zip'))).toBe(true);
  });

  test('deleting a month folder drops its days from the index on the next run, the other months stay', () => {
    const d = setup();
    fill(d);
    for (const symbol of ['SPY', 'QQQ', 'AAPL']) put(d.optionsDir, symbol, '2026-10-12'); // the files are replaced by today's
    rmSync(join(d.historyDir, '2026-09'), { recursive: true });
    expect(Object.keys(readHistoryIndex(d.historyDir).snapshots)).toContain('2026-09-30'); // stale until a run
    run(d, ['SPY'], '2026-10-12');
    expect(Object.keys(readHistoryIndex(d.historyDir).snapshots)).toEqual(['2026-10-07', '2026-10-09']);
  });

  test('deleting one day zip drops only that day, deleting everything leaves an empty index', () => {
    const d = setup();
    fill(d);
    rmSync(zipPathFor('2026-10-07', d.historyDir));
    syncHistoryIndex(d.historyDir);
    expect(Object.keys(readHistoryIndex(d.historyDir).snapshots)).toEqual(['2026-09-30', '2026-10-09']);
    rmSync(join(d.historyDir, '2026-09'), { recursive: true });
    rmSync(join(d.historyDir, '2026-10'), { recursive: true });
    syncHistoryIndex(d.historyDir);
    expect(readHistoryIndex(d.historyDir).snapshots).toEqual({});
  });

  test('a zip copied back by hand is listed again with its tickers', () => {
    const d = setup();
    fill(d);
    const saved = join(tmpdir(), `gex-saved-${Date.now()}.zip`);
    cpSync(zipPathFor('2026-10-07', d.historyDir), saved);
    rmSync(zipPathFor('2026-10-07', d.historyDir));
    syncHistoryIndex(d.historyDir);
    expect(readHistoryIndex(d.historyDir).snapshots['2026-10-07']).toBeUndefined();
    cpSync(saved, zipPathFor('2026-10-07', d.historyDir));
    syncHistoryIndex(d.historyDir);
    expect(readHistoryIndex(d.historyDir).snapshots['2026-10-07']).toEqual(['QQQ']);
  });

  test('nothing changes when nothing happened: index.json is not rewritten, no folder is created', () => {
    const d = setup();
    fill(d);
    const index = join(d.historyDir, 'index.json');
    const before = statSync(index).mtimeMs;
    expect(syncHistoryIndex(d.historyDir)).toBe(false);
    expect(statSync(index).mtimeMs).toBe(before);
    const empty = setup();
    expect(syncHistoryIndex(empty.historyDir)).toBe(false);
    expect(existsSync(empty.historyDir)).toBe(false);
  });
});
