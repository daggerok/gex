import type { ChainResult, DataProvider, OptionQuote, ProviderContext } from '../types';
import { getBulk, loadExpiration, loadMeta } from '../providers/loader';
import { customLevelsFileText, type CustomLevel } from '../custom-levels';
import { buildBackupZip, chainToCacheFile, type BackupFile } from './backup';
import { nextBackupId } from './snapshot';

// ============================================================================
// BACKUP MAKER - collects the chains of the chosen tickers from the provider in
// use (live proxy providers, the CACHE files, or an "As of" snapshot) and builds
// the same zip the CI job makes (see backup.ts).
// ============================================================================

/** One ticker's whole chain from a provider, bulk or lazy. */
export async function loadFullChain(provider: DataProvider, symbol: string, ctx: ProviderContext, vixFuturesPricing = false): Promise<ChainResult> {
    const meta = await loadMeta(provider, symbol, ctx, vixFuturesPricing);
    if (provider.mode === 'bulk') {
        const chain = await getBulk(provider.id, meta.symbol, vixFuturesPricing);
        if (!chain) throw new Error(`${symbol}: no data`);
        return chain;
    }
    const quotes: OptionQuote[] = [];
    for (const exp of meta.expirations) quotes.push(...(await loadExpiration(provider, meta.symbol, exp, ctx, vixFuturesPricing)));
    return { symbol: meta.symbol, underlyingPrice: meta.underlyingPrice, expirations: meta.expirations, quotes, greeks: meta.greeks };
}

export interface BackupProgress {
    done: number;
    total: number;
    symbol: string;
}

export interface BackupOutcome {
    id: string;
    bytes: Uint8Array;
    tickers: string[];
    failed: Array<{ symbol: string; reason: string }>;
}

/**
 * Makes a backup. `symbols` null = all the provider lists. Chains are loaded a few at a time, a ticker that fails is
 * reported and left out (the others still make the backup), the whole run can be aborted with `signal`. `taken` are the ids
 * that already exist (stored and on the site), so a new backup never overwrites one.
 */
export async function makeBackup(opts: {
    provider: DataProvider;
    ctx: ProviderContext;
    symbols: readonly string[] | null;
    taken: ReadonlySet<string>;
    now?: Date;
    vixFuturesPricing?: boolean;
    /** The user's custom levels by ticker; those of the backed up tickers go into the zip as `custom-levels.json`. */
    customLevels?: Readonly<Record<string, readonly CustomLevel[]>>;
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (p: BackupProgress) => void;
}): Promise<BackupOutcome> {
    const now = opts.now ?? new Date();
    const symbols = opts.symbols ? [...opts.symbols] : opts.provider.listTickers ? await opts.provider.listTickers(opts.ctx) : [];
    if (!symbols.length) throw new Error('nothing to back up: no tickers');
    const files: BackupFile[] = [];
    const failed: BackupOutcome['failed'] = [];
    let next = 0;
    let done = 0;
    const worker = async () => {
        while (next < symbols.length) {
            if (opts.signal?.aborted) return;
            const symbol = symbols[next++];
            try {
                const chain = await loadFullChain(opts.provider, symbol, opts.ctx, opts.vixFuturesPricing);
                files.push({ symbol: chain.symbol.toUpperCase(), text: chainToCacheFile(chain, now) });
            } catch (e) {
                if (opts.signal?.aborted) return;
                failed.push({ symbol, reason: e instanceof Error ? e.message : String(e) });
            }
            opts.onProgress?.({ done: ++done, total: symbols.length, symbol });
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, symbols.length)) }, worker));
    if (opts.signal?.aborted) throw new DOMException('backup cancelled', 'AbortError');
    if (!files.length) throw new Error(`no ticker could be loaded: ${failed.map((f) => `${f.symbol} (${f.reason})`).join('; ')}`);
    const id = nextBackupId(now, opts.taken);
    const tickers = files.map((f) => f.symbol).sort();
    const bytes = await buildBackupZip(id, files, opts.customLevels ? customLevelsFileText(opts.customLevels, tickers) : null);
    return { id, bytes, tickers, failed };
}
