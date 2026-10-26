/// <reference lib="esnext" />
import { useEffect, useRef, useState } from 'react';
import { normalizeProxyBase } from './proxy-discovery';
import { chainFromCacheFile, futuresFile } from './providers/cache';
import { getBulk, putBulk, withoutExpired } from './providers/loader';
import type { ChainMeta, ChainResult, OptionQuote } from './types';
import { type LiveGreeksCache, liveFuturesGreeks, liveFuturesSpot, liveGreeksCrossCheck } from './vix-pricing';

// ============================================================================
// TRADINGVIEW LIVE MODE in the app (owner 2026-10-26, PR #202)
// README: "Local proxy and TradingView live mode"; protocol: workspace docs/repos/gex/architecture.md
// ============================================================================
//
// The local proxy runs the TradingView engine (scripts/tv/live.ts) and streams, per futures root:
//   GET {proxyBase}/api/futures/live?root=ES   server-sent events
//     status    {state, message, until, since}            engine state: live, reconnecting, expired, no-session...
//     snapshot  {root, payload}                           the whole chain, the api/futures/ES.json object
//     delta     {root, updated, rows: [[name, bid, ask, last, volume, openInterest]]}   changed options, batched
//     greeks    {root, at, rows: [[name, iv, delta, gamma, theta, vega, rho]]}          TradingView's scanner greeks
// The page keeps the chain in memory, applies every event in place and hands a new ChainResult to the app at most once per
// LIVE_APPLY_MS: the greeks of every two-sided option come from its own mid (Black-76 on the parity forward,
// vix-pricing.ts liveFuturesGreeks, R1), TradingView's scanner greeks fill the rest and serve as the cross-check. The app
// puts the result into the CACHE provider's memory and re-reads the selected expirations (main.tsx), so tabs,
// expirations and scroll positions stay. No stream (no proxy, an older proxy, GEX_TV=0): the api/futures file as before.

/** The app re-reads the chain (and recomputes the levels) at most this often. */
export const LIVE_APPLY_MS = 1000;
/** ... and never less often than this, however heavy one update is. */
export const LIVE_APPLY_MAX_MS = 5000;
/** One update may cost at most this share of the main thread: a heavy one (every expiration of ES selected) waits longer. */
export const LIVE_APPLY_BUDGET = 0.05;

/**
 * The wait before the next live update: LIVE_APPLY_MS, or longer when the last one took `lastMs` of main thread, so the
 * updates stay within LIVE_APPLY_BUDGET of a core (measured: one expiration of ES 15 ms, all 20 expirations 80 ms).
 */
export function liveApplyDelay(lastMs: number | null): number {
    if (lastMs == null || !Number.isFinite(lastMs) || lastMs <= 0) return LIVE_APPLY_MS;
    return Math.min(LIVE_APPLY_MAX_MS, Math.max(LIVE_APPLY_MS, Math.round(lastMs / LIVE_APPLY_BUDGET)));
}

export type TvLiveState = 'starting' | 'live' | 'reconnecting' | 'no-session' | 'expired' | 'rate-limited' | 'error' | 'off';

export interface TvLiveStatus {
    state: TvLiveState;
    message: string;
    until: number | null;
    since: number;
}

/** The live stream of one root on the proxy. */
export function futuresLiveUrl(base: string, root: string): string {
    return `${normalizeProxyBase(base)}/api/futures/live?root=${encodeURIComponent(root)}`;
}

/** A value row of a delta: [name, bid, ask, last, volume, openInterest]. */
export type LiveValueRow = [string, number | null, number | null, number | null, number | null, number | null];
/** A row of TradingView greeks: [name, iv, delta, gamma, theta, vega, rho]. */
export type LiveGreekRow = [string, number | null, number | null, number | null, number | null, number | null, number | null];

type RawQuote = Record<string, unknown> & { symbol: string };
type RawPayload = Record<string, unknown> & { quotes: RawQuote[] };

/**
 * The chain of one root as the stream left it: the snapshot's file object with the deltas and greeks applied, by option
 * name. `toChain` builds the app's ChainResult with the live greeks.
 */
export class LiveChainState {
    private base: RawPayload | null = null;
    private readonly byName = new Map<string, RawQuote>();
    /** TradingView's scanner gamma by option, for the cross-check */
    readonly tvGamma = new Map<string, number>();
    private readonly cache: LiveGreeksCache = new Map();
    /** something changed since the last toChain */
    dirty = false;
    /** when the last delta was made on the proxy (ISO), else the snapshot's `updated` */
    updated: string | null = null;
    /** the last cross-check (median relative gamma difference near the money), null before one */
    crossCheck: number | null = null;

    get ready(): boolean {
        return this.base !== null;
    }

    applySnapshot(payload: RawPayload): void {
        this.base = payload;
        this.byName.clear();
        for (const q of payload.quotes) {
            this.byName.set(q.symbol, q);
            const g = q.gamma;
            if (typeof g === 'number') this.tvGamma.set(q.symbol, g);
        }
        this.updated = typeof payload.updated === 'string' ? payload.updated : null;
        this.cache.clear();
        this.dirty = true;
    }

    applyDelta(updated: string | null, rows: readonly LiveValueRow[]): void {
        if (!this.base) return;
        for (const [name, bid, ask, last, volume, oi] of rows) {
            const q = this.byName.get(name);
            if (!q) continue; // a new option comes with the next snapshot
            q.bid = bid;
            q.ask = ask;
            q.mid = bid != null && ask != null ? (bid + ask) / 2 : null;
            q.last = last;
            q.volume = volume;
            q.openInterest = oi;
            this.dirty = true;
        }
        if (updated) this.updated = updated;
    }

