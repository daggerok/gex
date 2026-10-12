#!/usr/bin/env bun
/// <reference types="node" />
/// <reference types="bun" />
/**
 * =============================================================================
 * GEX - backtest backup (Bun TypeScript)
 * =============================================================================
 *
 * Copies the cache files of api/options into ONE zip, api/history/<YYYY-MM>/<YYYY-MM-DD-HH-mm>.zip, a snapshot of what
 * the app can show right now. The name is the creation time in market time (America/New_York) to the minute. A backup
 * is never overwritten: if that minute is taken the minute moves forward, so many backups of the same date all stay.
 * The app lists them in the "As of" selector and a backup is read like any other archive (agentic-workspace
 * docs/repos/gex/spec-backtest.md).
 *
 * USAGE
 *   bun scripts/backtest-backup.ts                 # ALL available data: every ticker file of api/options
 *   bun scripts/backtest-backup.ts all             # the same, written out
 *   bun scripts/backtest-backup.ts SPY NDX         # only these tickers (space or comma separated)
 *   bun scripts/backtest-backup.ts SPY,QQQ
 *   bun run backtest:backup SPY NDX                # the same through package.json
 *
 * In CI (agentic-workspace docs/repos/gex/spec-backtest.md): .github/workflows/backtest-backup.yml runs it by hand with
 * the tickers you type (empty = all), and update-default-data.yml runs it every hour when the repository variable
 * BACKTEST_TICKERS is set (`all` or a ticker list). A ticker that has no file in api/options is an error and nothing is written. Each file is copied byte for byte, so
 * the backup holds exactly what the cache held at that moment. Run it after a data refresh (or after fetching the
 * tickers you care about with ./scripts/options-data.ts SPY NDX... via TICKERS=) as often as needed, for example every hour
 * of a week, then study the backups in the app and delete the ones you do not want (delete the zip, or a whole month
 * folder, and commit; api/history/index.json follows the disk on the next data run).
 *
 * Size: a ticker file is 0.1 to 3 MB before zipping (about 7 times less in the zip). All of api/options is a few
 * thousand files, so a backup of everything is tens of MB, a backup of a few tickers is well under 1 MB.
 * =============================================================================
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";
import { buildZip } from "../src/history-zip";
import { backupStamp, isTickerName, manifestEntryName, manifestText, nextBackupId, sortEntries, tickerEntryName } from "../src/backtest/snapshot";
export { backupStamp, nextBackupId };
import { snapshotsOnDisk, syncHistoryIndex, zipPathFor } from "./history-archive";

const REPO_ROOT = dirname(import.meta.dirname);
const OPTIONS_DIR = join(REPO_ROOT, "api", "options");
const HISTORY_DIR = join(REPO_ROOT, "api", "history");
const TICKER_FILE = /^([A-Z0-9][A-Z0-9._-]{0,15})\.json$/;

export interface BackupArgs {
    /** null = every available ticker */
    tickers: string[] | null;
    help: boolean;
}

/**
 * Tickers from the command line: space or comma separated, any case, no duplicates. No tickers, or the word `all`, means
 * everything. A word that is not a ticker name is an error (the CI passes user input here).
 */
export function parseArgs(argv: readonly string[]): BackupArgs {
    const help = argv.some((a) => a === "--help" || a === "-h");
    const words = [...new Set(argv.filter((a) => !a.startsWith("-")).flatMap((a) => a.split(",")).map((t) => t.trim().toUpperCase()).filter(Boolean))];
    const bad = words.filter((w) => w !== "ALL" && !isTickerName(w));
    if (bad.length) throw new Error(`not a ticker name: ${bad.join(", ")}`);
    const tickers = words.filter((w) => w !== "ALL");
    return { tickers: tickers.length && !words.includes("ALL") ? tickers : null, help };
}

/** Ticker files of a folder (everything `<SYM>.json` except the index), sorted. */
export function availableTickers(optionsDir: string): string[] {
    return readdirSync(optionsDir)
        .map((f) => TICKER_FILE.exec(f)?.[1])
        .filter((t): t is string => Boolean(t))
        .sort();
}

export interface BackupResult {
    id: string;
    path: string;
    tickers: string[];
    zipBytes: number;
    sourceBytes: number;
}

/**
 * Writes the backup zip. `symbols` null = all available tickers. Throws, before writing anything, when a requested ticker
 * has no file or there is nothing to back up.
 */
export function createBackup(opts: { optionsDir: string; historyDir: string; symbols: readonly string[] | null; now?: Date }): BackupResult {
    const available = availableTickers(opts.optionsDir);
    const tickers = opts.symbols === null ? available : [...opts.symbols].sort();
    const missing = tickers.filter((t) => !available.includes(t));
    if (missing.length) throw new Error(`no file in api/options for: ${missing.join(", ")}`);
    if (!tickers.length) throw new Error("nothing to back up (api/options has no ticker files)");

    const id = nextBackupId(opts.now ?? new Date(), new Set(snapshotsOnDisk(opts.historyDir)));
    let sourceBytes = 0;
    const files = tickers.map((t) => {
        const data = new Uint8Array(readFileSync(join(opts.optionsDir, `${t}.json`)));
        sourceBytes += data.length;
        return { name: tickerEntryName(id, t), data };
    });
    files.push({ name: manifestEntryName(id), data: new TextEncoder().encode(manifestText(id, tickers)) });

    const zip = buildZip(sortEntries(files), id, (d) => new Uint8Array(deflateRawSync(d)));
    const path = zipPathFor(id, opts.historyDir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, zip, { flag: "wx" }); // never overwrites
    syncHistoryIndex(opts.historyDir, [id]);
    return { id, path, tickers, zipBytes: zip.length, sourceBytes };
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log("usage: bun scripts/backtest-backup.ts [TICKER ...]   (no tickers = all available data)");
        return;
    }
    const r = createBackup({ optionsDir: OPTIONS_DIR, historyDir: HISTORY_DIR, symbols: args.tickers });
    const mb = (n: number) => (n / 1e6).toFixed(2);
    const what = args.tickers ? r.tickers.join(", ") : `all ${r.tickers.length} available tickers`;
    console.log(`[ backup   ] ${r.id}  ${what}`);
    console.log(`[ backup   ] ${relative(REPO_ROOT, r.path)}  ${mb(r.zipBytes)} MB zipped (${mb(r.sourceBytes)} MB of data)`);
}

if (import.meta.main) {
    try {
        main();
    } catch (e) {
        console.error(`[ backup   ] ${e instanceof Error ? e.message : e}`);
        process.exit(1);
    }
}
