/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import { ZipError, buildZip, buildZipFromRaw, mergeZips, parseZipDirectory } from '../history-zip';
import { importArchive, isSnapshotId, openSnapshot, readEntry, snapshotDate, snapshotLabel } from './archive';

const enc = new TextEncoder();
const deflate = (d: Uint8Array) => new Uint8Array(deflateRawSync(d));
const chain = (symbol: string, extra = '') => JSON.stringify({ symbol, date: '2026-10-09', underlyingPrice: 100, expirations: ['2026-10-16'], quotes: [{ strike: 100, side: 'call', extra }] });
const dayZip = (day: string, symbols: string[]) =>
  buildZip([...symbols.map((s) => ({ name: `${day}/${s}.json`, data: enc.encode(chain(s)) })), { name: `${day}/manifest.json`, data: enc.encode('{"version":1}') }], day, deflate);

describe('openSnapshot', () => {
  test('lists the tickers (not the manifest) and reads a cache file back byte for byte', async () => {
    const a = openSnapshot('2026-10-09', dayZip('2026-10-09', ['SPY', 'AAPL']));
    expect(a.tickers).toEqual(['AAPL', 'SPY']);
    expect(await a.read('SPY')).toBe(chain('SPY'));
    expect(await a.read('spy')).toBe(chain('SPY'));
  });

  test('a ticker that is not in the archive reads as null', async () => {
    expect(await openSnapshot('2026-10-09', dayZip('2026-10-09', ['SPY'])).read('NVDA')).toBeNull();
  });

  test('entries of another day or with odd ticker names are not listed', () => {
    const zip = buildZip([{ name: '2026-10-08/SPY.json', data: enc.encode('{}') }, { name: '2026-10-09/spy lower.json', data: enc.encode('{}') }, { name: '2026-10-09/QQQ.json', data: enc.encode('{}') }], '2026-10-09', deflate);
    expect(openSnapshot('2026-10-09', zip).tickers).toEqual(['QQQ']);
  });
});

describe('importArchive', () => {
  test('a snapshot zip comes back as one snapshot', async () => {
    const days = await importArchive(dayZip('2026-10-09', ['SPY', 'QQQ']));
    expect(days.map((d) => d.id)).toEqual(['2026-10-09']);
    expect(days[0].tickers).toEqual(['QQQ', 'SPY']);
  });

  test('a bundle is cut into one zip per snapshot, each readable on its own', async () => {
    const bundle = mergeZips([dayZip('2026-10-12', ['SPY']), dayZip('2026-10-09', ['SPY', 'AAPL'])]);
    const days = await importArchive(bundle);
    expect(days.map((d) => d.id)).toEqual(['2026-10-09', '2026-10-12']);
    expect(days[0].tickers).toEqual(['AAPL', 'SPY']);
    expect(await openSnapshot('2026-10-12', days[1].bytes).read('SPY')).toBe(chain('SPY'));
    expect(parseZipDirectory(days[1].bytes).every((e) => e.name.startsWith('2026-10-12/'))).toBe(true);
  });

  test('a file that is not an archive of days is refused with a reason', async () => {
    await expect(importArchive(enc.encode('not a zip at all, just some text in a file'))).rejects.toThrow(ZipError);
    const other = buildZip([{ name: 'readme.txt', data: enc.encode('hi') }], '2026-10-09', deflate);
    await expect(importArchive(other)).rejects.toThrow(/no <date>/);
  });

  test('an entry that is not an options chain is refused', async () => {
    const bad = buildZip([{ name: '2026-10-09/SPY.json', data: enc.encode('{"quotes":"x"}') }], '2026-10-09', deflate);
    await expect(importArchive(bad)).rejects.toThrow(/not an options chain/);
    const junk = buildZip([{ name: '2026-10-09/SPY.json', data: enc.encode('{oops') }], '2026-10-09', deflate);
    await expect(importArchive(junk)).rejects.toThrow(/not valid/);
  });

  test('size limits apply to what a user picks', async () => {
    await expect(importArchive(dayZip('2026-10-09', ['SPY']), { maxEntries: 5000, maxEntryBytes: 20, maxTotalBytes: 1e9 })).rejects.toThrow(/too large/);
  });
});

describe('snapshot ids', () => {
  test('a backup made on demand has a minute in its id and its entries are found under it', async () => {
    const id = '2026-10-09-15-42';
    const zip = buildZip([{ name: `${id}/SPY.json`, data: enc.encode(chain('SPY')) }, { name: `${id}/manifest.json`, data: enc.encode('{}') }], id, deflate);
    const [imported] = await importArchive(zip);
    expect(imported.id).toBe(id);
    expect(await openSnapshot(id, imported.bytes).read('SPY')).toBe(chain('SPY'));
  });

  test('several backups of one date stay apart when bundled and imported', async () => {
    const make = (id: string) => buildZip([{ name: `${id}/SPY.json`, data: enc.encode(chain('SPY', id)) }], id, deflate);
    const days = await importArchive(mergeZips([make('2026-10-09'), make('2026-10-09-10-05'), make('2026-10-09-15-42')]));
    expect(days.map((d) => d.id)).toEqual(['2026-10-09', '2026-10-09-10-05', '2026-10-09-15-42']);
  });

  test('id helpers', () => {
    expect(isSnapshotId('2026-10-09')).toBe(true);
    expect(isSnapshotId('2026-10-09-15-42')).toBe(true);
    expect(isSnapshotId('2026-10-09-15')).toBe(false);
    expect(isSnapshotId('latest')).toBe(false);
    expect(snapshotDate('2026-10-09-15-42')).toBe('2026-10-09');
    expect(snapshotLabel('2026-10-09-15-42')).toBe('2026-10-09 15:42');
    expect(snapshotLabel('2026-10-09')).toBe('2026-10-09');
  });
});

describe('readEntry', () => {
  test('stops unpacking an entry that inflates past its declared size (a zip bomb)', async () => {
    const raw = deflate(new Uint8Array(1024 * 1024));
    const zip = buildZipFromRaw([{ name: '2026-10-09/SPY.json', method: 8, crc32: 0, size: 100, compressedSize: raw.length, raw }], '2026-10-09');
    const [entry] = parseZipDirectory(zip);
    const read = readEntry(zip, entry);
    await expect(read).rejects.toThrow(ZipError);
    await expect(read).rejects.toThrow('unpacks past its declared size');
  });
});
