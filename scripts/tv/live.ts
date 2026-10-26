/// <reference types="node" />
/// <reference types="bun" />
/**
 * TradingView live mode of the local proxy (owner 2026-10-26, PR #202). README: "Local proxy and TradingView live mode";
 * internals: workspace docs/repos/gex/architecture.md "TradingView live mode".
 *
 * `bun run proxy` (and `all`, `start`) runs this engine in the proxy's own process: the futures watcher of
 * scripts/tv/futures.ts (one websocket, quote sessions of up to 3,000 options, the scanner every LIVE_REFRESH_MS) and a
 * server-sent events stream per futures root for the app:
 *
 *   GET /api/futures/status          {"engine":true,"state":"live","message":"...","until":null,"since":...,"roots":["ES",...]}
 *   GET /api/futures/live?root=ES    text/event-stream:
 *       event: status    {"state","message","until","since"}               on connect and on every change
 *       event: snapshot  {"root","payload":<the api/futures/ES.json object>} on connect, after a reconnect, when the
 *                                                                           option window moves
 *       event: delta     {"root","updated","rows":[[name, bid, ask, last, volume, openInterest, oiDate], ...]}
 *                        the options that changed, at most every LIVE_FLUSH_MS, only when something changed
 *       event: greeks    {"root","at","rows":[[name, iv, delta, gamma, theta, vega, rho], ...]}
 *                        TradingView's scanner greeks (the app's cross-check), after every scanner read
 *   GET /api/futures/ES.json         the file the engine writes (on change, every LIVE_WRITE_MS)
 *
 * Session handling is automatic: the env file is read on every token request; when it is missing or the session is
 * rejected the engine imports the session from Chrome (tv:session logic, scripts/tv/session.ts), at most once per new
 * Chrome login (chromeSessionFingerprint, so the macOS Keychain dialog shows at most once), and tries again every
 * SESSION_RETRY_MS. Rate limits pause with a growing backoff (futures.ts rateLimitPauseMs). No session value or token
 * passes through here (the watcher reads and redacts them).
 *
 * R1: no math here. The app computes the greeks from the streamed mids (src/vix-pricing.ts liveFuturesGreeks).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FUTURES_DIR, payloadText, TV_ROOTS } from './chain';
import { FuturesWatcher, type LiveGreekRow, type LiveValueRow, type WatcherHooks, type WatcherStatus } from './futures';
import { chromeSessionFingerprint, importSessionFromChrome, type ImportResult } from './session';
import type { Payload } from '../options-data';

/** Deltas go out at most this often per root (batched). */
export const LIVE_FLUSH_MS = 500;
/** The files api/futures/<ROOT>.json are rewritten this often, and only when something changed. */
export const LIVE_WRITE_MS = 15_000;
/** The scanner (TradingView's greeks, the cross-check of the app's own) and the option list are read this often. */
export const LIVE_REFRESH_MS = 60_000;
/** A missing or expired session is looked at again this often (a Chrome import only when the Chrome cookie changed). */
export const SESSION_RETRY_MS = 3 * 60_000;
/** An SSE comment this often keeps idle connections open. */
export const SSE_KEEPALIVE_MS = 15_000;

/** Whether the proxy runs the engine: always, unless GEX_TV=0. The note is the one line the proxy prints instead. */
export type EngineDecision = { start: true } | { start: false; note: string };

export function engineDecision(env: Record<string, string | undefined>): EngineDecision {
    return env.GEX_TV === '0' ? { start: false, note: 'TV     | TradingView live mode off (GEX_TV=0)' } : { start: true };
}

/** One SSE message. */
export function sseEvent(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
}

/** "CME_MINI:E4A261026C7630" -> "E4A261026C7630" (the file's quote symbol). */
export function quoteName(tvSymbol: string): string {
    return tvSymbol.slice(tvSymbol.indexOf(':') + 1);
}

/** The snapshot event: the file's own JSON writer (byte for byte api/futures/<ROOT>.json), wrapped with the root. */
export function snapshotEvent(root: string, payload: Payload): string {
    return `event: snapshot\ndata: {"root":${JSON.stringify(root)},"payload":${payloadText(payload).replace(/\n/g, ' ')}}\n\n`;
}

