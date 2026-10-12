/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { extractEntry, parseZipDirectory } from '../src/history-zip';
import { archiveDay, pruneDailyArchives, snapshotsOnDisk, readArchived, readHistoryIndex, syncHistoryIndex, zipPathFor } from './history-archive';
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
const run = (d: ReturnType<typeof setup>, symbols: string[], day: string) =>
  archiveDay({ optionsDir: d.optionsDir, historyDir: d.historyDir, symbols, day, dayOf: fileDay });

describe('archiveDay', () => {
  test("the files of the day go into the zip of that day, byte for byte, with a manifest and the index", () => {
    const d = setup();
    const spy = put(d.optionsDir, 'SPY', '2026-10-09');
    put(d.optionsDir, 'QQQ', '2026-10-09');
    const r = run(d, ['SPY', 'QQQ'], '2026-10-09');
    expect(r.added).toEqual({ '2026-10-09': ['QQQ', 'SPY'] });
    const zip = zipPathFor('2026-10-09', d.historyDir);
    expect(names(zip)).toEqual(['2026-10-09/QQQ.json', '2026-10-09/SPY.json', '2026-10-09/manifest.json']);
    expect(readArchived(d.historyDir, '2026-10-09', 'SPY')).toBe(spy);
    const bytes = new Uint8Array(readFileSync(zip));
    const manifest = parseZipDirectory(bytes).find((e) => e.name.endsWith('manifest.json'))!;
    expect(JSON.parse(new TextDecoder().decode(extractEntry(bytes, manifest, (x) => new Uint8Array(inflateRawSync(x)))))).toEqual({ version: 1, id: '2026-10-09', date: '2026-10-09', tickers: ['QQQ', 'SPY'] });
    expect(readHistoryIndex(d.historyDir)).toEqual({ version: 1, snapshots: { '2026-10-09': ['QQQ', 'SPY'] } });
  });

  test('files of another day and symbols without a file are not archived, no folder is created', () => {
    const d = setup();
    put(d.optionsDir, 'SPY', '2026-10-08');
    put(d.optionsDir, 'QQQ', '2026-10-13');
    expect(run(d, ['SPY', 'QQQ', 'NDX'], '2026-10-09').added).toEqual({});
    expect(existsSync(d.historyDir)).toBe(false);
  });

  test('running again with the same files changes nothing, the zip is not rewritten', () => {
    const d = setup();
    put(d.optionsDir, 'SPY', '2026-10-09');
    run(d, ['SPY'], '2026-10-09');
    const zip = zipPathFor('2026-10-09', d.historyDir);
    const before = readFileSync(zip);
    const r = run(d, ['SPY'], '2026-10-09');
    expect(r.added).toEqual({});
    expect(r.already).toBe(1);
    expect(readFileSync(zip).equals(before)).toBe(true);
  });

  test('a later run of the same day replaces the ticker with the newer file (the zip is the last state of the day)', () => {
    const d = setup();
    put(d.optionsDir, 'SPY', '2026-10-09', 'noon');
    run(d, ['SPY'], '2026-10-09');
    const last = put(d.optionsDir, 'SPY', '2026-10-09', 'close');
    expect(run(d, ['SPY'], '2026-10-09').added).toEqual({ '2026-10-09': ['SPY'] });
    expect(readArchived(d.historyDir, '2026-10-09', 'SPY')).toBe(last);
    expect(names(zipPathFor('2026-10-09', d.historyDir))).toEqual(['2026-10-09/SPY.json', '2026-10-09/manifest.json']);
  });

  test('a ticker that arrives later is added, the ones already in the zip stay', () => {
    const d = setup();
    put(d.optionsDir, 'SPY', '2026-10-09');
    run(d, ['SPY'], '2026-10-09');
    put(d.optionsDir, 'QQQ', '2026-10-09');
    expect(run(d, ['QQQ'], '2026-10-09').added).toEqual({ '2026-10-09': ['QQQ'] });
    expect(names(zipPathFor('2026-10-09', d.historyDir))).toEqual(['2026-10-09/QQQ.json', '2026-10-09/SPY.json', '2026-10-09/manifest.json']);
    expect(readHistoryIndex(d.historyDir).snapshots['2026-10-09']).toEqual(['QQQ', 'SPY']);
  });

  test('another day gets its own zip', () => {
    const d = setup();
    put(d.optionsDir, 'SPY', '2026-10-08');
    run(d, ['SPY'], '2026-10-08');
    put(d.optionsDir, 'SPY', '2026-10-09');
    run(d, ['SPY'], '2026-10-09');
    expect(Object.keys(readHistoryIndex(d.historyDir).snapshots)).toEqual(['2026-10-08', '2026-10-09']);
  });

  test('a file that is not a cache file is skipped, the same input gives the same zip bytes', () => {
    const a = setup();
    const b = setup();
    for (const d of [a, b]) {
      put(d.optionsDir, 'SPY', '2026-10-09');
      writeFileSync(join(d.optionsDir, 'JUNK.json'), '{oops');
      run(d, ['SPY', 'JUNK'], '2026-10-09');
    }
    expect(names(zipPathFor('2026-10-09', a.historyDir))).not.toContain('2026-10-09/JUNK.json');
    expect(readFileSync(zipPathFor('2026-10-09', a.historyDir)).equals(readFileSync(zipPathFor('2026-10-09', b.historyDir)))).toBe(true);
  });
});

