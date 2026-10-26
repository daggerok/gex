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
// The probe is GET {proxyBase}/health with a short timeout. The one control is "Auto" (setting `proxyAutoPoll`, owner
// 2026-10-26: "we don't need this many buttons"): ON looks for the proxy at once, every PROXY_POLL_MS and when the tab gets
// focus or becomes visible, so the source switches between live and the cache without a reload; OFF never looks for the
// proxy and never uses it (the cache only), on the published site and locally alike. On the published site Auto ON is
// also the user's consent to contact this computer (Chrome 142+ Local Network Access). A manual override (always the
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
 * True when the page itself is served from this machine (localhost, 127.x, ::1). Such a page starts with Auto ON when
 * nothing is saved yet (settings-store.ts); any other host (GitHub Pages, a LAN address) starts with Auto OFF and makes
 * no request to the proxy until the user turns Auto on, because Chrome 142+ (Local Network Access) would show every
 * visitor a permission prompt. Also decides whether the Chrome hints apply (only off this machine).
 */
export function isLoopbackHost(hostname: string): boolean {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** Trim the base and drop a trailing slash; '' when none is set. */
export function normalizeProxyBase(base: string | null | undefined): string {
    return String(base ?? '').trim().replace(/\/+$/, '');
}

/**
 * Why a probe failed: `network` = the fetch itself rejected with a TypeError (nothing listens, or Chrome blocked this
 * site from reaching the computer; the page cannot tell the two apart), `http` = the proxy answered a non-2xx status,
 * `timeout` = no answer within the timeout, `no-base` = no proxy URL set.
 */
export type ProxyFailure = 'network' | 'http' | 'timeout' | 'no-base';

/** One /health probe with the reason of a failure (never throws). */
export async function probeProxyDetailed(
    base: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = PROXY_PROBE_TIMEOUT_MS,
): Promise<{ up: boolean; failure: ProxyFailure | null }> {
    const b = normalizeProxyBase(base);
    if (!b) return { up: false, failure: 'no-base' };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await fetchImpl(`${b}/health`, { signal: ac.signal, cache: 'no-store' });
        return res.ok ? { up: true, failure: null } : { up: false, failure: 'http' };
    } catch (e) {
        return { up: false, failure: ac.signal.aborted ? 'timeout' : e instanceof TypeError ? 'network' : 'timeout' };
    } finally {
        clearTimeout(timer);
    }
}

/** One /health probe: true when the proxy answers 2xx within the timeout, false otherwise (never throws). */
export async function probeProxy(
    base: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = PROXY_PROBE_TIMEOUT_MS,
): Promise<boolean> {
    return (await probeProxyDetailed(base, fetchImpl, timeoutMs)).up;
}

export interface ProxyDiscovery {
    /** Last probe result; null before the first probe ends, false while no probe is allowed. */
    up: boolean | null;
    /** A probe is running. */
    checking: boolean;
    /** Why the last probe failed (null: it answered, or none ran yet). */
    failure: ProxyFailure | null;
}

/**
 * Probe state for the app. `enabled` false (Auto OFF, or the "always cache" override) means no request at all (up =
 * false). Enabled: probes at once, every PROXY_POLL_MS and on window focus / tab visible, and again when the base changes.
 */
export function useProxyDiscovery(base: string, enabled: boolean): ProxyDiscovery {
    const [state, setState] = useState<ProxyDiscovery>(() => ({ up: enabled ? null : false, checking: false, failure: null }));
    const seq = useRef(0);
    const run = useCallback(async () => {
        const id = ++seq.current;
        setState((s) => (s.checking ? s : { ...s, checking: true }));
        const { up, failure } = await probeProxyDetailed(base);
        if (id !== seq.current) return; // a newer probe (other base, Auto switched) owns the state
        setState((s) => (s.up === up && s.failure === failure && !s.checking ? s : { up, checking: false, failure }));
    }, [base]);

    useEffect(() => {
        if (!enabled) {
            seq.current++;
            setState({ up: false, checking: false, failure: null });
            return;
        }
        // Auto just switched on (or the base changed): unknown until the first probe answers
        setState({ up: null, checking: true, failure: null });
        void run();
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
    }, [enabled, run]);

    return state;
}

/** What the source label next to the ticker says. */
export type SourceLabel =
    | { kind: 'checking' }
    /**
     * `at`: the New York time (hh:mm:ss) of the last live update, for the TradingView live mode (LIVE TV 10:05:07);
     * `progress`: the futures options still joining the proxy's websocket ("ES 3,200/5,560", the tooltip says so)
     */
    | { kind: 'live'; provider: string | null; at?: string; delayedMin?: number; progress?: string }
    | { kind: 'cache'; date: string | null }
    /** an "As of" day of the backtest is open (owner 2026-10-26): its saved data is shown and live is off on purpose */
    | { kind: 'archive'; date: string }
    /** the TradingView live mode cannot stream (session, rate limit, reconnect): the file of `date` is shown meanwhile */
    | { kind: 'tv'; state: string; message: string; until: number | null; date: string | null; progress?: string };

