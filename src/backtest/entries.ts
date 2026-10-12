import { isSnapshotId, snapshotLabel } from './snapshot';
import type { StoredDayMeta } from './store';

// ============================================================================
// THE LIST OF SNAPSHOTS THE "AS OF" SELECTOR SHOWS - the days on the site
// (api/history/index.json) merged with the ones the app holds in the browser
// (imported files, backups made in the app, site zips fetched before). Pure, so it
// is tested without a browser. See agentic-workspace docs/repos/gex/spec-backtest.md.
// ============================================================================

/** Where the data of a listed snapshot can be had: the site, the browser, or both (the browser copy is used). */
export type EntrySource = 'site' | 'local' | 'both';

export interface HistoryEntry {
    /** `YYYY-MM-DD` (automatic end-of-day archive) or `YYYY-MM-DD-HH-mm` (a backup) */
    id: string;
    /** `2026-10-09` or `2026-10-09 15:42` */
    label: string;
    source: EntrySource;
    tickers: string[];
    /** bytes of the zip held in the browser, null when it is only on the site */
    size: number | null;
}

/** `api/history/<YYYY-MM>/<id>.zip`, relative like every other static path of the app. */
export const siteZipPath = (id: string): string => `api/history/${id.slice(0, 7)}/${id}.zip`;

/** The snapshots listed by `api/history/index.json`: id -> tickers. Anything malformed is ignored, never thrown. */
export function parseSiteIndex(json: unknown): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const snapshots = (json as { version?: unknown; snapshots?: unknown } | null)?.snapshots;
    if (!snapshots || typeof snapshots !== 'object' || (json as { version?: unknown }).version !== 1) return out;
    for (const [id, tickers] of Object.entries(snapshots as Record<string, unknown>)) {
        if (!isSnapshotId(id) || !Array.isArray(tickers)) continue;
        out.set(id, tickers.filter((t): t is string => typeof t === 'string').sort());
    }
    return out;
}

/**
 * Site and browser snapshots as one list, newest first. A snapshot in both places is one entry that reads from the browser
 * copy (the one the user brought or fetched), marked `both`.
 */
export function mergeEntries(site: ReadonlyMap<string, readonly string[]>, local: ReadonlyArray<Pick<StoredDayMeta, 'day' | 'source' | 'size' | 'tickers'>>): HistoryEntry[] {
    const byId = new Map<string, HistoryEntry>();
    for (const [id, tickers] of site) byId.set(id, { id, label: snapshotLabel(id), source: 'site', tickers: [...tickers], size: null });
    for (const m of local) {
        const onSite = site.has(m.day);
        // a site zip that was only fetched and kept is still "site" for the user, an imported or app-made one is "local"
        const source: EntrySource = onSite ? (m.source === 'local' ? 'both' : 'site') : 'local';
        byId.set(m.day, { id: m.day, label: snapshotLabel(m.day), source, tickers: [...m.tickers], size: m.size });
    }
    return [...byId.values()].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/**
 * The text of the grey, informational item of the selector: "today" while a live provider is reachable, otherwise the date of
 * the latest cache file (`api/latest.json`) so the user knows how old what they see is.
 */
export function liveLabel(opts: { liveReachable: boolean; latestDate: string | null }): { kind: 'today' | 'latest'; date: string | null } {
    if (opts.liveReachable) return { kind: 'today', date: null };
    return { kind: 'latest', date: opts.latestDate };
}

/** Parses `api/latest.json` (`{ version: 1, date }`), null when it is missing or malformed. */
export function parseLatest(json: unknown): string | null {
    const date = (json as { version?: unknown; date?: unknown } | null)?.date;
    return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/**
 * The ticker to show when a snapshot is opened: the only ticker of a single-ticker backup; otherwise the ticker stored as the
 * last one (`preferred`) when the snapshot has it; otherwise the first ticker of the snapshot. Null when it has none.
 */
export function pickTickerForSnapshot(tickers: readonly string[], preferred: string | null | undefined): string | null {
    if (!tickers.length) return null;
    if (tickers.length === 1) return tickers[0];
    const want = (preferred ?? '').trim().toUpperCase();
    return want && tickers.includes(want) ? want : tickers[0];
}
