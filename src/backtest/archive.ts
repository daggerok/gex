import { isSnapshotId, isTickerName, snapshotDate, snapshotLabel } from './snapshot';
import {
    ZIP_LIMITS,
    ZipError,
    buildZipFromRaw,
    entrySnapshotId,
    parseZipDirectory,
    rawEntries,
    rawEntryData,
    splitBySnapshot,
    verifyEntry,
    type ZipEntry,
    type ZipLimits,
} from '../history-zip';

// ============================================================================
// BACKTEST ARCHIVE - reading and writing the backtest zips in the browser
// (agentic-workspace docs/repos/gex/spec-backtest.md). A snapshot zip holds
// `<id>/<SYM>.json` entries (cache files as they were at that moment) and
// `<id>/manifest.json`. The id is `YYYY-MM-DD` for the automatic end-of-day
// archive and `YYYY-MM-DD-HH-mm` (market time) for a backup made on demand with
// scripts/backtest-backup.ts, so several backups of the same date never overwrite each other. Nothing here is
// uploaded anywhere: files are read, checked and unpacked in memory, only the
// entries that are opened.
// ============================================================================

export { isSnapshotId, snapshotDate, snapshotLabel };

/** Raw-deflate unpack with the browser's DecompressionStream. */
export async function inflateRawAsync(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Unpacks one entry and checks it against the size and CRC the zip declares. */
export async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
    const raw = rawEntryData(bytes, entry);
    return verifyEntry(entry, entry.method === 0 ? raw : await inflateRawAsync(raw));
}

/** One snapshot: its zip bytes and the tickers inside, entries are unpacked only when asked for. */
export interface Snapshot {
    id: string;
    bytes: Uint8Array;
    tickers: string[];
    /** The cache file text of a ticker in that snapshot, or null when it is not in it. */
    read(symbol: string): Promise<string | null>;
}

export function openSnapshot(id: string, bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): Snapshot {
    const prefix = `${id}/`;
    const byTicker = new Map<string, ZipEntry>();
    for (const e of parseZipDirectory(bytes, limits)) {
        if (!e.name.startsWith(prefix) || !e.name.endsWith('.json')) continue;
        const symbol = e.name.slice(prefix.length, -'.json'.length);
        if (symbol && symbol !== 'manifest' && isTickerName(symbol)) byTicker.set(symbol, e);
    }
    const decoder = new TextDecoder();
    return {
        id,
        bytes,
        tickers: [...byTicker.keys()].sort(),
        async read(symbol) {
            const e = byTicker.get(symbol.toUpperCase());
            return e ? decoder.decode(await readEntry(bytes, e)) : null;
        },
    };
}

/** What an imported file turned into: one zip per snapshot found in it. */
export interface ImportedSnapshot {
    id: string;
    bytes: Uint8Array;
    tickers: string[];
}

/**
 * Reads an archive picked by the user (a snapshot zip, a bundle of several, or any zip with `<id>/<SYM>.json` entries)
 * and cuts it into one zip per snapshot, copying the compressed entries as they are. Everything is validated before
 * anything is kept: size limits, safe names, ticker names, and that every `<SYM>.json` is a JSON object with a `quotes`
 * array (checked by unpacking it). Throws ZipError with a readable reason otherwise.
 */
export async function importArchive(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): Promise<ImportedSnapshot[]> {
    const snapshots = splitBySnapshot(rawEntries(bytes, limits));
    if (!snapshots.size) throw new ZipError('no <date>/<ticker>.json entries found in this file');
    const out: ImportedSnapshot[] = [];
    for (const [id, entries] of [...snapshots].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const snapshotBytes = buildZipFromRaw(entries, id);
        const snapshot = openSnapshot(id, snapshotBytes, limits);
        if (!snapshot.tickers.length) continue;
        for (const symbol of snapshot.tickers) {
            let parsed: unknown;
            try {
                parsed = JSON.parse((await snapshot.read(symbol)) ?? '');
            } catch {
                throw new ZipError(`${id}/${symbol}.json is not valid`);
            }
            const quotes = (parsed as { quotes?: unknown } | null)?.quotes;
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(quotes)) throw new ZipError(`${id}/${symbol}.json is not an options chain`);
        }
        out.push({ id, bytes: snapshotBytes, tickers: snapshot.tickers });
    }
    if (!out.length) throw new ZipError('no tickers found in this file');
    return out;
}
