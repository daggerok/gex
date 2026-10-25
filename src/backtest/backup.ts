/// <reference lib="esnext" />
import type { ChainResult, OptionQuote } from '../types';
import { ZipError, buildZipFromRaw, crc32, type RawZipEntry } from '../history-zip';
import { customLevelsEntryName, isoMarketTime, isSnapshotId, isTickerName, manifestEntryName, manifestText, marketDay, sortEntries, tickerEntryName } from './snapshot';

// ============================================================================
// BACKTEST BACKUP MADE IN THE APP - the same archive the CI job makes with
// scripts/backtest-backup.ts: a zip with `<id>/<SYM>.json` for each ticker and
// `<id>/manifest.json`, the entries sorted by name, the id `YYYY-MM-DD-HH-mm`
// (market time). The two are meant to be interchangeable: either can be imported by
// the app, dropped in api/history, or bundled with the other. The test
// backup.test.ts builds both from the same files and compares them.
// ============================================================================

/** The cache-file fields of a quote, in the order scripts/options-data.ts writes them. */
const QUOTE_KEYS = [
    'symbol', 'expiration', 'side', 'strike', 'bid', 'ask', 'mid', 'last', 'volume', 'openInterest', 'iv',
    'delta', 'gamma', 'theta', 'vega', 'rho', 'greeksSource', 'greeksMissingReason',
] as const;

const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function quoteToCacheFile(q: OptionQuote): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of QUOTE_KEYS) {
        const v = (q as unknown as Record<string, unknown>)[k];
        out[k] = typeof v === 'number' ? fin(v) : v === undefined ? null : v;
    }
    return out;
}

/**
 * A chain the app holds as the text of a cache file (`api/options/<SYM>.json`): the same keys in the same order as the
 * fetcher writes (`symbol`, `updated`, `date`, `underlyingPrice`, `greeks`, `expirations`, `quotes`), quotes cut to the
 * fields the fetcher writes. The higher-order model greeks are left out on purpose, as in the CI files: the app computes
 * them again on load, valued on the snapshot's date, which gives what it showed.
 */
export function chainToCacheFile(chain: ChainResult, now: Date = new Date()): string {
    const g = chain.greeks ?? {};
    return JSON.stringify({
        symbol: chain.symbol,
        updated: isoMarketTime(now),
        date: marketDay(now),
        underlyingPrice: fin(chain.underlyingPrice),
        greeks: {
            enabled: g.enabled ?? true,
            primarySource: g.primarySource ?? null,
            fallbackSource: g.fallbackSource ?? 'client-black-scholes',
            riskFreeRate: g.riskFreeRate ?? null,
            dividendYield: g.dividendYield ?? null,
            total: g.total ?? chain.quotes.length,
            cboeMatched: g.cboeMatched ?? 0,
            computed: g.computed ?? 0,
            missing: g.missing ?? 0,
            cboeContracts: g.cboeContracts ?? 0,
        },
        expirations: chain.expirations,
        quotes: chain.quotes.map(quoteToCacheFile),
    });
}

/** Raw-deflate pack with the browser's CompressionStream. */
export async function deflateRawAsync(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One ticker of a backup: its name and the cache-file text. */
export interface BackupFile {
    symbol: string;
    text: string;
}

/**
 * The zip of a backup: `<id>/<SYM>.json` for each file and `<id>/manifest.json` (plus `<id>/custom-levels.json` when given), sorted by entry name, compressed in the
 * browser. `id` is `YYYY-MM-DD-HH-mm`. Read back by openSnapshot, importArchive and the CI side alike.
 */
export async function buildBackupZip(id: string, files: readonly BackupFile[], customLevelsText: string | null = null): Promise<Uint8Array> {
    if (!isSnapshotId(id)) throw new ZipError(`bad snapshot id: ${id}`);
    const bad = files.find((f) => !isTickerName(f.symbol));
    if (bad) throw new ZipError(`not a ticker name: ${bad.symbol}`);
    const enc = new TextEncoder();
    const items = sortEntries([
        ...files.map((f) => ({ name: tickerEntryName(id, f.symbol), data: enc.encode(f.text) })),
        { name: manifestEntryName(id), data: enc.encode(manifestText(id, files.map((f) => f.symbol))) },
        // optional, only when the user has custom levels for the backed up tickers; the manifest stays the same either way
        ...(customLevelsText ? [{ name: customLevelsEntryName(id), data: enc.encode(customLevelsText) }] : []),
    ]);
    const entries: RawZipEntry[] = [];
    for (const item of items) {
        const packed = item.data.length ? await deflateRawAsync(item.data) : item.data;
        entries.push({ name: item.name, method: item.data.length ? 8 : 0, crc32: crc32(item.data), size: item.data.length, compressedSize: packed.length, raw: packed });
    }
    return buildZipFromRaw(entries, id);
}
