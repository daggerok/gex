/// <reference types="node" />
/// <reference types="bun" />
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { buildZip, extractEntry, parseZipDirectory } from "../src/history-zip";
import { manifestEntryName, manifestText, sortEntries, tickerEntryName } from "../src/backtest/snapshot";

// ============================================================================
// Daily archive of the cache files, see agentic-workspace docs/repos/gex/spec-backtest.md.
// Used by options-data.ts, which passes in how to read the trading day of a file.
//
//   api/history/
//     index.json              the days that exist, rebuilt from the zips on disk
//     2026-10/                one folder per month: delete it to drop the whole month
//       2026-10-09.zip        the automatic end-of-day archive of a trading day (id = the day)
//       2026-10-09-15-42.zip  a backup made on demand with scripts/backtest-backup.ts (id = date and minute)
//
// Cleaning up is just deleting those files and committing: index.json follows the
// disk on the next run (a snapshot whose zip is gone is dropped from it), and the app
// treats a listed snapshot whose zip is missing as unavailable.
// ============================================================================

const enc = new TextEncoder();
const dec = new TextDecoder();
const inflate = (d: Uint8Array) => new Uint8Array(inflateRawSync(d));
const deflate = (d: Uint8Array) => new Uint8Array(deflateRawSync(d, { level: 9 }));

export interface HistoryIndex {
    version: 1;
    /** snapshot id (`YYYY-MM-DD` or `YYYY-MM-DD-HH-mm`) -> tickers in it */
    snapshots: Record<string, string[]>;
}

export interface ArchiveReport {
    /** days whose zip was created or extended, with the tickers added to it */
    added: Record<string, string[]>;
    /** files that were already in their zip (nothing to do) */
    already: number;
}

/** `api/history/<YYYY-MM>/<snapshot id>.zip` */
export function zipPathFor(id: string, historyDir: string): string {
    return join(historyDir, id.slice(0, 7), `${id}.zip`);
}

const MONTH_DIR = /^\d{4}-\d{2}$/;
const SNAPSHOT_ZIP = /^(\d{4}-\d{2}-\d{2}(?:-\d{2}-\d{2})?)\.zip$/;

/** The snapshots that have a zip on disk, found by looking at the month folders (the disk is the truth, not index.json). */
export function snapshotsOnDisk(historyDir: string): string[] {
    const ids: string[] = [];
    let months: string[] = [];
    try {
        months = readdirSync(historyDir).filter((m) => MONTH_DIR.test(m));
    } catch {
        return ids;
    }
    for (const m of months) {
        try {
            for (const f of readdirSync(join(historyDir, m))) {
                const hit = SNAPSHOT_ZIP.exec(f);
                if (hit && hit[1].startsWith(m)) ids.push(hit[1]);
            }
        } catch {
            // not a folder
        }
    }
    return ids.sort();
}

/** Entries of a day zip as name -> bytes, or an empty map when there is none yet. */
function readDayZip(path: string): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    if (!existsSync(path)) return out;
    const bytes = new Uint8Array(readFileSync(path));
    for (const e of parseZipDirectory(bytes)) out.set(e.name, extractEntry(bytes, e, inflate));
    return out;
}

function tickersOf(day: string, entries: Map<string, Uint8Array>): string[] {
    const prefix = `${day}/`;
    return [...entries.keys()]
        .filter((n) => n.startsWith(prefix) && n.endsWith(".json") && n !== `${prefix}manifest.json`)
        .map((n) => n.slice(prefix.length, -".json".length))
        .sort();
}

export function readHistoryIndex(historyDir: string): HistoryIndex {
    try {
        const j = JSON.parse(readFileSync(join(historyDir, "index.json"), "utf8")) as Partial<HistoryIndex>;
        if (j && j.version === 1 && j.snapshots && typeof j.snapshots === "object") return { version: 1, snapshots: j.snapshots };
    } catch {
        // none yet, or damaged: it is rebuilt from the zips below
    }
    return { version: 1, snapshots: {} };
}

