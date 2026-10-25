/// <reference lib="esnext" />
import type { CustomLevel } from '../custom-levels';
import { mergeZips, ZipError } from '../history-zip';
import { importArchive, openSnapshot, type Snapshot } from './archive';
import { mergeEntries, parseLatest, parseSiteIndex, siteZipPath, type HistoryEntry } from './entries';
import { snapshotLabel } from './snapshot';
import type { BacktestStore } from './store';
import { daysOlderThan } from './store';

// ============================================================================
// BACKTEST CONTROLLER - everything the "As of" feature does, with no React and no
// browser globals: it is given the store and the two ways to read the site, so the
// logic is tested with the in-memory store and a fake site (controller.test.ts).
// use-backtest.ts wraps it for the components. See agentic-workspace
// docs/repos/gex/spec-backtest.md.
// ============================================================================

/** The snapshot the app is showing in backtest mode. */
export interface ActiveSnapshot {
    id: string;
    label: string;
    snapshot: Snapshot;
    /** the custom levels saved in the snapshot (read-only while viewing it) */
    customLevels: Record<string, CustomLevel[]>;
}

export interface BacktestState {
    entries: HistoryEntry[];
    /** date of the newest cache file, from api/latest.json (null when unknown) */
    latestDate: string | null;
    active: ActiveSnapshot | null;
    /** a snapshot is being opened (a site zip is being fetched) */
    loading: boolean;
    error: string | null;
}

export interface SiteReader {
    json(path: string): Promise<unknown>;
    bytes(path: string): Promise<Uint8Array>;
}

export interface ImportReport {
    /** snapshot ids kept */
    added: string[];
    /** `<file name>: <reason>` for every file that was refused, the others are still kept */
    errors: string[];
}

export interface BacktestController {
    getState(): BacktestState;
    subscribe(listener: () => void): () => void;
    /** Reads api/history/index.json, api/latest.json and what the browser holds. Never throws (a missing site index is an empty list). */
    refresh(): Promise<void>;
    /** Opens a snapshot (null = back to live). A snapshot that cannot be opened sets `error` and keeps the previous mode. */
    select(id: string | null): Promise<void>;
    importFiles(files: ReadonlyArray<{ name: string; bytes: () => Promise<Uint8Array> }>): Promise<ImportReport>;
    /** Stores a backup made in the app (source local). */
    saveBackup(id: string, bytes: Uint8Array, tickers: string[]): Promise<void>;
    remove(ids: readonly string[]): Promise<void>;
    removeOlderThan(date: string): Promise<string[]>;
    clearAll(): Promise<void>;
    /** One zip for one id (its own file), or several bundled into ONE zip with the entries copied as they are. */
    download(ids: readonly string[]): Promise<{ filename: string; bytes: Uint8Array }>;
    /** Every id that exists (site or browser), so a new backup never takes one. */
    takenIds(): Set<string>;
    clearError(): void;
}

