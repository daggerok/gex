// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import { useCallback, useSyncExternalStore } from 'react';
import { loadCustomLevels, saveCustomLevels, type CustomLevel } from './custom-levels';

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

function read(symbol: string): CustomLevel[] {
    if (!symbol) return EMPTY;
    let levels = cache.get(symbol);
    if (!levels) {
        levels = loadCustomLevels(symbol);
        cache.set(symbol, levels);
    }
    return levels;
}

/** Replaces the levels of a symbol. `persist: false` is for a drag in progress, the final value is saved on drop. */
export function setCustomLevels(symbol: string, levels: CustomLevel[], persist = true): void {
    if (!symbol) return;
    cache.set(symbol, levels);
    if (persist) saveCustomLevels(symbol, levels);
    listeners.forEach((l) => l());
}

export function useCustomLevels(symbol: string): [CustomLevel[], (levels: CustomLevel[], persist?: boolean) => void] {
    const levels = useSyncExternalStore(subscribe, () => read(symbol), () => EMPTY);
    const set = useCallback((next: CustomLevel[], persist = true) => setCustomLevels(symbol, next, persist), [symbol]);
    return [levels, set];
}