/** GET /api/futures/<ROOT>.json from `dir`: the file, 404 before it is written, 400 for anything that is not a root. */
export function futuresFileResponse(pathname: string, dir: string = FUTURES_DIR): Response {
    const m = /^\/api\/futures\/([A-Z0-9]{1,5})\.json$/.exec(pathname);
    if (!m || !TV_ROOTS[m[1]]) return new Response(JSON.stringify({ error: 'not a futures file' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const path = join(dir, `${m[1]}.json`);
    if (!existsSync(path)) return new Response(JSON.stringify({ error: `no ${m[1]}.json yet` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(Bun.file(path), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/** The parts of the watcher the engine uses (a fake in the tests). */
export interface WatcherLike {
    readonly status: WatcherStatus;
    runWatch(): Promise<void>;
    stop(): void;
    readyRoots(): string[];
    snapshot(root: string): Payload | null;
    valueRows(root: string, symbols: Iterable<string>): LiveValueRow[];
    greekRows(root: string): LiveGreekRow[];
}

export interface EngineOptions {
    roots?: string[];
    log?: (line: string) => void;
    /** tests: a fake watcher */
    makeWatcher?: (roots: string[], hooks: WatcherHooks) => WatcherLike;
    /** tests: a fake Chrome import */
    importSession?: (log: (line: string) => void) => Promise<ImportResult>;
    fingerprint?: () => string | null;
    flushMs?: number;
    retryMs?: number;
}

interface Client {
    root: string;
    controller: ReadableStreamDefaultController<Uint8Array>;
}

export class TvLiveEngine {
    private watcher: WatcherLike | null = null;
    private running = false;
    /** the current watcher got through its start (a later expiry is recovered from onStatus, a failed start from run) */
    private started = false;
    private readonly clients = new Set<Client>();
    private readonly dirty = new Map<string, Set<string>>();
    private readonly enc = new TextEncoder();
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private keepalive: ReturnType<typeof setInterval> | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    /** the Chrome cookie fingerprint the last import used (undefined: none tried yet) */
    private triedFingerprint: string | null | undefined = undefined;
    private importing = false;
    /** what to tell the user while the session is missing or expired (set by the last Chrome import) */
    private sessionHint: string | null = null;
    private stopped = false;
    private statusNow: WatcherStatus = { state: 'starting', message: 'starting', until: null, since: Date.now() };
    readonly roots: string[];
    /** counters for the logs and the CPU notes */
    stats = { deltas: 0, quotes: 0, snapshots: 0, values: 0 };

    constructor(private readonly opts: EngineOptions = {}) {
        this.roots = (opts.roots ?? ['ES', 'NQ', 'YM', 'RTY']).filter((r) => TV_ROOTS[r]);
    }

    get status(): WatcherStatus {
        return this.statusNow;
    }

    private log(line: string): void {
        (this.opts.log ?? ((l: string) => console.log(`TV     | [${new Date().toTimeString().slice(0, 8)}] ${l}`)))(line);
    }

    start(): void {
        this.flushTimer = setInterval(() => this.flush(), this.opts.flushMs ?? LIVE_FLUSH_MS);
        this.keepalive = setInterval(() => this.broadcastAll(': keepalive\n\n'), SSE_KEEPALIVE_MS);
        void this.run();
    }

    stop(): void {
        this.stopped = true;
        this.watcher?.stop();
        if (this.flushTimer) clearInterval(this.flushTimer);
        if (this.keepalive) clearInterval(this.keepalive);
        if (this.retryTimer) clearTimeout(this.retryTimer);
        for (const c of Array.from(this.clients)) {
            try { c.controller.close(); } catch { /* gone */ }
        }
        this.clients.clear();
    }

    private hooks(): WatcherHooks {
        return {
            writeOnlyOnChange: true,
            log: (line) => this.log(line),
            onStatus: (s) => this.onStatus(s),
            onValues: (root, symbols) => {
                this.stats.values++;
                let set = this.dirty.get(root);
                if (!set) this.dirty.set(root, (set = new Set()));
                for (const s of symbols) set.add(s);
            },
            onWindow: (root) => this.sendSnapshot(root),
            onGreeks: (root) => this.sendGreeks(root),
        };
    }

    /** Start the watcher; when it cannot (no session, expired, rate limited) try to fix the session and come back later. */
    private async run(): Promise<void> {
        if (this.stopped || this.running) return;
        this.running = true;
        const w = this.opts.makeWatcher
            ? this.opts.makeWatcher(this.roots, this.hooks())
            : new FuturesWatcher({ roots: this.roots, once: false, watchMs: LIVE_WRITE_MS, refreshMs: LIVE_REFRESH_MS, help: false }, this.hooks());
        this.watcher = w;
        try {
            await w.runWatch();
            this.started = true;
        } catch (err) {
            w.stop();
            this.watcher = null;
            this.running = false;
            this.started = false;
            this.onStatus(w.status.state === 'starting' ? { ...w.status, state: 'error', message: (err as Error).message } : w.status);
            if (await this.recoverSession()) return this.run();
            const wait = w.status.state === 'rate-limited' && w.status.until ? Math.max(w.status.until - Date.now(), 1000) : (this.opts.retryMs ?? SESSION_RETRY_MS);
            this.log(`live mode waits: ${this.statusNow.message}; next try in ${Math.round(wait / 1000)} s`);
            if (!this.stopped) this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.run(); }, wait);
        }
    }

    private onStatus(s: WatcherStatus): void {
        const needsLogin = s.state === 'expired' || s.state === 'no-session';
        if (!needsLogin) this.sessionHint = null;
        this.statusNow = needsLogin && this.sessionHint ? { ...s, message: this.sessionHint } : s;
        s = this.statusNow;
        this.broadcastAll(sseEvent('status', s));
        // a running watcher whose session expired: import a new one (it reads the env file at its next renewal)
        if (this.started && needsLogin) void this.recoverSession();
    }

    /**
     * Import the session from Chrome when the Chrome cookie changed since the last try (or was never tried). True when a
     * new session was written. Never more than one import at a time.
     */
    private async recoverSession(): Promise<boolean> {
        if (this.importing || this.stopped) return false;
        if (this.statusNow.state !== 'no-session' && this.statusNow.state !== 'expired') return false;
        const fp = (this.opts.fingerprint ?? chromeSessionFingerprint)();
        if (fp === this.triedFingerprint) return false;
        this.triedFingerprint = fp;
        if (fp == null) {
            this.sessionHint = 'no TradingView session: log in to tradingview.com in Chrome (or run bun run tv:session)';
            this.onStatus(this.statusNow);
            return false;
        }
        this.importing = true;
        try {
            const r = await (this.opts.importSession ?? ((log) => importSessionFromChrome(log)))((l) => this.log(l));
            if (r.ok) this.log(r.changed ? `session imported from Chrome (${r.profile})` : `Chrome holds the same session (${r.profile}): log in to tradingview.com in Chrome again`);
            else this.log(r.reason);
            if (!r.ok || !r.changed) {
                this.sessionHint = r.ok ? 'the TradingView session in Chrome is expired too: log in to tradingview.com in Chrome' : r.reason;
                this.onStatus(this.statusNow);
            }
            return r.ok && r.changed;
        } finally {
            this.importing = false;
        }
    }

    /** The JSON of GET /api/futures/status. */
    statusJson(): Record<string, unknown> {
        return { engine: true, ...this.statusNow, roots: this.watcher ? this.watcher.readyRoots() : [] };
    }

    /** GET /api/futures/live?root=ES: status, the snapshot when ready, then the deltas. */
    response(root: string): Response {
        const r = root.trim().toUpperCase();
        if (!this.roots.includes(r)) return new Response(JSON.stringify({ error: `not a live root: ${root} (live: ${this.roots.join(', ')})` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        let me: Client | null = null;
        const stream = new ReadableStream<Uint8Array>({
            start: (controller) => {
                const c: Client = { root: r, controller };
                me = c;
                this.clients.add(c);
                this.send(c, sseEvent('status', this.statusNow));
                const snap = this.watcher?.snapshot(r);
                if (snap) {
                    this.stats.snapshots++;
                    this.send(c, snapshotEvent(r, snap));
                }
            },
            cancel: () => { if (me) this.clients.delete(me); },
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
    }

    get clientCount(): number {
        return this.clients.size;
    }

    private sendSnapshot(root: string): void {
        this.dirty.delete(root);
        const targets = Array.from(this.clients).filter((c) => c.root === root);
        if (!targets.length) return;
        const snap = this.watcher?.snapshot(root);
        if (!snap) return;
        this.stats.snapshots++;
        const ev = snapshotEvent(root, snap);
        targets.forEach((c) => this.send(c, ev));
    }

    private sendGreeks(root: string): void {
        const targets = Array.from(this.clients).filter((c) => c.root === root);
        if (!targets.length || !this.watcher) return;
        const ev = sseEvent('greeks', { root, at: new Date().toISOString(), rows: this.watcher.greekRows(root) });
        targets.forEach((c) => this.send(c, ev));
    }

    /** Every LIVE_FLUSH_MS: one delta per root with clients and changes (changes of roots nobody watches are dropped). */
    flush(): void {
        if (!this.watcher) return;
        this.dirty.forEach((symbols, root) => {
            if (!symbols.size) return;
            const targets = Array.from(this.clients).filter((c) => c.root === root);
            const rows = targets.length ? this.watcher!.valueRows(root, symbols) : [];
            symbols.clear();
            if (!rows.length) return;
            this.stats.deltas++;
            this.stats.quotes += rows.length;
            const ev = sseEvent('delta', { root, updated: new Date().toISOString(), rows });
            targets.forEach((c) => this.send(c, ev));
        });
    }

    private send(c: Client, text: string): void {
        try {
            c.controller.enqueue(this.enc.encode(text));
        } catch {
            this.clients.delete(c);
        }
    }

    private broadcastAll(text: string): void {
        for (const c of Array.from(this.clients)) this.send(c, text);
    }
}