/**
 * Adds the cache files that are from an EARLIER trading day than `today` to the zip of their own day. An entry that is
 * already in a zip is never overwritten, so running it again (or after a failed fetch) changes nothing. A zip is only
 * rewritten when something was added. `dayOf` gives the trading day a file's text belongs to (null = not a cache file).
 */
export function archiveEarlierDays(opts: {
    optionsDir: string;
    historyDir: string;
    symbols: readonly string[];
    today: string;
    dayOf: (text: string) => string | null;
}): ArchiveReport {
    const byDay = new Map<string, Array<{ symbol: string; text: string }>>();
    for (const symbol of opts.symbols) {
        let text: string;
        try {
            text = readFileSync(join(opts.optionsDir, `${symbol}.json`), "utf8");
        } catch {
            continue;
        }
        const day = opts.dayOf(text);
        if (!day || day >= opts.today) continue;
        byDay.set(day, [...(byDay.get(day) ?? []), { symbol, text }]);
    }

    const report: ArchiveReport = { added: {}, already: 0 };

    for (const [day, files] of [...byDay].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const path = zipPathFor(day, opts.historyDir);
        const entries = readDayZip(path);
        const added: string[] = [];
        for (const { symbol, text } of files) {
            const name = tickerEntryName(day, symbol);
            if (entries.has(name)) { report.already++; continue; }
            entries.set(name, enc.encode(text));
            added.push(symbol);
        }
        if (added.length) {
            entries.set(manifestEntryName(day), enc.encode(manifestText(day, tickersOf(day, entries))));
            const ordered = sortEntries([...entries].map(([name, data]) => ({ name, data })));
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, buildZip(ordered, day, deflate));
            report.added[day] = added.sort();
        }
    }
    syncHistoryIndex(opts.historyDir, Object.keys(report.added));
    return report;
}

/** The tickers a day zip holds, from the names in its directory (nothing is unpacked). Null for an unreadable zip. */
function tickersFromZipFile(day: string, historyDir: string): string[] | null {
    try {
        const names = parseZipDirectory(new Uint8Array(readFileSync(zipPathFor(day, historyDir)))).map((e) => e.name);
        const prefix = `${day}/`;
        return names
            .filter((n) => n.startsWith(prefix) && n.endsWith(".json") && n !== `${prefix}manifest.json`)
            .map((n) => n.slice(prefix.length, -".json".length))
            .sort();
    } catch {
        return null;
    }
}

/**
 * Makes index.json say exactly what is on disk: a snapshot whose zip was deleted is dropped, a zip that is not listed (copied
 * back by hand) is added, a snapshot already listed keeps its entry unless it is in `touched` (it was just written). Only the
 * directory of those zips is read, so a run stays cheap with months of history. Written only when it changes. Without a
 * history folder nothing is created.
 */
export function syncHistoryIndex(historyDir: string, touched: readonly string[] = []): boolean {
    const onDisk = snapshotsOnDisk(historyDir);
    if (!onDisk.length && !existsSync(join(historyDir, "index.json"))) return false;
    const index = readHistoryIndex(historyDir);
    const snapshots: Record<string, string[]> = {};
    for (const id of onDisk) {
        const known = index.snapshots[id];
        if (known && !touched.includes(id)) { snapshots[id] = known; continue; }
        const tickers = tickersFromZipFile(id, historyDir);
        if (tickers) snapshots[id] = tickers; // an unreadable zip is not listed
    }
    const next = JSON.stringify({ version: 1, snapshots } satisfies HistoryIndex, null, 2) + "\n";
    let current = "";
    try {
        current = readFileSync(join(historyDir, "index.json"), "utf8");
    } catch {
        // none yet
    }
    if (current === next) return false;
    mkdirSync(historyDir, { recursive: true });
    writeFileSync(join(historyDir, "index.json"), next);
    return true;
}

/** Text of one ticker of a day, read from the day zip, or null when it is not there. */
export function readArchived(historyDir: string, day: string, symbol: string): string | null {
    const entries = readDayZip(zipPathFor(day, historyDir));
    const data = entries.get(`${day}/${symbol}.json`);
    return data ? dec.decode(data) : null;
}
