// ============================================================================
// BACKUP PREFERENCES - what the last backup was made of, remembered in the browser so
// the next "Create backup" dialog opens with it selected. Nothing remembered = the
// preset of required tickers (DEFAULT_TICKERS).
// ============================================================================

const KEY = 'gex.backup.choice.v2';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * What the backup dialog backs up: the preset of required tickers (DEFAULT_TICKERS, the default), the ticker on screen, all
 * available data, or a list of tickers typed by the user.
 */
export type BackupChoice = { mode: 'preset' } | { mode: 'current' } | { mode: 'all' } | { mode: 'custom'; tickers: string[] };

export const PRESET_CHOICE: BackupChoice = { mode: 'preset' };

const TICKER = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;

const defaultStorage = (): Storage | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

/** The choice of the last backup; nothing remembered, damaged or blocked storage gives the preset of required tickers. */
export function loadBackupChoice(storage: Storage | null = defaultStorage()): BackupChoice {
    try {
        const raw = storage?.getItem(KEY);
        if (!raw) return PRESET_CHOICE;
        const j = JSON.parse(raw) as { mode?: unknown; tickers?: unknown };
        if (j.mode === 'all') return { mode: 'all' };
        if (j.mode === 'current') return { mode: 'current' };
        if (j.mode === 'custom' && Array.isArray(j.tickers)) {
            const tickers = [...new Set(j.tickers.filter((t): t is string => typeof t === 'string' && TICKER.test(t)))];
            if (tickers.length) return { mode: 'custom', tickers };
        }
        return PRESET_CHOICE;
    } catch {
        return PRESET_CHOICE;
    }
}

/** Remembers the choice; the preset (the default) is not stored. */
export function saveBackupChoice(choice: BackupChoice, storage: Storage | null = defaultStorage()): void {
    try {
        if (choice.mode === 'preset') storage?.removeItem(KEY);
        else storage?.setItem(KEY, JSON.stringify(choice.mode === 'all' || choice.mode === 'current' ? { mode: choice.mode } : { mode: 'custom', tickers: [...new Set(choice.tickers)] }));
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