/** What the TradingView live stream of a loaded futures ticker says (src/futures-live.ts useTvLive). */
export interface TvLiveLabelInput {
    /** a snapshot arrived: the data on screen is live */
    streaming: boolean;
    /** New York time of the last applied update, hh:mm:ss */
    at: string;
    /** the engine's state; null before the stream answered */
    status: { state: string; message: string; until: number | null; progress?: string } | null;
    /** a stock or index through the TradingView hybrid: 15 minutes delayed; its failures keep the provider's own label */
    hybrid?: boolean;
    /** futures fast start: "ES 3,200/5,560" while the proxy still subscribes (futures-live.ts subscribedProgress), else null */
    progress?: string | null;
}

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
    /** a futures ticker with the proxy found: the TradingView live stream (null without one) */
    tvLive?: TvLiveLabelInput | null;
    /** the label of the open "As of" snapshot (2026-10-23, or 2026-10-23 16:00 for an own backup); it wins over all else */
    archive?: string | null;
}): SourceLabel {
    if (opts.archive) return { kind: 'archive', date: opts.archive };
    if (opts.tvLive?.hybrid && opts.servedBy) {
        const { streaming, at, status } = opts.tvLive;
        if (streaming && (!status || status.state === 'live')) return { kind: 'live', provider: 'TV', ...(at ? { at } : {}), delayedMin: 15 };
        return { kind: 'live', provider: opts.servedBy.toUpperCase() };
    }
    if (opts.servedBy === 'static' && opts.tvLive) {
        const { streaming, at, status } = opts.tvLive;
        const state = status?.state ?? null;
        if (state && state !== 'live' && state !== 'starting') return { kind: 'tv', state, message: status!.message, until: status!.until, date: opts.futuresAt ?? opts.dataDate };
        // fast start: live from the scanner snapshot on, the websocket subscription runs on (its progress in the tooltip)
        if (streaming) return { kind: 'live', provider: 'TV', ...(at ? { at } : {}), ...(opts.tvLive.progress ? { progress: opts.tvLive.progress } : {}) };
        // the engine is still reading the roots (a few seconds after the proxy starts): say so, the page goes live by itself
        if (state === 'starting') return { kind: 'tv', state, message: status!.message, until: null, date: opts.futuresAt ?? opts.dataDate, ...(status!.progress ? { progress: status!.progress } : {}) };
    }
    if (opts.servedBy === 'static') return { kind: 'cache', date: opts.futuresAt ?? opts.dataDate };
    if (opts.servedBy) return { kind: 'live', provider: opts.servedBy.toUpperCase() };
    if (opts.probing) return { kind: 'checking' };
    return opts.chain[0] === 'static' ? { kind: 'cache', date: null } : { kind: 'live', provider: null };
}

/**
 * Chrome's Local Network Access permission names for a request from a public page to this machine: `loopback-network`
 * (localhost, Chrome 14x+ split) and the older `local-network-access`. Both exist in Chromium 153 (checked 2026-10-26 with
 * Playwright's build); a browser that knows neither throws, which counts as "not denied".
 */
export const LOCAL_NETWORK_PERMISSIONS = ['loopback-network', 'local-network-access'] as const;

/**
 * True when the browser says the user DENIED this site access to the local network, so the proxy probe can never answer
 * (owner 2026-10-26: a blocked prompt looked the same as a stopped proxy). Only asked while `active` (a published page with
 * Auto on). Chrome 153 was seen to report "prompt" for both names while the fetch was blocked, so a failed probe with a
 * network error also gets a hint that names both causes (TopBar); follows a later change in the site settings.
 */
export function useLocalNetworkDenied(active: boolean): boolean {
    const [denied, setDenied] = useState(false);
    useEffect(() => {
        if (!active || typeof navigator === 'undefined' || !navigator.permissions?.query) { setDenied(false); return; }
        let alive = true;
        const statuses: PermissionStatus[] = [];
        const update = () => { if (alive) setDenied(statuses.some((s) => s.state === 'denied')); };
        LOCAL_NETWORK_PERMISSIONS.forEach((name) => {
            navigator.permissions.query({ name: name as PermissionName }).then((s) => {
                if (!alive) return;
                statuses.push(s);
                s.onchange = update;
                update();
            }, () => undefined);
        });
        return () => { alive = false; statuses.forEach((s) => { s.onchange = null; }); };
    }, [active]);
    return denied;
}
