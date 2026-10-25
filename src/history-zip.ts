/// <reference lib="esnext" />
// ============================================================================
// HISTORY ZIP - the one place that knows the zip format of the daily archives
// (api/history/<YYYY-MM-DD>.zip, see agentic-workspace docs/repos/gex/spec-backtest.md).
// Pure functions over Uint8Array, no Node and no browser APIs: the fetcher script
// builds the zips (with node:zlib passed in), the app reads them (with
// DecompressionStream) and the tests do both. Only what the archives need is
// supported: stored and deflated entries, UTF-8 names, no zip64, no encryption.
// ============================================================================

export class ZipError extends Error {}

export interface ZipEntry {
    name: string;
    /** 0 = stored, 8 = deflate */
    method: number;
    crc32: number;
    compressedSize: number;
    size: number;
    /** Offset of the (compressed) data inside the zip bytes. */
    dataOffset: number;
}

/** Limits against a damaged or hostile file picked in the app (it is read in the browser, never executed). */
export interface ZipLimits {
    maxEntries: number;
    maxEntryBytes: number;
    maxTotalBytes: number;
}

export const ZIP_LIMITS: ZipLimits = { maxEntries: 5000, maxEntryBytes: 64_000_000, maxTotalBytes: 1_500_000_000 };

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const UTF8_FLAG = 0x0800;

let crcTable: Uint32Array | null = null;

/** CRC-32 (the zip one), used to check every unpacked entry. */
export function crc32(data: Uint8Array): number {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/** A name that stays inside the archive: no leading slash, no `..`, no backslash. */
function safeName(name: string): boolean {
    return name.length > 0 && !name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..');
}

/** Reads the central directory. Throws ZipError for anything that is not a plain, sane zip. */
export function parseZipDirectory(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ZipEntry[] {
    if (bytes.length < 22) throw new ZipError('not a zip file (too short)');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
        if (view.getUint32(i, true) === SIG_END) { end = i; break; }
    }
    if (end < 0) throw new ZipError('not a zip file (no end record)');
    const count = view.getUint16(end + 10, true);
    const cdSize = view.getUint32(end + 12, true);
    const cdOffset = view.getUint32(end + 16, true);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError('zip64 is not supported');
    if (count > limits.maxEntries) throw new ZipError(`too many entries (${count})`);
    if (cdOffset + cdSize > end) throw new ZipError('damaged zip (directory out of range)');

    const decoder = new TextDecoder('utf-8', { fatal: true });
    const entries: ZipEntry[] = [];
    let pos = cdOffset;
    let total = 0;
    for (let n = 0; n < count; n++) {
        if (pos + 46 > end || view.getUint32(pos, true) !== SIG_CENTRAL) throw new ZipError('damaged zip (bad directory entry)');
        const flags = view.getUint16(pos + 8, true);
        const method = view.getUint16(pos + 10, true);
        const crc = view.getUint32(pos + 16, true);
        const compressedSize = view.getUint32(pos + 20, true);
        const size = view.getUint32(pos + 24, true);
        const nameLen = view.getUint16(pos + 28, true);
        const extraLen = view.getUint16(pos + 30, true);
        const commentLen = view.getUint16(pos + 32, true);
        const local = view.getUint32(pos + 42, true);
        if (flags & 1) throw new ZipError('encrypted entries are not supported');
        if (pos + 46 + nameLen > end) throw new ZipError('damaged zip (name out of range)');
        let name: string;
        try {
            name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
        } catch {
            throw new ZipError('damaged zip (entry name is not UTF-8)');
        }
        pos += 46 + nameLen + extraLen + commentLen;
        if (name.endsWith('/')) continue; // a folder entry
        if (!safeName(name)) throw new ZipError(`unsafe entry name: ${name}`);
        if (method !== 0 && method !== 8) throw new ZipError(`unsupported compression method ${method} in ${name}`);
        if (method === 0 && compressedSize !== size) throw new ZipError(`damaged zip (sizes of ${name})`);
        if (size > limits.maxEntryBytes) throw new ZipError(`entry too large: ${name}`);
        total += size;
        if (total > limits.maxTotalBytes) throw new ZipError('archive is too large when unpacked');
        if (local + 30 > end || view.getUint32(local, true) !== SIG_LOCAL) throw new ZipError(`damaged zip (local header of ${name})`);
        const dataOffset = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        if (dataOffset + compressedSize > cdOffset) throw new ZipError(`damaged zip (data of ${name})`);
        entries.push({ name, method, crc32: crc, compressedSize, size, dataOffset });
    }
    return entries;
}

/** The compressed bytes of an entry (as stored in the zip). */
export function rawEntryData(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
    return bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
}

/** Checks an unpacked entry against the size and CRC the zip declares, returns it. Throws ZipError when it does not match. */
export function verifyEntry(entry: ZipEntry, data: Uint8Array): Uint8Array {
    if (data.length !== entry.size) throw new ZipError(`damaged zip (size of ${entry.name})`);
    if (crc32(data) !== entry.crc32) throw new ZipError(`damaged zip (checksum of ${entry.name})`);
    return data;
}

/** Unpacks an entry with a synchronous raw-deflate function (node:zlib `inflateRawSync` in the script and in tests). */
export function extractEntry(bytes: Uint8Array, entry: ZipEntry, inflateRaw: (data: Uint8Array) => Uint8Array): Uint8Array {
    const raw = rawEntryData(bytes, entry);
    return verifyEntry(entry, entry.method === 0 ? raw : inflateRaw(raw));
}

/** MS-DOS date of a snapshot id (`YYYY-MM-DD` or `YYYY-MM-DD-HH-mm`, its date part; the zips use a fixed time stamp so the same content always gives the same bytes). */
function dosDate(id: string): number {
    const [y, m, d] = id.slice(0, 10).split('-').map(Number);
    return (((y - 1980) & 0x7f) << 9) | ((m & 0xf) << 5) | (d & 0x1f);
}

/** An entry with its bytes still compressed as stored in a zip, so it can be copied into another zip without recompressing. */
export interface RawZipEntry {
    name: string;
    method: number;
    crc32: number;
    size: number;
    compressedSize: number;
    raw: Uint8Array;
}

/** Every entry of a zip with its compressed bytes (see parseZipDirectory for the limits and the errors). */
export function rawEntries(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): RawZipEntry[] {
    return parseZipDirectory(bytes, limits).map((e) => ({ name: e.name, method: e.method, crc32: e.crc32, size: e.size, compressedSize: e.compressedSize, raw: rawEntryData(bytes, e) }));
}

/**
 * Writes already compressed entries into a new zip (kept in the given order), nothing is compressed or unpacked. Used
 * to bundle several day zips into one and to cut a multi-day archive into day zips. Deterministic like buildZip.
 */
export function buildZipFromRaw(entries: ReadonlyArray<RawZipEntry>, id: string): Uint8Array {
    const encoder = new TextEncoder();
    const date = dosDate(id);
    const chunks: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const e of entries) {
        if (!safeName(e.name)) throw new ZipError(`unsafe entry name: ${e.name}`);
        const name = encoder.encode(e.name);

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, SIG_LOCAL, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, UTF8_FLAG, true);
        local.setUint16(8, e.method, true);
        local.setUint16(10, 0, true); // time
        local.setUint16(12, date, true);
        local.setUint32(14, e.crc32, true);
        local.setUint32(18, e.raw.length, true);
        local.setUint32(22, e.size, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);
        chunks.push(new Uint8Array(local.buffer), name, e.raw);

        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, SIG_CENTRAL, true);
        cd.setUint16(4, 20, true);
        cd.setUint16(6, 20, true);
        cd.setUint16(8, UTF8_FLAG, true);
        cd.setUint16(10, e.method, true);
        cd.setUint16(12, 0, true);
        cd.setUint16(14, date, true);
        cd.setUint32(16, e.crc32, true);
        cd.setUint32(20, e.raw.length, true);
        cd.setUint32(24, e.size, true);
        cd.setUint16(28, name.length, true);
        cd.setUint32(42, offset, true);
        central.push(new Uint8Array(cd.buffer), name);

        offset += 30 + name.length + e.raw.length;
    }
    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, SIG_END, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
}

