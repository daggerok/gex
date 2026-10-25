/// <reference lib="esnext" />
// ============================================================================
// SNAPSHOT FORMAT - the parts of a backtest zip that the CI jobs (scripts/) and the
// app must produce identically, in one place. A snapshot zip holds
// `<id>/<SYM>.json` for each ticker and `<id>/manifest.json`, sorted by entry name.
// Pure, no Node and no browser APIs. See agentic-workspace docs/repos/gex/spec-backtest.md.
// ============================================================================

export const MARKET_TZ = 'America/New_York';

const TICKER_NAME = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;
const ID_RE = /^\d{4}-\d{2}-\d{2}(-\d{2}-\d{2})?$/;

/** A ticker name that is safe to use as a file name inside an archive. */
export const isTickerName = (s: string): boolean => TICKER_NAME.test(s);

/** `YYYY-MM-DD` (automatic end-of-day archive) or `YYYY-MM-DD-HH-mm` (a backup made on demand). */
export const isSnapshotId = (id: string): boolean => ID_RE.test(id);

/** The calendar date (`YYYY-MM-DD`) of a snapshot id: what the app values the greeks on and cuts the chart at. */
export const snapshotDate = (id: string): string => id.slice(0, 10);

/** `2026-10-09` stays, `2026-10-09-15-42` becomes `2026-10-09 15:42` (market time). */
export function snapshotLabel(id: string): string {
    return id.length > 10 ? `${id.slice(0, 10)} ${id.slice(11, 13)}:${id.slice(14, 16)}` : id;
}

/** `<id>/<SYM>.json` */
export const tickerEntryName = (id: string, symbol: string): string => `${id}/${symbol}.json`;

/** `<id>/manifest.json` */
export const manifestEntryName = (id: string): string => `${id}/manifest.json`;

/** `<id>/custom-levels.json`: the user's custom chart levels, only in backups made in the app (a CI backup cannot know them). */
export const customLevelsEntryName = (id: string): string => `${id}/custom-levels.json`;

/** Text of `<id>/manifest.json`: the same for every kind of snapshot, whoever writes it. */
export function manifestText(id: string, tickers: readonly string[]): string {
    return JSON.stringify({ version: 1, id, date: snapshotDate(id), tickers: [...tickers].sort() }) + '\n';
}

/** `YYYY-MM-DD-HH-mm` of a moment in market time. */
export function backupStamp(now: Date, tz: string = MARKET_TZ): string {
    const p: Record<string, string> = {};
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    for (const part of fmt.formatToParts(now)) if (part.type !== 'literal') p[part.type] = part.value;
    return `${p.year}-${p.month}-${p.day}-${p.hour}-${p.minute}`;
}

/** The id of a new backup: the current minute, moved forward while a snapshot with that id already exists (never overwrites). */
export function nextBackupId(now: Date, taken: ReadonlySet<string>, tz: string = MARKET_TZ): string {
    let t = Math.floor(now.getTime() / 60_000) * 60_000;
    for (let i = 0; i < 100_000; i++, t += 60_000) {
        const id = backupStamp(new Date(t), tz);
        if (!taken.has(id)) return id;
    }
    throw new Error('could not find a free backup id');
}

/** Entries of a snapshot in the order they are written: by name, so the manifest comes after the tickers. */
export function sortEntries<T extends { name: string }>(entries: readonly T[]): T[] {
    return [...entries].sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Year, month, day, hour, minute, second of a moment on the wall clock of a time zone. */
function wall(now: Date, tz: string) {
    const p: Record<string, number> = {};
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    for (const part of fmt.formatToParts(now)) if (part.type !== 'literal') p[part.type] = Number(part.value);
    return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/**
 * The trading day (ISO date, market time) data fetched at `now` belongs to: a weekday from 9:30 on is that day, before 9:30
 * and on a weekend it is still the previous weekday's close. Holidays are not known, a holiday keeps the weekday label.
 * The fetcher writes this as `date` in every cache file and the app writes the same for a backup it makes.
 */
export function marketDay(now: Date = new Date(), tz: string = MARKET_TZ): string {
    const w = wall(now, tz);
    const DAY = 86_400_000;
    const weekday = (t: number) => (new Date(t).getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
    let t = Date.UTC(w.year, w.month - 1, w.day);
    if (weekday(t) <= 4 && w.hour * 60 + w.minute < 9 * 60 + 30) t -= DAY;
    while (weekday(t) > 4) t -= DAY;
    return new Date(t).toISOString().slice(0, 10);
}

/** `2026-10-11T20:51:20.414000-04:00`: the time stamp format of `updated` in a cache file (market time with its UTC offset). */
export function isoMarketTime(now: Date = new Date(), tz: string = MARKET_TZ): string {
    const w = wall(now, tz);
    const ms = ((now.getTime() % 1000) + 1000) % 1000;
    const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    const offMin = Math.round((wallAsUtc - Math.floor(now.getTime() / 1000) * 1000) / 60000);
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    const sign = offMin < 0 ? '-' : '+';
    const a = Math.abs(offMin);
    const frac = ms ? `.${pad(ms, 3)}000` : '';
    return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${frac}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
