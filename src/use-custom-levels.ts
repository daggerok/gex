/// <reference lib="esnext" />
import { useCallback, useSyncExternalStore } from 'react';
import { STORAGE_PREFIX, loadCustomLevels, saveCustomLevels, type CustomLevel } from './custom-levels';

// ============================================================================
// Shared store of the user's custom levels. The Chart tab edits them (right
// click, drag), the GEX tab only shows them, so both read the same per-symbol
// list. In-memory cache + subscribers, persisted to localStorage on demand.
// ============================================================================

const EMPTY: CustomLevel[] = [];
const cache = new Map<string, CustomLevel[]>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

// Backtest ("As of" an archived snapshot): the levels saved in that snapshot are shown instead of the user's own, read-only.
// null = the user's own levels, editable.
let override: Record<string, CustomLevel[]> | null = null;

/** Shows these levels (by ticker) instead of the user's own and locks editing, or null to go back to the user's own. */
export function setCustomLevelsOverride(levels: Record<string, CustomLevel[]> | null): void {
    override = levels;
    listeners.forEach((l) => l());
}

/** True while a snapshot's levels are shown: the Chart and GEX tabs must not open the editor. */
export const customLevelsLocked = (): boolean => override !== null;

/** The levels shown for a symbol right now (the snapshot's while one is open). */
export function readCustomLevels(symbol: string): CustomLevel[] {
    return read(symbol);
}

/** The user's OWN levels of these symbols, whatever is shown now: what a backup made in the app saves. */
export function ownCustomLevels(symbols: readonly string[]): Record<string, CustomLevel[]> {
    const out: Record<string, CustomLevel[]> = {};
    for (const s of symbols) {
        const levels = cache.get(s) ?? loadCustomLevels(s);
        if (levels.length) out[s] = levels;
    }
    return out;
}

function read(symbol: string): CustomLevel[] {
    if (!symbol) return EMPTY;
    if (override) return override[symbol] ?? EMPTY;
    let levels = cache.get(symbol);
    if (!levels) {
        levels = loadCustomLevels(symbol);
        cache.set(symbol, levels);
    }
    return levels;
}

/** Replaces the levels of a symbol. `persist: false` is for a drag in progress, the final value is saved on drop. */
export function setCustomLevels(symbol: string, levels: CustomLevel[], persist = true): void {
    if (!symbol || override) return;
    cache.set(symbol, levels);
    if (persist) saveCustomLevels(symbol, levels);
    listeners.forEach((l) => l());
}

/** Whether editing is locked (a snapshot's levels are shown). */
export function useCustomLevelsLocked(): boolean {
    return useSyncExternalStore(subscribe, customLevelsLocked, () => false);
}

export function useCustomLevels(symbol: string): [CustomLevel[], (levels: CustomLevel[], persist?: boolean) => void] {
    const levels = useSyncExternalStore(subscribe, () => read(symbol), () => EMPTY);
    const set = useCallback((next: CustomLevel[], persist = true) => setCustomLevels(symbol, next, persist), [symbol]);
    return [levels, set];
}

/**
 * Another tab changed localStorage (`key` of a storage event, null when it was cleared): forgets the cached list of that
 * symbol, so the next read loads the other tab's levels and the next save here does not write the stale list over them.
 */
export function customLevelsStorageChanged(key: string | null): void {
    if (key === null) cache.clear();
    else if (key.startsWith(STORAGE_PREFIX)) cache.delete(key.slice(STORAGE_PREFIX.length));
    else return;
    listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') window.addEventListener('storage', (e) => customLevelsStorageChanged(e.key));
