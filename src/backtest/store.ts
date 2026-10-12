// ============================================================================
// BACKTEST STORE - the day zips the app holds, kept in the browser until the
// owner cleans them up (agentic-workspace docs/repos/gex/spec-backtest.md). A
// separate IndexedDB database, NOT the query cache of settings-store.ts, so the
// size-based eviction of that cache never deletes backtest data. The interface
// is small so the logic can be tested with the in-memory version.
// ============================================================================

/** site = fetched from the deployed archive, local = imported from a file or made in the app */
export type DaySource = 'site' | 'local';

export interface StoredDayMeta {
    /** snapshot id: `YYYY-MM-DD` (automatic end-of-day archive) or `YYYY-MM-DD-HH-mm` (a backup made on demand) */
    day: string;
    source: DaySource;
    /** bytes of the day zip */
    size: number;
    tickers: string[];
    /** epoch ms */
    addedAt: number;
}

export interface StoredDay extends StoredDayMeta {
    bytes: Uint8Array;
}

export interface BacktestStore {
    /** Metadata of every held day, oldest day first. */
    list(): Promise<StoredDayMeta[]>;
    get(day: string): Promise<StoredDay | null>;
    /** Adds or replaces a day. */
    put(day: StoredDay): Promise<void>;
    remove(days: readonly string[]): Promise<void>;
    clear(): Promise<void>;
}

/**
 * The snapshots from a calendar date BEFORE `date` (`YYYY-MM-DD`): what "remove older than" removes. Everything on `date`
 * itself, the end-of-day archive and every backup made that day, is kept.
 */
export function daysOlderThan(metas: ReadonlyArray<Pick<StoredDayMeta, 'day'>>, date: string): string[] {
    return metas.filter((m) => m.day.slice(0, 10) < date).map((m) => m.day).sort();
}

const meta = (d: StoredDay): StoredDayMeta => ({ day: d.day, source: d.source, size: d.size, tickers: d.tickers, addedAt: d.addedAt });
const byDay = (a: StoredDayMeta, b: StoredDayMeta) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);

export function createMemoryStore(): BacktestStore {
    const days = new Map<string, StoredDay>();
    return {
        async list() { return [...days.values()].map(meta).sort(byDay); },
        async get(day) { return days.get(day) ?? null; },
        async put(d) { days.set(d.day, { ...d }); },
        async remove(list) { for (const d of list) days.delete(d); },
        async clear() { days.clear(); },
    };
}

const DB_NAME = 'gex-backtest-db';
const STORE = 'days';

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

/** The IndexedDB store, or the in-memory one when IndexedDB is not available (private windows, blocked storage). */
export function createBacktestStore(): BacktestStore {
    if (typeof indexedDB === 'undefined') return createMemoryStore();
    let dbPromise: Promise<IDBDatabase> | null = null;
    const open = (): Promise<IDBDatabase> => {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'day' }); };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        return dbPromise;
    };
    const store = async (mode: IDBTransactionMode) => {
        const tx = (await open()).transaction(STORE, mode);
        return { tx, os: tx.objectStore(STORE) };
    };
    return {
        async list() {
            const { os } = await store('readonly');
            const all = await request(os.getAll() as IDBRequest<StoredDay[]>);
            return all.map(meta).sort(byDay);
        },
        async get(day) {
            const { os } = await store('readonly');
            return (await request(os.get(day) as IDBRequest<StoredDay | undefined>)) ?? null;
        },
        async put(d) {
            const { tx, os } = await store('readwrite');
            os.put(d);
            await done(tx);
        },
        async remove(list) {
            const { tx, os } = await store('readwrite');
            for (const d of list) os.delete(d);
            await done(tx);
        },
        async clear() {
            const { tx, os } = await store('readwrite');
            os.clear();
            await done(tx);
        },
    };
}
