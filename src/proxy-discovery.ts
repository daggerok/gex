/// <reference lib="esnext" />
import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================================
// AUTO PROXY DISCOVERY (owner, 2026-10-25)
// ============================================================================
//
// The app finds the local proxy (scripts/options-local-proxy.ts, default http://localhost:8787) by itself instead of a
// provider menu and a cache / live switch:
//   - proxy up   -> live data, per ticker CBOE -> YAHOO -> NASDAQ, the cache as the last fallback
//   - proxy down -> the cache, never an error
// The probe is GET {proxyBase}/health with a short timeout. "Proxy auto-discovery" (persisted, default OFF) decides how
// often: OFF probes ONCE on page load (start or stop the proxy -> refresh the page), ON probes every PROXY_POLL_MS and
// when the tab gets focus or becomes visible, so the source switches without a reload. A manual override (always the
// cache, or one fixed provider) lives in the advanced settings. The Chart tab follows the same result.

/** How long the /health probe may take before the proxy counts as down. */
export const PROXY_PROBE_TIMEOUT_MS = 500;
/** Interval of the periodic probe while "Proxy auto-discovery" is ON. */
export const PROXY_POLL_MS = 30_000;
/** Default proxy base: the local Bun proxy (`bun run proxy`). */
export const DEFAULT_PROXY_BASE = 'http://localhost:8787';

/** The live providers in the order Auto tries them for a ticker; the cache comes after them. */
export const AUTO_LIVE_ORDER = ['cboe', 'yahoo', 'nasdaq'] as const;
export type LiveProviderId = typeof AUTO_LIVE_ORDER[number];
export type SourceProviderId = LiveProviderId | 'static';

/** Data source setting: 'auto' (default) or a manual override from the advanced settings. */
export type SourceOverride = 'auto' | SourceProviderId;
export const SOURCE_OVERRIDES: readonly SourceOverride[] = ['auto', 'static', ...AUTO_LIVE_ORDER];

/** A saved value that is not a known override (missing, removed, wrong type) is Auto. */
export function sanitizeSourceOverride(v: unknown): SourceOverride {
    return typeof v === 'string' && (SOURCE_OVERRIDES as readonly string[]).includes(v) ? (v as SourceOverride) : 'auto';
}

/**
 * The providers to try for a ticker, first to last.
 * - `proxyUp`: the last probe result (null = not known yet, counts as down)
 * - `proxyAllowed`: false when the page may not talk to the proxy at all (then only the cache is used, whatever the
 *   override says, so no request leaves for the proxy)
 */
export function sourceChain(override: SourceOverride, proxyUp: boolean | null, proxyAllowed = true): SourceProviderId[] {
    if (override === 'static' || !proxyAllowed) return ['static'];
    if (override !== 'auto') return [override];
    return proxyUp === true ? [...AUTO_LIVE_ORDER, 'static'] : ['static'];
}

/**
 * True when the page itself is served from this machine (localhost, 127.x, ::1): only such a page probes the proxy
 * without asking. Any other host (GitHub Pages, a LAN address) makes no request to the proxy unless the user opts in,
 * because Chrome 142+ (Local Network Access) would show every visitor a permission prompt, and the proxy's CORS
 * allowlist (scripts/proxy-cors.ts) refuses LAN origins anyway.
 */
export function isLoopbackHost(hostname: string): boolean {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** Trim the base and drop a trailing slash; '' when none is set. */
export function normalizeProxyBase(base: string | null | undefined): string {
    return String(base ?? '').trim().replace(/\/+$/, '');
}

/** One /health probe: true when the proxy answers 2xx within the timeout, false otherwise (never throws). */
export async function probeProxy(
    base: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = PROXY_PROBE_TIMEOUT_MS,
): Promise<boolean> {
    const b = normalizeProxyBase(base);
    if (!b) return false;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await fetchImpl(`${b}/health`, { signal: ac.signal, cache: 'no-store' });
        return res.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

export interface ProxyDiscovery {
    /** Last probe result; null before the first probe ends, false while no probe is allowed. */
    up: boolean | null;
    /** A probe is running. */
    checking: boolean;
}

/**
 * Probe state for the app. `enabled` false means no request at all (up = false). Probes once on mount and whenever the
 * base or `enabled` changes; with `poll` also every PROXY_POLL_MS and on window focus / tab visible.
 */
export function useProxyDiscovery(base: string, enabled: boolean, poll: boolean): ProxyDiscovery {
    const [state, setState] = useState<ProxyDiscovery>(() => ({ up: enabled ? null : false, checking: false }));
    const seq = useRef(0);
    const run = useCallback(async () => {
        const id = ++seq.current;
        setState((s) => (s.checking ? s : { ...s, checking: true }));
        const up = await probeProxy(base);
        if (id !== seq.current) return; // a newer probe (other base) owns the state
        setState((s) => (s.up === up && !s.checking ? s : { up, checking: false }));
    }, [base]);

    // the one probe on load (and after a change of the base or the permission)
    useEffect(() => {
        if (!enabled) {
            seq.current++;
            setState({ up: false, checking: false });
            return;
        }
        void run();
    }, [enabled, run]);

    // periodic probing only while "Proxy auto-discovery" is ON
    useEffect(() => {
        if (!enabled || !poll) return;
        const timer = window.setInterval(() => { void run(); }, PROXY_POLL_MS);
        const onFocus = () => { void run(); };
        const onVisible = () => { if (document.visibilityState === 'visible') void run(); };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [enabled, poll, run]);

    return state;
}

/** What the source label next to the ticker says. */
export type SourceLabel =
    | { kind: 'checking' }
    | { kind: 'live'; provider: string | null }
    | { kind: 'cache'; date: string | null };

/**
 * The source label: the provider that served the loaded ticker (LIVE CBOE, CACHE 2026-10-23), or before a ticker is
 * loaded what the next load would use (LIVE / CACHE / checking while the first probe runs).
 */
export function sourceLabel(opts: {
    chain: readonly SourceProviderId[];
    probing: boolean;
    servedBy: SourceProviderId | null;
    dataDate: string | null;
    /**
     * A futures ticker (api/futures, PR #202): the loaded file's own time ("2026-10-25 21:40", New York, the Desk's "as
     * of"), which replaces the trading day (owner bug: CACHE 2026-10-23 next to "as of 2026-10-25 21:40 ET").
     */
    futuresAt?: string | null;
}): SourceLabel {
    if (opts.servedBy === 'static') return { kind: 'cache', date: opts.futuresAt ?? opts.dataDate };
    if (opts.servedBy) return { kind: 'live', provider: opts.servedBy.toUpperCase() };
    if (opts.probing) return { kind: 'checking' };
    return opts.chain[0] === 'static' ? { kind: 'cache', date: null } : { kind: 'live', provider: null };
}
