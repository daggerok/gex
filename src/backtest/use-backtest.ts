/// <reference lib="esnext" />
import { useEffect, useSyncExternalStore } from 'react';
import { createBacktestController, type BacktestController, type BacktestState, type SiteReader } from './controller';
import { createBacktestStore } from './store';

// ============================================================================
// The browser side of the backtest controller: the real IndexedDB store, the site read
// with fetch, and a React hook. One controller for the whole app.
// ============================================================================

const siteReader: SiteReader = {
    async json(path) {
        const res = await fetch(path, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // a host that answers a missing file with its own index.html (200) is not JSON: the parse error says so
        return JSON.parse(await res.text());
    },
    async bytes(path) {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
        return new Uint8Array(await res.arrayBuffer());
    },
};

let controller: BacktestController | null = null;

export function backtestController(): BacktestController {
    return (controller ??= createBacktestController({ store: createBacktestStore(), site: siteReader }));
}

/** The backtest state and the controller. Reads the site and the browser store once, when first used. */
export function useBacktest(): [BacktestState, BacktestController] {
    const c = backtestController();
    const state = useSyncExternalStore(c.subscribe, c.getState, c.getState);
    useEffect(() => { void c.refresh(); }, [c]);
    return [state, c];
}

/** Hands bytes to the browser as a file download. */
export function downloadBytes(filename: string, bytes: Uint8Array): void {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
