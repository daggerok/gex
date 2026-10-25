/// <reference lib="esnext" />
import { useSyncExternalStore } from 'react';

// ============================================================================
// PERSISTED CHOICE - one small remembered UI choice (a string out of a fixed list) kept in
// localStorage under its own key, shared by every component that reads it. Used by the mode
// switches inside the panel chips (ChipSwitch): the Net GEX / Abs GEX view of the Net GEX metric,
// the line / area display of the Zero GEX level and the % / sigma mode of the Chart tab's Sigma
// levels. Every storage access is wrapped in try/catch like the colour stores (gex-colors.ts):
// a private window or a blocked storage just falls back to the default.
// ============================================================================

export interface PersistedChoice<T extends string> {
    readonly key: string;
    readonly fallback: T;
    get(): T;
    set(value: T): void;
    /** React hook: the current value, re-rendering on every change */
    use(): T;
}

/** The stored value when it is one of `allowed`, else `fallback` (missing, unreadable or an old value). */
export function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw != null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
    } catch {
        return fallback;
    }
}

export function persistedChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): PersistedChoice<T> {
    let value: T | null = null; // read lazily, on the first use
    const listeners = new Set<() => void>();
    const get = (): T => (value ??= readChoice(key, allowed, fallback));
    const set = (next: T): void => {
        if (!allowed.includes(next)) return;
        value = next;
        try { localStorage.setItem(key, next); } catch { /* ignore, the choice still holds for this page */ }
        listeners.forEach((l) => l());
    };
    const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
    return { key, fallback, get, set, use: () => useSyncExternalStore(subscribe, get, get) };
}
