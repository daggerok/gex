/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { ZipError, buildZip, crc32, extractEntry, parseZipDirectory } from './history-zip';

const enc = new TextEncoder();
const dec = new TextDecoder();
const deflate = (d: Uint8Array) => new Uint8Array(deflateRawSync(d));
const inflate = (d: Uint8Array) => new Uint8Array(inflateRawSync(d));
const entry = (name: string, text: string) => ({ name, data: enc.encode(text) });

describe('crc32', () => {
  test('matches the known check value', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('buildZip and parseZipDirectory', () => {
  const entries = [entry('2026-10-12/manifest.json', '{"version":1}'), entry('2026-10-12/SPY.json', '{"symbol":"SPY","quotes":[1,2,3]}'.repeat(50)), entry('2026-10-12/empty.json', '')];

  test('every entry comes back byte for byte, in order', () => {
    const zip = buildZip(entries, '2026-10-12', deflate);
    const dir = parseZipDirectory(zip);
    expect(dir.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    dir.forEach((e, i) => expect(dec.decode(extractEntry(zip, e, inflate))).toBe(dec.decode(entries[i].data)));
  });

  test('the same entries give identical bytes (the day zips must not change when nothing is added)', () => {
    expect(buildZip(entries, '2026-10-12', deflate)).toEqual(buildZip(entries, '2026-10-12', deflate));
  });

  test('a repetitive json is really compressed, an empty file is stored', () => {
    const dir = parseZipDirectory(buildZip(entries, '2026-10-12', deflate));
    expect(dir[1].method).toBe(8);
    expect(dir[1].compressedSize).toBeLessThan(dir[1].size / 5);
    expect(dir[2].method).toBe(0);
  });

  test('non-ASCII names survive', () => {
    const zip = buildZip([entry('2026-10-12/Уровень.json', 'x')], '2026-10-12', deflate);
    expect(parseZipDirectory(zip)[0].name).toBe('2026-10-12/Уровень.json');
  });
});

describe('damaged and hostile zips are refused, not read', () => {
  const good = () => buildZip([entry('2026-10-12/SPY.json', '{"a":1}'.repeat(20))], '2026-10-12', deflate);

  test('not a zip', () => {
    expect(() => parseZipDirectory(enc.encode('hello, I am not a zip file at all'))).toThrow(ZipError);
    expect(() => parseZipDirectory(new Uint8Array(3))).toThrow(ZipError);
  });

  test('truncated file', () => {
    const zip = good();
    expect(() => parseZipDirectory(zip.subarray(0, zip.length - 10))).toThrow(ZipError);
  });

  test('a flipped byte in the data fails the checksum when the entry is unpacked', () => {
    const zip = good();
    const e = parseZipDirectory(zip)[0];
    zip[e.dataOffset + 2] ^= 0xff;
    expect(() => extractEntry(zip, e, inflate)).toThrow();
  });

  test('a path that leaves the archive is refused', () => {
    expect(() => buildZip([entry('../evil.json', 'x')], '2026-10-12', deflate)).toThrow(ZipError);
    const zip = good();
    const bad = new Uint8Array(zip);
    // rewrite the name in the central directory to "../" + rest of the same length
    const idx = Buffer.from(bad).lastIndexOf('2026-10-12/SPY.json');
    bad.set(enc.encode('../26-10-12/SPY.json'.padEnd(19, 'x').slice(0, 19)), idx);
    expect(() => parseZipDirectory(bad)).toThrow(ZipError);
  });

  test('limits stop a zip bomb and too many entries', () => {
    const zip = good();
    expect(() => parseZipDirectory(zip, { maxEntries: 5000, maxEntryBytes: 10, maxTotalBytes: 1e9 })).toThrow(/too large/);
    expect(() => parseZipDirectory(zip, { maxEntries: 0, maxEntryBytes: 1e9, maxTotalBytes: 1e9 })).toThrow(/too many/);
    expect(() => parseZipDirectory(zip, { maxEntries: 5000, maxEntryBytes: 1e9, maxTotalBytes: 10 })).toThrow(/too large/);
  });

  test('a zip made by another tool (other fields set) is read the same way', () => {
    // 'a.txt' = "hi" stored, written by hand like `zip -0` does (with a local extra field of 4 bytes)
    const name = enc.encode('a.txt');
    const data = enc.encode('hi');
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint32(14, crc32(data), true);
    local.setUint32(18, 2, true); local.setUint32(22, 2, true); local.setUint16(26, name.length, true); local.setUint16(28, 4, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint32(16, crc32(data), true); cd.setUint32(20, 2, true); cd.setUint32(24, 2, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, 0, true);
    const end = new DataView(new ArrayBuffer(22));
    const localPart = 30 + name.length + 4 + data.length;
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true); end.setUint32(12, 46 + name.length, true); end.setUint32(16, localPart, true);
    const zip = new Uint8Array([...new Uint8Array(local.buffer), ...name, 0, 0, 0, 0, ...data, ...new Uint8Array(cd.buffer), ...name, ...new Uint8Array(end.buffer)]);
    const [e] = parseZipDirectory(zip);
    expect(e.name).toBe('a.txt');
    expect(dec.decode(extractEntry(zip, e, inflate))).toBe('hi');
  });
});