export function createBacktestController(deps: { store: BacktestStore; site: SiteReader; now?: () => number }): BacktestController {
    const { store, site } = deps;
    const now = deps.now ?? (() => Date.now());
    /** Bumped by every select (null too), see select. */
    let selectSeq = 0;
    let state: BacktestState = { entries: [], latestDate: null, active: null, loading: false, error: null };
    let siteIndex = new Map<string, string[]>();
    const listeners = new Set<() => void>();
    const set = (patch: Partial<BacktestState>) => {
        state = { ...state, ...patch };
        listeners.forEach((l) => l());
    };
    const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

    async function rebuildEntries(): Promise<void> {
        set({ entries: mergeEntries(siteIndex, await store.list()) });
    }

    async function bytesOf(id: string): Promise<Uint8Array> {
        const held = await store.get(id);
        if (held) return held.bytes;
        if (!siteIndex.has(id)) throw new Error(`${id} is not available`);
        return site.bytes(siteZipPath(id));
    }

    const controller: BacktestController = {
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        async refresh() {
            const [index, latest] = await Promise.all([
                site.json('api/history/index.json').catch(() => null),
                site.json('api/latest.json').catch(() => null),
            ]);
            siteIndex = parseSiteIndex(index);
            set({ latestDate: parseLatest(latest) });
            try {
                await rebuildEntries();
            } catch (e) {
                // blocked storage: the site list still works
                set({ entries: mergeEntries(siteIndex, []), error: `The browser storage is not available: ${errorText(e)}` });
            }
        },
        async select(id) {
            // GEX-M8: each call supersedes the one before; a slow zip that finishes later must not reopen its snapshot
            const seq = ++selectSeq;
            const current = () => seq === selectSeq;
            if (id === null) {
                set({ active: null, error: null, loading: false });
                return;
            }
            set({ loading: true, error: null });
            try {
                const held = await store.get(id);
                let bytes: Uint8Array;
                if (held) bytes = held.bytes;
                else {
                    if (!siteIndex.has(id)) throw new Error(`${snapshotLabel(id)} is not in the archive`);
                    bytes = await site.bytes(siteZipPath(id));
                }
                const snapshot = openSnapshot(id, bytes);
                if (!snapshot.tickers.length) throw new ZipError(`${snapshotLabel(id)} has no tickers`);
                const customLevels = await snapshot.customLevels();
                if (!held) {
                    // kept in the browser so it works offline and shows in the manager until the owner cleans it up
                    await store.put({ day: id, source: 'site', size: bytes.length, tickers: snapshot.tickers, addedAt: now(), bytes }).catch(() => undefined);
                    await rebuildEntries().catch(() => undefined);
                }
                if (!current()) return; // kept in the browser above, but the user has moved on
                set({ active: { id, label: snapshotLabel(id), snapshot, customLevels }, loading: false });
            } catch (e) {
                if (!current()) return;
                set({ loading: false, error: `Could not open ${snapshotLabel(id)}: ${errorText(e)}` });
            }
        },
        async importFiles(files) {
            const report: ImportReport = { added: [], errors: [] };
            for (const f of files) {
                try {
                    for (const s of await importArchive(await f.bytes())) {
                        await store.put({ day: s.id, source: 'local', size: s.bytes.length, tickers: s.tickers, addedAt: now(), bytes: s.bytes });
                        report.added.push(s.id);
                    }
                } catch (e) {
                    report.errors.push(`${f.name}: ${errorText(e)}`);
                }
            }
            await rebuildEntries();
            // an imported snapshot replaces what is open under the same id: open it again
            if (state.active && report.added.includes(state.active.id)) await controller.select(state.active.id);
            return report;
        },
        async saveBackup(id, bytes, tickers) {
            await store.put({ day: id, source: 'local', size: bytes.length, tickers, addedAt: now(), bytes });
            await rebuildEntries();
        },
        async remove(ids) {
            await store.remove(ids);
            await rebuildEntries();
            // the open snapshot is gone: back to live, unless the site still has it
            if (state.active && ids.includes(state.active.id) && !siteIndex.has(state.active.id)) set({ active: null });
        },
        async removeOlderThan(date) {
            const ids = daysOlderThan(await store.list(), date);
            if (ids.length) await controller.remove(ids);
            return ids;
        },
        async clearAll() {
            await store.clear();
            await rebuildEntries();
            if (state.active && !siteIndex.has(state.active.id)) set({ active: null });
        },
        async download(ids) {
            if (!ids.length) throw new Error('nothing selected');
            if (ids.length === 1) return { filename: `${ids[0]}.zip`, bytes: await bytesOf(ids[0]) };
            const sorted = [...ids].sort();
            const zips: Uint8Array[] = [];
            for (const id of sorted) zips.push(await bytesOf(id));
            return { filename: `gex-history-${sorted[0]}_${sorted[sorted.length - 1]}.zip`, bytes: mergeZips(zips) };
        },
        takenIds() {
            return new Set(Array.from(siteIndex.keys()).concat(state.entries.map((e) => e.id)));
        },
        clearError() {
            if (state.error) set({ error: null });
        },
    };
    return controller;
}