describe('readArchived', () => {
  test('null when the day or the ticker is not archived', () => {
    const d = setup();
    put(d.optionsDir, 'SPY', '2026-10-09');
    run(d, ['SPY'], '2026-10-09');
    expect(readArchived(d.historyDir, '2026-10-09', 'AAPL')).toBeNull();
    expect(readArchived(d.historyDir, '2026-10-08', 'SPY')).toBeNull();
  });
});

describe('the layout is a plain folder tree that can be cleaned up by deleting files', () => {
  const fill = (d: ReturnType<typeof setup>) => {
    for (const [symbol, day] of [['SPY', '2026-09-30'], ['QQQ', '2026-10-07'], ['AAPL', '2026-10-09']] as const) {
      put(d.optionsDir, symbol, day);
      run(d, [symbol], day);
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
    run(d, ['SPY'], '2026-10-11'); // nothing to write for that day, the index still follows the disk
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

describe('pruneDailyArchives keeps the last days only', () => {
  const day = (d: ReturnType<typeof setup>, id: string) => {
    put(d.optionsDir, 'SPY', id);
    run(d, ['SPY'], id);
  };

  test('keeps 14 days counted back from today (today included), deletes older days, the month folder and the index entry', () => {
    const d = setup();
    for (const id of ['2026-09-20', '2026-09-30', '2026-10-01', '2026-10-14']) day(d, id);
    // today 2026-10-14, 14 days = 2026-10-01 .. 2026-10-14
    expect(pruneDailyArchives(d.historyDir, '2026-10-14', 14)).toEqual(['2026-09-20', '2026-09-30']);
    expect(snapshotsOnDisk(d.historyDir)).toEqual(['2026-10-01', '2026-10-14']);
    expect(existsSync(join(d.historyDir, '2026-09'))).toBe(false);
    expect(Object.keys(readHistoryIndex(d.historyDir).snapshots)).toEqual(['2026-10-01', '2026-10-14']);
  });

  test('a backup made on demand is never deleted, however old', () => {
    const d = setup();
    day(d, '2026-01-05');
    writeFileSync(join(d.historyDir, '2026-01', '2026-01-06-15-42.zip'), new Uint8Array([1]));
    expect(pruneDailyArchives(d.historyDir, '2026-10-14', 14)).toEqual(['2026-01-05']);
    expect(existsSync(join(d.historyDir, '2026-01', '2026-01-06-15-42.zip'))).toBe(true);
  });

  test('crosses a month and a year boundary, 0 keeps everything', () => {
    const d = setup();
    for (const id of ['2025-12-31', '2026-01-01']) day(d, id);
    expect(pruneDailyArchives(d.historyDir, '2026-01-02', 3)).toEqual([]); // 12-31 .. 01-02
    expect(pruneDailyArchives(d.historyDir, '2026-01-03', 3)).toEqual(['2025-12-31']);
    expect(pruneDailyArchives(d.historyDir, '2030-01-01', 0)).toEqual([]);
    expect(snapshotsOnDisk(d.historyDir)).toEqual(['2026-01-01']);
  });
});
