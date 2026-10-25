/// <reference lib="esnext" />
import type { Snapshot } from '../backtest/archive';
import { snapshotDate, snapshotLabel, snapshotValuationTime } from '../backtest/snapshot';
import type { DataProvider, TickerSuggestion } from '../types';
import { chainFromCacheFile, staticProvider } from './cache';

// ============================================================================
// "AS OF" PROVIDER - the CACHE provider reading one archived snapshot instead of
// api/options (agentic-workspace docs/repos/gex/spec-backtest.md). It is a mode
// of CACHE, not a fifth provider: the registry of four (rule R2) is unchanged, the
// app builds this one on the fly when a snapshot is chosen.
// ============================================================================

/** Prefix of the id of an "As of" provider: `static@<snapshot id>`. */
export const ASOF_PREFIX = 'static@';

export const asOfProviderId = (snapshotId: string): string => `${ASOF_PREFIX}${snapshotId}`;

/** True for the provider of an archived snapshot. Its results are never written to the shared query cache. */
export const isAsOfProviderId = (providerId: string): boolean => providerId.startsWith(ASOF_PREFIX);

function rank(query: string, symbol: string): number | null {
    const q = query.trim().toUpperCase();
    if (!q) return 0;
    if (symbol === q) return 0;
    if (symbol.startsWith(q)) return 1;
    return symbol.includes(q) ? 2 : null;
}

export function makeAsOfProvider(snapshot: Snapshot): DataProvider {
    const label = snapshotLabel(snapshot.id);
    return {
        ...staticProvider,
        id: asOfProviderId(snapshot.id),
        label: `AS OF ${label}`,
        description: `Archived snapshot of ${label} (market time): the data exactly as it was then. Only the tickers in the archive are listed.`,
        async listTickers() {
            return snapshot.tickers;
        },
        async suggestTickers(query): Promise<TickerSuggestion[]> {
            return snapshot.tickers
                .map((symbol) => ({ symbol, r: rank(query, symbol) }))
                .filter((x): x is { symbol: string; r: number } => x.r !== null)
                .sort((a, b) => a.r - b.r || a.symbol.localeCompare(b.symbol))
                .slice(0, 24)
                .map(({ symbol }) => ({ symbol, source: `Archive ${label}`, hasOptions: true }));
        },
        async fetchAll(symbol) {
            const raw = symbol.toUpperCase();
            const text = await snapshot.read(raw);
            if (text === null) {
                throw new Error(`"${raw}" is not in the archive of ${label}. Tickers in it: ${snapshot.tickers.slice(0, 20).join(', ')}${snapshot.tickers.length > 20 ? ', ...' : ''}.`);
            }
            let parsed: unknown;
            try {
                parsed = JSON.parse(text);
            } catch {
                throw new Error(`${raw} in the archive of ${label} is damaged (not valid JSON).`);
            }
            return chainFromCacheFile(raw, parsed, `${snapshot.id}/${raw}.json`);
        },
    };
}

/** The calendar date of a snapshot: the chart is cut there. */
export const asOfDayOf = snapshotDate;

/** The moment the model greeks of a snapshot are valued at (setValuationTime in greeks.ts): a backup's minute, a day's close. */
export const valuationTimeOf = snapshotValuationTime;
