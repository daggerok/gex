/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { extractEntry, parseZipDirectory } from '../src/history-zip';
import { DEFAULT_TICKERS } from '../src/default-tickers';
import { availableTickers, backupStamp, createBackup, nextBackupId, parseArgs } from './backtest-backup';
import { readHistoryIndex } from './history-archive';

const NOW = new Date('2026-10-09T19:42:30Z'); // 15:42 in New York (summer time)

const setup = (tickers: string[]) => {
  const root = mkdtempSync(join(tmpdir(), 'gex-backup-'));
  const optionsDir = join(root, 'options');
  mkdirSync(optionsDir);
  const texts: Record<string, string> = {};
  for (const t of tickers) {
    texts[t] = JSON.stringify({ symbol: t, updated: '2026-10-09T15:30:00-04:00', date: '2026-10-09', quotes: [{ strike: 1.5, t }] });
    writeFileSync(join(optionsDir, `${t}.json`), texts[t]);
  }
  writeFileSync(join(optionsDir, 'index.json'), JSON.stringify({ files: tickers }));
  return { optionsDir, historyDir: join(root, 'history'), texts };
};
const zipNames = (path: string) => parseZipDirectory(new Uint8Array(readFileSync(path))).map((e) => e.name);
const unpack = (path: string, name: string) => {
  const bytes = new Uint8Array(readFileSync(path));
  const e = parseZipDirectory(bytes).find((x) => x.name === name)!;
  return new TextDecoder().decode(extractEntry(bytes, e, (d) => new Uint8Array(inflateRawSync(d))));
};

describe('parseArgs', () => {
  test('no tickers means the preset of required tickers', () => {
    expect(parseArgs([])).toEqual({ tickers: [...DEFAULT_TICKERS], preset: true, help: false });
  });
  test('tickers: space or comma separated, any case, no duplicates', () => {
    expect(parseArgs(['spy', 'NDX,qqq', 'SPY']).tickers).toEqual(['SPY', 'NDX', 'QQQ']);
  });
  test('the word all means everything, also next to tickers', () => {
    expect(parseArgs(['all'])).toEqual({ tickers: null, preset: false, help: false });
    expect(parseArgs(['ALL', 'SPY']).tickers).toBeNull();
  });
  test('anything that is not a ticker name is refused (the CI passes input here)', () => {
    expect(() => parseArgs(['SPY;rm'])).toThrow(/not a ticker name/);
    expect(() => parseArgs(['$(id)'])).toThrow(/not a ticker name/);
    expect(() => parseArgs(['../x'])).toThrow(/not a ticker name/);
  });
  test('--help', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h', 'SPY']).tickers).toEqual(['SPY']);
  });
});

describe('backup id', () => {
  test('the name is the creation minute in market time', () => {
    expect(backupStamp(NOW)).toBe('2026-10-09-15-42');
    expect(backupStamp(new Date('2026-12-01T15:00:00Z'))).toBe('2026-12-01-10-00'); // winter time
    expect(backupStamp(new Date('2026-10-10T02:05:00Z'))).toBe('2026-10-09-22-05'); // still Friday evening in New York
  });
  test('a taken minute moves forward, the format stays', () => {
    expect(nextBackupId(NOW, new Set())).toBe('2026-10-09-15-42');
    expect(nextBackupId(NOW, new Set(['2026-10-09-15-42']))).toBe('2026-10-09-15-43');
    expect(nextBackupId(NOW, new Set(['2026-10-09-15-42', '2026-10-09-15-43']))).toBe('2026-10-09-15-44');
  });
});

describe('createBackup', () => {
  test('no tickers: every ticker file is in the zip byte for byte, the index file is not', () => {
    const d = setup(['SPY', 'QQQ', 'NDX']);
    expect(availableTickers(d.optionsDir)).toEqual(['NDX', 'QQQ', 'SPY']);
    const r = createBackup({ ...d, symbols: null, now: NOW });
    expect(r.id).toBe('2026-10-09-15-42');
    expect(r.path).toBe(join(d.historyDir, '2026-10', '2026-10-09-15-42.zip'));
    expect(zipNames(r.path)).toEqual(['2026-10-09-15-42/NDX.json', '2026-10-09-15-42/QQQ.json', '2026-10-09-15-42/SPY.json', '2026-10-09-15-42/manifest.json']);
    for (const t of ['SPY', 'QQQ', 'NDX']) expect(unpack(r.path, `2026-10-09-15-42/${t}.json`)).toBe(d.texts[t]);
    expect(JSON.parse(unpack(r.path, '2026-10-09-15-42/manifest.json'))).toEqual({ version: 1, id: '2026-10-09-15-42', date: '2026-10-09', tickers: ['NDX', 'QQQ', 'SPY'] });
  });

  test('chosen tickers: only those are backed up', () => {
    const d = setup(['SPY', 'QQQ', 'NDX', 'AAPL']);
    const r = createBackup({ ...d, symbols: ['SPY', 'NDX'], now: NOW });
    expect(r.tickers).toEqual(['NDX', 'SPY']);
    expect(zipNames(r.path)).toEqual(['2026-10-09-15-42/NDX.json', '2026-10-09-15-42/SPY.json', '2026-10-09-15-42/manifest.json']);
  });

  test('a ticker without a file is an error and nothing is written', () => {
    const d = setup(['SPY']);
    expect(() => createBackup({ ...d, symbols: ['SPY', 'ZZZ'], now: NOW })).toThrow(/ZZZ/);
    expect(existsSync(d.historyDir)).toBe(false);
  });

  test('many backups of the same date all stay, none is overwritten', () => {
    const d = setup(['SPY']);
    const first = createBackup({ ...d, symbols: ['SPY'], now: NOW });
    const second = createBackup({ ...d, symbols: ['SPY'], now: NOW });
    const later = createBackup({ ...d, symbols: ['SPY'], now: new Date('2026-10-09T20:42:00Z') });
    expect([first.id, second.id, later.id]).toEqual(['2026-10-09-15-42', '2026-10-09-15-43', '2026-10-09-16-42']);
    expect(Object.keys(readHistoryIndex(d.historyDir).snapshots)).toEqual(['2026-10-09-15-42', '2026-10-09-15-43', '2026-10-09-16-42']);
  });

  test('an empty folder has nothing to back up', () => {
    const d = setup([]);
    expect(() => createBackup({ ...d, symbols: null, now: NOW })).toThrow(/nothing to back up/);
  });
});