    applyGreeks(rows: readonly LiveGreekRow[]): void {
        if (!this.base) return;
        for (const [name, iv, delta, gamma, theta, vega, rho] of rows) {
            const q = this.byName.get(name);
            if (!q) continue;
            Object.assign(q, { iv, delta, gamma, theta, vega, rho });
            if (gamma != null) this.tvGamma.set(name, gamma); else this.tvGamma.delete(name);
        }
        this.dirty = true;
    }

    /** The chain for the app (null before the snapshot): live greeks from the mids, spot = the parity forward. */
    toChain(symbol: string): ChainResult | null {
        if (!this.base) return null;
        this.dirty = false;
        const file = futuresFile(symbol);
        const raw = { ...this.base, quotes: Array.from(this.byName.values()), updated: this.updated ?? this.base.updated };
        const parsed = chainFromCacheFile(file?.symbol ?? symbol, raw, 'live');
        const quotes = liveFuturesGreeks(parsed.quotes as OptionQuote[], this.cache);
        // the cache keys carry the minute: drop the old ones now and then
        if (this.cache.size > quotes.length * 4) this.cache.clear();
        this.crossCheck = liveGreeksCrossCheck(quotes, this.tvGamma);
        const spot = liveFuturesSpot(quotes) ?? parsed.underlyingPrice;
        return { ...parsed, quotes, underlyingPrice: spot };
    }
}

export interface TvLive {
    /** the engine's state (null before the stream answered: no live stream known) */
    status: TvLiveStatus | null;
    /** the stream delivered a snapshot: the app shows live data */
    streaming: boolean;
    /** time (ISO) of the last applied update */
    updated: string | null;
}

/**
 * Subscribe to the proxy's live stream of `root` while it is set (a futures ticker is loaded, the proxy is found and
 * allowed). `onChain` gets a new chain at most every LIVE_APPLY_MS while updates arrive. The EventSource reconnects by
 * itself when the proxy restarts; an older proxy without the endpoint answers 404 and nothing changes.
 */
export function useTvLive(base: string, symbol: string | null, onChain: (chain: ChainResult) => void): TvLive {
    const [live, setLive] = useState<TvLive>({ status: null, streaming: false, updated: null });
    const handler = useRef(onChain);
    handler.current = onChain;
    const root = symbol ? futuresFile(symbol)?.root ?? null : null;
    useEffect(() => {
        setLive({ status: null, streaming: false, updated: null });
        if (!root || !symbol || !normalizeProxyBase(base) || typeof EventSource === 'undefined') return undefined;
        const state = new LiveChainState();
        const es = new EventSource(futuresLiveUrl(base, root));
        const read = (ev: MessageEvent): any => {
            try { return JSON.parse(String(ev.data)); } catch { return null; }
        };
        es.addEventListener('status', (ev) => {
            const s = read(ev as MessageEvent) as TvLiveStatus | null;
            if (s && typeof s.state === 'string') setLive((l) => ({ ...l, status: s }));
        });
        es.addEventListener('snapshot', (ev) => {
            const d = read(ev as MessageEvent) as { root?: string; payload?: RawPayload } | null;
            if (d?.root === root && d.payload && Array.isArray(d.payload.quotes)) state.applySnapshot(d.payload);
        });
        es.addEventListener('delta', (ev) => {
            const d = read(ev as MessageEvent) as { root?: string; updated?: string; rows?: LiveValueRow[] } | null;
            if (d?.root === root && Array.isArray(d.rows)) state.applyDelta(d.updated ?? null, d.rows);
        });
        es.addEventListener('greeks', (ev) => {
            const d = read(ev as MessageEvent) as { root?: string; rows?: LiveGreekRow[] } | null;
            if (d?.root === root && Array.isArray(d.rows)) state.applyGreeks(d.rows);
        });
        let timer = 0;
        const step = () => {
            let wait = LIVE_APPLY_MS;
            if (state.dirty && state.ready) {
                const t0 = performance.now();
                const chain = state.toChain(symbol);
                if (chain) {
                    setLive((l) => ({ ...l, streaming: true, updated: state.updated }));
                    handler.current(chain);
                }
                // the cost of the previous update up to its commit (main.tsx measures 'futures-live-reload'), plus this build
                const measures = performance.getEntriesByName('futures-live-reload');
                const last = measures.length ? measures[measures.length - 1].duration : null;
                if (measures.length > 50) performance.clearMeasures('futures-live-reload');
                wait = liveApplyDelay((last ?? 0) + (performance.now() - t0));
            }
            timer = window.setTimeout(step, wait);
        };
        timer = window.setTimeout(step, LIVE_APPLY_MS);
        return () => {
            window.clearTimeout(timer);
            es.close();
        };
    }, [base, root, symbol]);
    return live;
}

/** "2026-10-26T14:05:07.123Z" -> "10:05:07" (New York time, the label LIVE TV hh:mm:ss); '' when unreadable. */
export function nyTime(iso: string | null): string {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t)) return '';
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(t));
}

/**
 * Put a live chain into the CACHE provider's memory (not the persistent cache: it changes every second) and return its
 * meta without the expirations that are over; the app sets it as the new meta, so the selected expirations load from it.
 */
export async function applyLiveChain(chain: ChainResult, vixFuturesPricing: boolean): Promise<ChainMeta> {
    await putBulk('static', chain, vixFuturesPricing, false);
    const cached = (await getBulk('static', chain.symbol, vixFuturesPricing)) ?? chain;
    return withoutExpired({
        symbol: cached.symbol, underlyingPrice: cached.underlyingPrice, expirations: cached.expirations, greeks: cached.greeks,
        updated: cached.updated ?? null, dataDate: cached.dataDate ?? null,
    });
}