/**
 * Builds a zip from entries (kept in the given order). `deflateRaw` is node:zlib `deflateRawSync`; it is not needed in
 * the browser, which only reads. Deterministic: the same entries and the same `day` give identical bytes.
 */
export function buildZip(
    entries: ReadonlyArray<{ name: string; data: Uint8Array }>,
    id: string,
    deflateRaw: (data: Uint8Array) => Uint8Array,
): Uint8Array {
    return buildZipFromRaw(
        entries.map((e) => {
            const packed = e.data.length ? deflateRaw(e.data) : e.data;
            return { name: e.name, method: e.data.length ? 8 : 0, crc32: crc32(e.data), size: e.data.length, compressedSize: packed.length, raw: packed };
        }),
        id,
    );
}

const SNAPSHOT_FOLDER = /^(\d{4}-\d{2}-\d{2}(?:-\d{2}-\d{2})?)\//;

/**
 * The snapshot an entry belongs to: its first folder, `YYYY-MM-DD/...` (the automatic end-of-day archive) or
 * `YYYY-MM-DD-HH-mm/...` (a backup made on demand), or null for anything else.
 */
export function entrySnapshotId(name: string): string | null {
    const m = SNAPSHOT_FOLDER.exec(name);
    return m ? m[1] : null;
}

/** Cuts the entries of a (possibly multi-snapshot) archive by snapshot. Entries outside such a folder are ignored. */
export function splitBySnapshot(entries: ReadonlyArray<RawZipEntry>): Map<string, RawZipEntry[]> {
    const out = new Map<string, RawZipEntry[]>();
    for (const e of entries) {
        const id = entrySnapshotId(e.name);
        if (id) out.set(id, [...(out.get(id) ?? []), e]);
    }
    return out;
}

/**
 * Bundles snapshot zips (or any archives with `<snapshot id>/` entries) into ONE zip, copying the entries as they are. The
 * first entry with a name wins, so a snapshot given twice is not doubled. Entries are ordered by name. Importing the
 * result again gives the same snapshots back.
 */
export function mergeZips(zips: ReadonlyArray<Uint8Array>, limits: ZipLimits = ZIP_LIMITS): Uint8Array {
    const byName = new Map<string, RawZipEntry>();
    for (const bytes of zips) {
        for (const e of rawEntries(bytes, limits)) if (!byName.has(e.name) && entrySnapshotId(e.name)) byName.set(e.name, e);
    }
    const ordered = Array.from(byName.values()).sort((a, b) => (a.name < b.name ? -1 : 1));
    const first = ordered.length ? entrySnapshotId(ordered[0].name)! : '1980-01-01';
    return buildZipFromRaw(ordered, first);
}
