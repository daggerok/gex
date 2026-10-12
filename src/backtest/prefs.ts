// ============================================================================
// BACKUP PREFERENCES - the tickers chosen for the last backup, remembered in the
// browser so the next "Create backup" dialog opens with them selected. An empty
// list means "all data" (the default when nothing was ever chosen).
// ============================================================================

const KEY = 'gex.backup.tickers.v1';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

const defaultStorage = (): Storage | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

export function loadBackupTickers(storage: Storage | null = defaultStorage()): string[] {
    try {
        const raw = storage?.getItem(KEY);
        if (!raw) return [];
        const list: unknown = JSON.parse(raw);
        return Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string' && /^[A-Z0-9][A-Z0-9._-]{0,15}$/.test(t)) : [];
    } catch {
        return [];
    }
}

/** Remembers the chosen tickers; an empty list (all data) forgets them. */
export function saveBackupTickers(tickers: readonly string[], storage: Storage | null = defaultStorage()): void {
    try {
        if (tickers.length) storage?.setItem(KEY, JSON.stringify([...new Set(tickers)]));
        else storage?.removeItem(KEY);
    } catch {
        // storage blocked or full: the choice is just not remembered
    }
}

/** Tickers typed or pasted into the dialog: space, comma or semicolon separated, any case, no duplicates, only valid names. */
export function parseTickerInput(text: string): { tickers: string[]; rejected: string[] } {
    const words = text.split(/[\s,;]+/).map((w) => w.trim().toUpperCase()).filter(Boolean);
    const tickers: string[] = [];
    const rejected: string[] = [];
    for (const w of words) {
        if (!/^[A-Z0-9][A-Z0-9._-]{0,15}$/.test(w)) { rejected.push(w); continue; }
        if (!tickers.includes(w)) tickers.push(w);
    }
    return { tickers, rejected };
}
