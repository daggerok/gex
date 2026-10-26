#!/usr/bin/env bun
/// <reference types="node" />
/// <reference types="bun" />
/**
 * bun run tv:futures - futures options GEX data from the owner's TradingView session (README "Local proxy and TradingView
 * live mode"; the proxy runs the same FuturesWatcher in its live mode, scripts/tv/live.ts). Runs only on the owner's machine
 * (the session never goes to CI); the files api/futures/<ROOT>.json are committed by hand and published with the site
 * (owner 2026-10-25: `bun run tv:futures --once`, commit, push; may be removed later for space). The session
 * and the token never reach a file or a log line (env.ts redact()).
 *
 *   bun run tv:futures                 ES, NQ, YM, RTY; rewrites the files every minute until Ctrl+C (--watch 1m)
 *   bun run tv:futures --micros        also MES, MNQ, MYM, M2K (their option chains are separate)
 *   bun run tv:futures --once ES       one pass for ES, then exit
 *   bun run tv:futures --watch 2m --refresh 10m NQ
 *
 * How (one websocket, one quote session per root, both kept open):
 *  1. the logged-in chart page gives the auth token (a 4 h JWT, refreshed AUTH_REFRESH_BEFORE_MS before it expires)
 *  2. per root (the root a page opened first, rootOrder): the continuous future (ES1!) gives the front contract and
 *     `options-info` (every option series and its strikes); every date up to and including the nearest monthly (3rd
 *     Friday) on the front contract within +/- WINDOW_PCT of the forward is watched (chain.ts)
 *  3. fast start (owner 2026-10-26): one or two scanner POSTs per root give bid, ask, iv and greeks of the whole window;
 *     with the open interest of the last file (equal to the CME Daily Bulletin) that is the first snapshot, about 1 s
 *     per root after the websocket opened. The scanner is read again every --refresh (5m), which also re-reads
 *     options-info so new strikes and series follow the forward (added / removed in the session)
 *  4. in the background the options join the websocket 50 per message, the most important first (subscriptionOrder:
 *     the page's root, its selected expirations, strikes nearest the forward of the nearest expirations); each one
 *     streams OI (`oi`), volume, bid, ask and last from its first answer on (mergeOption: websocket over scanner)
 *  5. every --watch the latest values are written to api/futures/<ROOT>.json (and dist/api/futures/ when dist/api
 *     exists, which is what `bun run start` serves), atomically, in exactly the fetcher's schema (chain.ts buildPayload)
 *  6. a dropped socket reconnects with backoff (RECONNECT_MIN_MS doubling to RECONNECT_MAX_MS); a 429 or 403 from
 *     TradingView pauses every HTTP request for RATE_LIMIT_BACKOFF_MS; the last values keep being written meanwhile
 *
 * The app opens the file through the CACHE provider: ticker `/ES` (or `ES1!`), see src/providers/cache.ts futuresFile.
 * Never touches api/options (index.json included). Never prints the session or the token.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { writeFileAtomic } from '../history-archive';
import { marketDay, type Payload } from '../options-data';
import {
    buildPayload, DEFAULT_ROOTS, DIST_FUTURES_DIR, familiesOf, fileRowsOf, FUTURES_DIR, futuresPrice, mergeOption, MICRO_ROOTS, payloadText,
    allocateSessions, QUOTE_FIELDS, rootOrder, scanGreeks, subscriptionOrder, TV_ROOTS, TvRateLimitError, WS_BATCH, WS_BATCH_PAUSE_MS,
    WS_BATCH_TIMEOUT_MS, wantedOptions, type Family, type FileRow, type QuoteValues, type ScanRow, type WantedOption,
} from './chain';
import { jwtExpiresAt, loadTvSession, redact, sleep, type TvSession } from './env';
import { fetchAuthToken, randomId, type TvMessage, TvSocket } from './ws';

export const DEFAULT_WATCH_MS = 60_000;
export const DEFAULT_REFRESH_MS = 5 * 60_000;
/** Get a new auth token this long before the old one expires. */
export const AUTH_REFRESH_BEFORE_MS = 15 * 60_000;
/** A failed token renewal (session expired, network) is tried again after this long. */
export const AUTH_RETRY_MS = 3 * 60_000;
/** Assumed token lifetime when its `exp` cannot be read (TradingView issues 4 h tokens). */
export const AUTH_FALLBACK_LIFETIME_MS = 3.5 * 60 * 60_000;
/** Pause of every HTTP request after a 429 or 403; doubles with every further one in a row, up to RATE_LIMIT_MAX_MS. */
export const RATE_LIMIT_BACKOFF_MS = 15 * 60_000;
export const RATE_LIMIT_MAX_MS = 2 * 60 * 60_000;

/** The pause after the `hits`-th 429 / 403 in a row: 15 min, 30 min, 1 h, 2 h, 2 h... */
export function rateLimitPauseMs(hits: number): number {
    return Math.min(RATE_LIMIT_BACKOFF_MS * Math.pow(2, Math.max(0, hits - 1)), RATE_LIMIT_MAX_MS);
}
/**
 * Debug: `TV_RENEW_EVERY_MS=180000` renews the token at least this often (instead of only AUTH_REFRESH_BEFORE_MS before
 * it expires), to exercise the renewal path in minutes instead of hours. Unset in normal use.
 */
export const RENEW_EVERY_MS: number | null = Number(process.env.TV_RENEW_EVERY_MS) >= 60_000 ? Number(process.env.TV_RENEW_EVERY_MS) : null;

/** When the token is renewed: AUTH_REFRESH_BEFORE_MS before it expires, or sooner with the debug `renewEveryMs`. */
export function renewDueAt(expiresAt: number, now: number, renewEveryMs: number | null = RENEW_EVERY_MS): number {
    const due = expiresAt - AUTH_REFRESH_BEFORE_MS;
    return renewEveryMs != null ? Math.min(due, now + renewEveryMs) : due;
}
export const RECONNECT_MIN_MS = 5_000;
export const RECONNECT_MAX_MS = 5 * 60_000;
/**
 * A socket with no frame for this long is treated as dropped (half-open after a network change or a sleep: no close
 * event ever comes). TradingView sends a heartbeat about every 10-20 s, so 90 s is several missed ones.
 */
export const SILENT_SOCKET_MS = 90_000;
/** Wait for the continuous and the front future quotes this long. */
const FUTURE_TIMEOUT_MS = 10_000;

const REPO = join(__dirname, '..', '..');

export interface FuturesArgs {
    roots: string[];
    once: boolean;
    watchMs: number;
    refreshMs: number;
    help: boolean;
}

/** "90s", "1m", "2h" or plain seconds -> ms; throws on anything else. */
export function parseDuration(text: string): number {
    const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text.trim());
    if (!m) throw new Error(`not a duration: ${text} (use 30s, 1m, 5m)`);
    const n = Number(m[1]);
    const unit = m[2] ?? 's';
    const ms = unit === 'ms' ? n : unit === 's' ? n * 1000 : unit === 'm' ? n * 60_000 : n * 3_600_000;
    if (!(ms >= 1000)) throw new Error(`duration too short: ${text}`);
    return ms;
}

export function parseArgs(argv: readonly string[]): FuturesArgs {
    const out: FuturesArgs = { roots: [], once: false, watchMs: DEFAULT_WATCH_MS, refreshMs: DEFAULT_REFRESH_MS, help: false };
    let micros = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--once') out.once = true;
        else if (a === '--micros') micros = true;
        else if (a === '--help' || a === '-h') out.help = true;
        else if (a === '--watch' || a === '--refresh') {
            const value = argv[++i];
            if (value == null) throw new Error(`${a} needs a duration (30s, 1m, 5m)`);
            if (a === '--watch') out.watchMs = parseDuration(value);
            else out.refreshMs = parseDuration(value);
        } else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
        else {
            for (const word of a.split(',')) {
                const root = word.trim().toUpperCase().replace(/^\//, '').replace(/1!$/, '');
                if (!root) continue;
                if (!TV_ROOTS[root]) throw new Error(`unknown futures root ${word} (known: ${Object.keys(TV_ROOTS).join(', ')})`);
                if (out.roots.indexOf(root) < 0) out.roots.push(root);
            }
        }
    }
    if (!out.roots.length) out.roots = DEFAULT_ROOTS.slice();
    if (micros) MICRO_ROOTS.forEach((r) => { if (out.roots.indexOf(r) < 0) out.roots.push(r); });
    return out;
}

const HELP = `bun run tv:futures [ROOT ...] [--micros] [--once] [--watch 1m] [--refresh 5m]
  ROOT       ES NQ YM RTY (default) MES MNQ MYM M2K; /ES and ES1! work too
  --micros   add MES MNQ MYM M2K
  --once     one pass, then exit (default: keep running and rewrite the files every --watch)
  --watch    how often the files are rewritten from the live values (default 1m)
  --refresh  how often the greeks and the option list are fetched again (default 5m)
Files: api/futures/<ROOT>.json (+ dist/api/futures/ when dist/api exists). Open /ES in the app with the CACHE provider.`;

const clock = (d: Date = new Date()) => d.toTimeString().slice(0, 8);

/** One futures root inside the shared websocket: its own quote sessions and everything it knows. */
class RootFeed {
    readonly continuous: string;
    readonly prefix: string;
    /** the first quote session: the futures and the first QUOTE_SESSION_LIMIT options */
    qs = randomId('qs_');
    /** every quote session of this root (the first is `qs`) and how many options each holds (allocateSessions) */
    sessions: { qs: string; count: number }[] = [];
    /** the session each watched option symbol was added to */
    readonly sessionOf = new Map<string, string>();
    front: string | null = null;
    /** the front future added to the current quote session (null after a reconnect: add it again) */
    subscribedFront: string | null = null;
    families: Family[] = [];
    wanted: WantedOption[] = [];
    /** `wanted` by full symbol */
    wantedBy = new Map<string, WantedOption>();
    /** the options still to add to the websocket, in subscriptionOrder (the background subscription takes from the front) */
    queue: string[] = [];
    /** the forward the window and the subscription order are centered on */
    center: number | null = null;
    /** the expirations (YYYY-MM-DD) the page shows: subscribed first (focus) */
    selected = new Set<string>();
    readonly values = new Map<string, QuoteValues>();
    readonly completed = new Set<string>();
    readonly failed = new Set<string>();
    greeks = new Map<string, ScanRow>();
    /** when the greeks were fetched last (0 = never) */
    greeksAt = 0;
    /** the last file's rows (open interest, today's volume and last), read once at the first preview (null: not read yet) */
    fileRows: Map<string, FileRow> | null = null;
    /** the scanner snapshot is in (bid, ask, greeks of the whole window): a snapshot can be served before the subscription */
    previewReady = false;
    /** the whole window is subscribed: the file may be written */
    ready = false;
    /** last spot written (the parity forward), the center of the next window */
    lastSpot: number | null = null;
    /** a value arrived since the file was last written (writeOnlyOnChange) */
    dirtySinceWrite = true;

    constructor(readonly root: string) {
        this.continuous = TV_ROOTS[root].continuous;
        this.prefix = this.continuous.slice(0, this.continuous.indexOf(':'));
    }
}

/** One option of a live delta: [name, bid, ask, last, volume, openInterest, oiDate] (oiDate: the day of the OI value). */
export type LiveValueRow = [string, number | null, number | null, number | null, number | null, number | null, string | null];
/** One option's TradingView greeks: [name, iv, delta, gamma, theta, vega, rho]. */
export type LiveGreekRow = [string, number | null, number | null, number | null, number | null, number | null, number | null];

/** What the watcher is doing, for the proxy's live mode (scripts/tv/live.ts) and the app's source label. */
export type WatcherState = 'starting' | 'live' | 'reconnecting' | 'no-session' | 'expired' | 'rate-limited' | 'error';

export interface WatcherStatus {
    state: WatcherState;
    /** one line for people, never a secret */
    message: string;
    /** rate-limited: when requests start again (epoch ms) */
    until: number | null;
    /** when this state began (epoch ms) */
    since: number;
    /** starting / reconnecting: which root is being read, e.g. "ES 1/4" (the app shows it in the label) */
    progress?: string;
    /**
     * per root: options on the websocket (tick by tick) and options in the window, e.g. {"ES":[3200,5560]}; the rest come
     * from the scanner snapshot (the app shows it in the label tooltip)
     */
    subscribed?: Record<string, [number, number]>;
}

/**
 * Hooks of the proxy's live mode (scripts/tv/live.ts); the CLI (`bun run tv:futures`) uses none. All optional.
 * - onStatus: every change of the state
 * - onValues: symbols of `root` whose values changed (websocket message or a new scanner read; called often, cheap)
 * - onWindow: a new snapshot of `root` is ready (scanner snapshot, window moved, reconnect)
 * - writeOnlyOnChange: skip the file write of a root when nothing changed since the last one
 * - log: where the lines go (default console.log with the time)
 */
export interface WatcherHooks {
    onStatus?: (status: WatcherStatus) => void;
    onValues?: (root: string, symbols: readonly string[]) => void;
    onWindow?: (root: string) => void;
    /** the scanner greeks of `root` were read again */
    onGreeks?: (root: string) => void;
    writeOnlyOnChange?: boolean;
    log?: (line: string) => void;
}

/** Where the watcher writes and how fast it subscribes (tests: a temp folder and a fast pace). */
export interface WatcherOptions {
    /** the files api/futures/<ROOT>.json (default FUTURES_DIR); the fast start reads the last ones from here too */
    dir?: string;
    /** the copy for the dev server (default dist/api/futures when dist/api exists; null: none) */
    distDir?: string | null;
    batchPauseMs?: number;
    batchTimeoutMs?: number;
}

export class FuturesWatcher {
    private readonly feeds: RootFeed[];
    private readonly byQs = new Map<string, RootFeed>();
    private sock: TvSocket | null = null;
    private session: TvSession | null = null;
    private token: string | null = null;
    private tokenExpiresAt = 0;
    /** when the next token renewal is due (renewDueAt) */
    private renewAt = 0;
    private pausedUntil = 0;
    /** 429 / 403 answers in a row (rateLimitPauseMs) */
    private rateLimitHits = 0;
    private statusNow: WatcherStatus = { state: 'starting', message: 'starting', until: null, since: Date.now() };
    private reconnectDelay = RECONNECT_MIN_MS;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private tickTimer: ReturnType<typeof setInterval> | null = null;
    private lastRefresh = 0;
    private busy = false;
    /** connect() runs (first connection or a reconnect): the periodic refresh waits, so nothing subscribes twice */
    private connecting = false;
    /** the socket a background subscription (drain) runs on: the periodic refresh only re-reads the scanner meanwhile */
    private drainOf: TvSocket | null = null;
    /** the background subscription of the last connect (runOnce waits for it) */
    private draining: Promise<void> = Promise.resolve();
    /** roots the pages opened, the most recent first (subscribed first) */
    private focusOrder: string[] = [];
    private stopping = false;
    private waiters: (() => void)[] = [];

    constructor(private readonly args: FuturesArgs, private readonly hooks: WatcherHooks = {}, private readonly opts: WatcherOptions = {}) {
        this.feeds = args.roots.map((r) => new RootFeed(r));
    }

    get status(): WatcherStatus {
        return this.statusNow;
    }

    private setStatus(state: WatcherState, message: string, until: number | null = null, progress?: string, subscribed?: Record<string, [number, number]>): void {
        const s = this.statusNow;
        if (s.state === state && s.message === message && s.until === until && s.progress === progress && JSON.stringify(s.subscribed) === JSON.stringify(subscribed)) return;
        this.statusNow = { state, message, until, since: s.state === state ? s.since : Date.now(), ...(progress ? { progress } : {}), ...(subscribed ? { subscribed } : {}) };
        this.hooks.onStatus?.(this.statusNow);
    }

    /** Per root with a window: [options on the websocket, options in the window]. */
    subscribedCounts(): Record<string, [number, number]> {
        const out: Record<string, [number, number]> = {};
        for (const f of this.feeds) if (f.wanted.length) out[f.root] = [Math.min(f.sessionOf.size, f.wanted.length), f.wanted.length];
        return out;
    }

    /** "streaming ES NQ (websocket 4,150 of 11,800 options, the rest from the scanner)" */
    private liveMessage(): string {
        const counts = Object.values(this.subscribedCounts());
        const on = counts.reduce((a, c) => a + c[0], 0);
        const all = counts.reduce((a, c) => a + c[1], 0);
        const roots = this.readyRoots().join(' ');
        return on < all ? `streaming ${roots} (websocket ${on.toLocaleString('en-US')} of ${all.toLocaleString('en-US')} options, the rest from the scanner)` : `streaming ${roots}`;
    }

    /**
     * The status after a batch of the subscription: live with the counts once a root has data. Rate limited, expired, no
     * session and error stay as they are (their message tells the user what to do).
     */
    private reportProgress(): void {
        const s = this.statusNow.state;
        if (this.paused() || (s !== 'live' && s !== 'starting' && s !== 'reconnecting')) return;
        if (s === 'live' || this.readyRoots().length) this.setStatus('live', this.liveMessage(), null, undefined, this.subscribedCounts());
    }

    /**
     * A page opened `root` (and shows the expirations `exps`, YYYY-MM-DD): it is read and subscribed before the other roots,
     * its shown expirations before the rest. The subscription that runs picks it up at its next batch.
     */
    focus(root: string, exps?: readonly string[]): void {
        const feed = this.feeds.find((f) => f.root === root);
        if (!feed) return;
        this.focusOrder = [root].concat(this.focusOrder.filter((r) => r !== root));
        if (exps) feed.selected = new Set(exps);
        if (feed.queue.length) this.orderQueue(feed, feed.queue);
    }

    /** Put `symbols` of `feed` into its queue in subscriptionOrder. */
    private orderQueue(feed: RootFeed, symbols: readonly string[]): void {
        const ws = symbols.map((s) => feed.wantedBy.get(s)).filter((w): w is WantedOption => w != null);
        feed.queue = subscriptionOrder(ws, feed.center, feed.selected).map((w) => w.symbol);
    }

    /** The first feed in root order (focus first) that `pred` accepts. */
    private pick(pred: (f: RootFeed) => boolean): RootFeed | null {
        for (const r of rootOrder(this.feeds.map((f) => f.root), this.focusOrder)) {
            const f = this.feeds.find((x) => x.root === r);
            if (f && pred(f)) return f;
        }
        return null;
    }

    private merged(feed: RootFeed, sym: string, name: string) {
        return mergeOption(feed.values.get(sym), feed.greeks.get(name), feed.fileRows?.get(name), feed.completed.has(sym), true);
    }

    /**
     * The live values of some option symbols of `root` as compact rows [name, bid, ask, last, volume, openInterest, oiDate]
     * (the delta of the live mode; null = not known): the websocket's once an option streams, before that the scanner's
     * bid and ask with the last file's open interest (mergeOption). Symbols outside the window (the futures) are skipped.
     */
    valueRows(root: string, symbols: Iterable<string>): LiveValueRow[] {
        const feed = this.feeds.find((f) => f.root === root);
        if (!feed) return [];
        const out: LiveValueRow[] = [];
        for (const sym of Array.from(symbols)) {
            if (!feed.wantedBy.has(sym) || feed.failed.has(sym)) continue;
            const name = sym.slice(sym.indexOf(':') + 1);
            if (!feed.values.has(sym) && !feed.greeks.has(name)) continue;
            const m = this.merged(feed, sym, name);
            out.push([name, m.bid, m.ask, m.last, m.volume, m.openInterest, m.openInterest != null ? m.oiDate : null]);
        }
        return out;
    }

    /** TradingView's greeks of every watched option of `root` as rows [name, iv, delta, gamma, theta, vega, rho]. */
    greekRows(root: string): LiveGreekRow[] {
        const feed = this.feeds.find((f) => f.root === root);
        if (!feed) return [];
        const out: LiveGreekRow[] = [];
        feed.greeks.forEach((g, name) => out.push([name, g.iv, g.delta, g.gamma, g.theta, g.vega, g.rho]));
        return out;
    }

    /** The roots with a snapshot (the scanner snapshot is in, or the whole window is subscribed). */
    readyRoots(): string[] {
        return this.feeds.filter((f) => f.ready || f.previewReady).map((f) => f.root);
    }

    private payloadOf(feed: RootFeed, now: Date) {
        return buildPayload({
            root: feed.root, wanted: feed.wanted, values: feed.values, failed: feed.failed, completed: feed.completed, greeks: feed.greeks,
            scanQuotes: true, fileRows: feed.fileRows ?? undefined,
            futures: feed.front ? futuresPrice(feed.values.get(feed.front) ?? {}) : null, now,
        });
    }

    /**
     * The current chain of `root` in the fetcher's schema (the same object the file holds), null before the scanner
     * snapshot (or, without one, before the first subscription is done). Built from the in-memory values, no request.
     */
    snapshot(root: string, now: Date = new Date()): Payload | null {
        const feed = this.feeds.find((f) => f.root === root);
        if (!feed || !(feed.ready || feed.previewReady)) return null;
        return this.payloadOf(feed, now).payload;
    }

    /** --once: connect, subscribe every root, write the files, close. Returns the number of roots written. */
    async runOnce(): Promise<number> {
        await this.authenticate(true);
        try {
            await this.connect();
            await this.draining;
            return this.writeAll();
        } finally {
            this.stop();
        }
    }

    /** Keep running until stop(): the files are rewritten every --watch. */
    async runWatch(): Promise<void> {
        await this.authenticate(true);
        try {
            await this.connect();
        } catch (err) {
            this.log(`connect failed: ${this.redact(err)}`);
            this.scheduleReconnect();
        }
        this.writeAll();
        this.lastRefresh = Date.now();
        this.tickTimer = setInterval(() => { void this.tick(); }, this.args.watchMs);
    }

    stop(): void {
        this.stopping = true;
        if (this.tickTimer) clearInterval(this.tickTimer);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.tickTimer = null;
        this.reconnectTimer = null;
        this.sock?.close();
        this.sock = null;
        this.wake();
    }

    /**
     * Debug hook (SIGUSR2 in watch mode): drop the websocket as if the network did, to check the reconnect and the
     * resubscription of every quote session. Local only, sends nothing to TradingView.
     */
    debugDrop(): void {
        if (!this.sock || this.sock.closed) {
            this.log('debug: no open websocket to drop');
            return;
        }
        this.log('debug: SIGUSR2, dropping the websocket');
        this.sock.drop();
    }

    private log(line: string): void {
        const text = this.redact(line);
        if (this.hooks.log) this.hooks.log(text);
        else console.log(`[${clock()}] ${text}`);
    }

    private redact(x: unknown): string {
        const text = x instanceof Error ? x.message : String(x);
        return redact(text, this.session);
    }

    private paused(): boolean {
        return Date.now() < this.pausedUntil;
    }

    private pause(reason: string): void {
        this.rateLimitHits++;
        this.pausedUntil = Date.now() + rateLimitPauseMs(this.rateLimitHits);
        const line = `${reason}: rate limited, no requests to TradingView until ${clock(new Date(this.pausedUntil))} (the files keep the last values)`;
        this.log(line);
        this.setStatus('rate-limited', line, this.pausedUntil);
    }

    /** A request went through: the next 429 starts the backoff at 15 minutes again. */
    private requestOk(): void {
        this.rateLimitHits = 0;
        if (this.statusNow.state === 'rate-limited' && !this.paused()) this.setStatus(this.sock && !this.sock.closed ? 'live' : 'reconnecting', 'requests allowed again');
    }

    /** Read the env file (so tv:session needs no restart) and get a fresh token. `fatal`: throw instead of logging. */
    private async authenticate(fatal: boolean): Promise<void> {
        const fail = (msg: string, state: WatcherState) => {
            if (state !== 'rate-limited') this.setStatus(state, msg);
            if (fatal) throw new Error(msg);
            // a failed renewal is tried again in AUTH_RETRY_MS, not at every tick
            this.renewAt = Date.now() + AUTH_RETRY_MS;
            this.log(msg);
        };
        if (this.paused()) return;
        const session = loadTvSession();
        if (!session) return fail('no session -> run bun run tv:session', 'no-session');
        this.session = session;
        const auth = await fetchAuthToken(session);
        if (auth.status === 429 || auth.status === 403) {
            this.rateLimitHits++;
            const wait = rateLimitPauseMs(this.rateLimitHits);
            this.pausedUntil = Date.now() + wait;
            this.setStatus('rate-limited', `tradingview.com answered ${auth.status}: rate limited`, this.pausedUntil);
            return fail(`tradingview.com answered ${auth.status}: rate limited, wait ${wait / 60_000} minutes`, 'rate-limited');
        }
        if (!auth.token || !auth.loggedIn) return fail('session expired -> run bun run tv:session', 'expired');
        this.requestOk();
        const changed = auth.token !== this.token;
        this.token = auth.token;
        this.tokenExpiresAt = jwtExpiresAt(auth.token) ?? Date.now() + AUTH_FALLBACK_LIFETIME_MS;
        this.renewAt = renewDueAt(this.tokenExpiresAt, Date.now());
        const sent = changed && this.sock != null && !this.sock.closed;
        if (sent) this.sock?.send('set_auth_token', [auth.token]);
        const line = `auth token ${fatal ? 'received' : 'refreshed'} (${changed ? 'new token' : 'same token'}${sent ? ', sent on the open websocket' : ''}), valid until ${clock(new Date(this.tokenExpiresAt))}, next renewal ${clock(new Date(this.renewAt))}`;
        this.log(line);
    }

    private onMessage(msg: TvMessage): void {
        if (msg.m === 'qsd') {
            const feed = this.byQs.get(String(msg.p[0]));
            const p = msg.p[1] as { n?: string; s?: string; v?: QuoteValues } | undefined;
            if (!feed || !p?.n) return;
            if (p.s === 'error') {
                feed.failed.add(p.n);
                feed.completed.add(p.n);
                this.wake();
                return;
            }
            if (p.v) {
                const prev = feed.values.get(p.n);
                feed.values.set(p.n, prev ? Object.assign(prev, p.v) : Object.assign({}, p.v));
                feed.dirtySinceWrite = true;
                this.hooks.onValues?.(feed.root, [p.n]);
            }
        } else if (msg.m === 'quote_completed') {
            const feed = this.byQs.get(String(msg.p[0]));
            if (!feed) return;
            const sym = String(msg.p[1]);
            feed.completed.add(sym);
            // from now on the option's values are the websocket's (mergeOption): the page gets them even when the first
            // qsd came before the completion
            if (feed.wantedBy.has(sym)) this.hooks.onValues?.(feed.root, [sym]);
            this.wake();
        } else if (msg.m === 'critical_error' || msg.m === 'protocol_error') {
            this.log(`websocket ${msg.m}: ${JSON.stringify(msg.p).slice(0, 200)}; reconnecting`);
            this.sock?.close();
            this.sock = null;
            this.wake();
            this.scheduleReconnect();
        }
    }

    private wake(): void {
        const w = this.waiters;
        this.waiters = [];
        w.forEach((f) => f());
    }

    /** Resolve when every symbol completed (or failed), `sock` dropped or was replaced, or the timeout passed. */
    private async waitFor(feed: RootFeed, symbols: readonly string[], timeoutMs: number, sock: TvSocket | null = this.sock): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (!symbols.every((s) => feed.completed.has(s)) && Date.now() < deadline && sock && this.sock === sock && !sock.closed && !this.stopping) {
            await new Promise<void>((resolve) => {
                this.waiters.push(resolve);
                setTimeout(resolve, 250);
            });
        }
    }

    /**
     * Open the socket, authenticate it and read every root (front contract, window, scanner snapshot): a few seconds. The
     * options then join the websocket in the background (drain), by importance; runOnce waits for that through `draining`.
     */
    private async connect(): Promise<void> {
        if (!this.token) throw new Error('no auth token');
        this.connecting = true;
        let sock: TvSocket | null = null;
        try {
            sock = this.newSocket();
            await this.subscribeAll(sock);
        } catch (err) {
            // close only the socket this call opened (a later reconnect may already own this.sock)
            if (sock && this.sock === sock) {
                sock.close();
                this.sock = null;
            }
            throw err;
        } finally {
            this.connecting = false;
        }
        const s = sock;
        this.draining = this.drain(s).then(() => {
            const st = this.statusNow.state;
            if (this.sock === s && !s.closed && !this.paused() && (st === 'live' || st === 'starting' || st === 'reconnecting')) this.setStatus('live', this.liveMessage(), null, undefined, this.subscribedCounts());
        }).catch((err: unknown) => this.log(`subscription: ${this.redact(err)}`));
    }

    private newSocket(): TvSocket {
        const sock = new TvSocket({
            session: this.session,
            onMessage: (m) => this.onMessage(m),
            onClose: (reason) => {
                if (this.sock !== sock || this.stopping) return;
                this.log(`websocket ${reason}`);
                this.sock = null;
                this.wake();
                this.scheduleReconnect();
            },
        });
        this.sock = sock;
        return sock;
    }

    /**
     * Authenticate a new socket and read every root on it (fresh quote sessions, the focused root first): the futures,
     * the window and the scanner snapshot. Each root's snapshot goes to the pages as soon as it is in (onWindow).
     */
    private async subscribeAll(sock: TvSocket): Promise<void> {
        await sock.opened;
        sock.send('set_auth_token', [this.token]);
        this.byQs.clear();
        this.feeds.forEach((feed) => {
            feed.sessions = [];
            feed.sessionOf.clear();
            feed.subscribedFront = null;
            feed.completed.clear();
            feed.failed.clear();
            feed.queue = [];
        });
        const pending = new Set(this.feeds);
        for (let k = 1; pending.size; k++) {
            if (this.sock !== sock || sock.closed) throw new Error('websocket dropped while subscribing');
            const feed = this.pick((f) => pending.has(f))!;
            pending.delete(feed);
            // the app shows the progress while it waits (TV starting… ES 1/4); a reconnect keeps its own state
            const progress = `${feed.root} ${k}/${this.feeds.length}`;
            if (this.statusNow.state === 'starting' || this.statusNow.state === 'reconnecting') {
                this.setStatus(this.statusNow.state, `reading ${progress} (front contract, option list, scanner snapshot)`, null, progress);
            }
            feed.qs = this.openSession(feed, sock);
            try {
                await this.prepare(feed, true);
                if (feed.previewReady || feed.ready) this.hooks.onWindow?.(feed.root);
                this.log(`${feed.root}: ${feed.wanted.length} options, scanner snapshot ${feed.previewReady ? `of ${feed.greeks.size} rows` : 'missing (the page waits for the subscription)'}; subscribing them in the background`);
            } catch (err) {
                this.log(`${feed.root}: ${this.redact(err)}`);
            }
        }
        if (this.sock !== sock || sock.closed) throw new Error('websocket dropped while subscribing');
        this.reconnectDelay = RECONNECT_MIN_MS;
        this.reportProgress();
    }

    /**
     * Add the queued options of every root to the websocket, WS_BATCH at a time, WS_BATCH_PAUSE_MS apart, always from the
     * root that matters most right now (rootOrder: the page's root first, re-picked before every batch). Each option
     * streams as soon as its batch is in (the page gets it with the next delta). Stops when `sock` drops or is replaced.
     */
    private async drain(sock: TvSocket): Promise<void> {
        this.drainOf = sock;
        try {
            let first = true;
            for (;;) {
                if (!first) await sleep(this.opts.batchPauseMs ?? WS_BATCH_PAUSE_MS);
                first = false;
                if (this.sock !== sock || sock.closed || this.stopping) return;
                const feed = this.pick((f) => f.queue.length > 0);
                if (!feed) return;
                const batch = feed.queue.splice(0, WS_BATCH);
                this.addOptions(feed, sock, batch);
                await this.waitFor(feed, batch, this.opts.batchTimeoutMs ?? WS_BATCH_TIMEOUT_MS, sock);
                if (!feed.queue.length && this.sock === sock) {
                    feed.ready = true;
                    this.log(`${feed.root}: subscribed ${feed.sessionOf.size} options in ${feed.sessions.length} quote session(s) [${feed.sessions.map((x) => x.count).join(', ')}]`);
                }
                if (this.sock === sock) this.reportProgress();
            }
        } finally {
            if (this.drainOf === sock) this.drainOf = null;
        }
    }

    /** A new quote session of `feed` on `sock`, with the quote fields; returns its id. */
    private openSession(feed: RootFeed, sock: TvSocket): string {
        const qs = randomId('qs_');
        this.byQs.set(qs, feed);
        sock.send('quote_create_session', [qs]);
        sock.send('quote_set_fields', [qs, ...QUOTE_FIELDS]);
        feed.sessions.push({ qs, count: 0 });
        return qs;
    }

    /** Add option symbols, spread over the root's quote sessions (QUOTE_SESSION_LIMIT each, new ones as needed). */
    private addOptions(feed: RootFeed, sock: TvSocket, symbols: readonly string[]): void {
        const slots = allocateSessions(feed.sessions.map((x) => x.count), symbols.length);
        const groups = new Map<string, string[]>();
        symbols.forEach((sym, k) => {
            while (slots[k] >= feed.sessions.length) this.openSession(feed, sock);
            const target = feed.sessions[slots[k]];
            target.count++;
            feed.sessionOf.set(sym, target.qs);
            const list = groups.get(target.qs);
            if (list) list.push(sym); else groups.set(target.qs, [sym]);
        });
        groups.forEach((list, qs) => sock.send('quote_add_symbols', [qs, ...list]));
    }

    /** Remove option symbols from the sessions that hold them. */
    private removeOptions(feed: RootFeed, sock: TvSocket, symbols: readonly string[]): void {
        const groups = new Map<string, string[]>();
        for (const sym of symbols) {
            const qs = feed.sessionOf.get(sym) ?? feed.qs;
            feed.sessionOf.delete(sym);
            const target = feed.sessions.find((x) => x.qs === qs);
            if (target) target.count = Math.max(0, target.count - 1);
            const list = groups.get(qs);
            if (list) list.push(sym); else groups.set(qs, [sym]);
        }
        groups.forEach((list, qs) => {
            for (let i = 0; i < list.length; i += WS_BATCH) sock.send('quote_remove_symbols', [qs, ...list.slice(i, i + WS_BATCH)]);
        });
    }

    private scheduleReconnect(): void {
        if (this.stopping || this.reconnectTimer || this.args.once) return;
        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
        this.log(`reconnecting in ${Math.round(delay / 1000)} s`);
        if (this.statusNow.state === 'live' || this.statusNow.state === 'starting') this.setStatus('reconnecting', `websocket dropped, reconnecting in ${Math.round(delay / 1000)} s`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void (async () => {
                if (this.stopping) return;
                if (this.connecting) {
                    this.scheduleReconnect();
                    return;
                }
                try {
                    if (Date.now() >= this.renewAt) await this.authenticate(false);
                    await this.connect();
                    this.log('reconnected');
                } catch (err) {
                    this.log(`reconnect failed: ${this.redact(err)}`);
                    this.scheduleReconnect();
                }
            })();
        }, delay);
    }

    /** The last file of `feed` (api/futures/<ROOT>.json): open interest, today's volume and last (fileRowsOf). */
    private readFileRows(feed: RootFeed): Map<string, FileRow> {
        const path = join(this.opts.dir ?? FUTURES_DIR, `${feed.root}.json`);
        try {
            return existsSync(path) ? fileRowsOf(JSON.parse(readFileSync(path, 'utf8')), marketDay(new Date())) : new Map();
        } catch (err) {
            this.log(`${feed.root}: the last file is unreadable (${this.redact(err)}), open interest comes with the subscription`);
            return new Map();
        }
    }

    /**
     * (Re)read the continuous future (front contract, options-info), work out the option window around the forward, remove
     * the dropped options, queue the new ones (subscriptionOrder) and read the scanner (bid, ask, greeks of the window:
     * the snapshot the page shows until the options stream). `fresh`: a new quote session (everything is queued again).
     * Returns whether the window changed.
     */
    private async prepare(feed: RootFeed, fresh: boolean): Promise<boolean> {
        const sock = this.sock;
        if (!sock) throw new Error('no websocket');
        if (!feed.fileRows) feed.fileRows = this.readFileRows(feed);
        // the continuous future: removed and added again so options-info and the front contract come fresh
        if (!fresh) sock.send('quote_remove_symbols', [feed.qs, feed.continuous]);
        feed.completed.delete(feed.continuous);
        feed.failed.delete(feed.continuous);
        feed.values.delete(feed.continuous);
        sock.send('quote_add_symbols', [feed.qs, feed.continuous]);
        await this.waitFor(feed, [feed.continuous], FUTURE_TIMEOUT_MS, sock);
        const cont = feed.values.get(feed.continuous);
        if (feed.failed.has(feed.continuous) || !cont?.front_contract) throw new Error(`${feed.continuous}: no quote (not found or no entitlement)`);
        const front = `${feed.prefix}:${String(cont.front_contract)}`;
        const families = familiesOf(cont);
        if (families.length) feed.families = families;
        if (front !== feed.subscribedFront) {
            if (feed.front && front !== feed.front) this.log(`${feed.root}: front contract ${feed.front} -> ${front}`);
            if (feed.subscribedFront && feed.subscribedFront !== front) sock.send('quote_remove_symbols', [feed.qs, feed.subscribedFront]);
            feed.front = front;
            feed.subscribedFront = front;
            sock.send('quote_add_symbols', [feed.qs, front]);
            await this.waitFor(feed, [front], FUTURE_TIMEOUT_MS, sock);
        }
        const fut = futuresPrice(feed.values.get(front) ?? {}) ?? futuresPrice(cont);
        const center = feed.lastSpot ?? fut?.price ?? null;
        if (center == null) throw new Error(`no price for ${front}`);
        const next = wantedOptions(feed.families, front, center, new Date());
        if (!next.length) throw new Error(`no option series on ${front} (TradingView lists none for this root)`);

        // what the quote sessions hold now (sessionOf is cleared on a new connection, and a retry of a failed or interrupted
        // subscription keeps what it already added), so a reconnect queues the whole window again
        const before = new Set(feed.sessionOf.keys());
        const nextSet = new Set(next.map((w) => w.symbol));
        const removed = Array.from(before).filter((sym) => !nextSet.has(sym));
        const added = next.filter((w) => !before.has(w.symbol)).map((w) => w.symbol);
        const changed = fresh || removed.length > 0 || next.length !== feed.wanted.length || next.some((w) => !feed.wantedBy.has(w.symbol));
        feed.wanted = next;
        feed.wantedBy = new Map(next.map((w) => [w.symbol, w]));
        feed.center = center;
        if (removed.length) {
            this.removeOptions(feed, sock, removed);
            removed.forEach((s) => {
                feed.values.delete(s);
                feed.completed.delete(s);
                feed.failed.delete(s);
            });
        }
        this.orderQueue(feed, added);
        await this.refreshGreeks(feed);
        if (!feed.queue.length) feed.ready = true;
        if (!fresh && (added.length || removed.length)) this.log(`${feed.root}: window moved, +${added.length} -${removed.length} options`);
        return changed;
    }

    /**
     * Read the scanner for the window of `feed`: TradingView's greeks, and bid and ask of the options not on the websocket
     * yet (their next delta carries them: onValues). The first good read makes the scanner snapshot (previewReady).
     */
    private async refreshGreeks(feed: RootFeed): Promise<void> {
        if (!feed.front || !feed.wanted.length) return;
        if (this.paused()) return;
        try {
            const greeks = await scanGreeks(feed.front, feed.wanted, this.session);
            this.requestOk();
            if (greeks.size) {
                feed.greeks = greeks;
                feed.greeksAt = Date.now();
                feed.previewReady = true;
                feed.dirtySinceWrite = true;
                this.hooks.onGreeks?.(feed.root);
                const waiting = feed.wanted.map((w) => w.symbol).filter((s) => !feed.completed.has(s));
                if (waiting.length) this.hooks.onValues?.(feed.root, waiting);
            }
        } catch (err) {
            if (err instanceof TvRateLimitError) this.pause(`${feed.root} greeks`);
            else this.log(`${feed.root} greeks: ${this.redact(err)} (keeping the previous ones)`);
        }
    }

    /**
     * Every --watch: write the files; renew the token when due; every --refresh re-read the window and the greeks (while
     * the background subscription runs: the scanner only, so the options not streaming yet stay fresh).
     */
    private async tick(): Promise<void> {
        try {
            this.writeAll();
        } catch (err) {
            this.log(`writing the files failed: ${this.redact(err)}`);
        }
        if (this.busy || this.stopping) return;
        const sock = this.sock;
        if (sock && !sock.closed && !this.connecting && Date.now() - sock.lastFrameAt > SILENT_SOCKET_MS) {
            this.log(`websocket silent for ${Math.round((Date.now() - sock.lastFrameAt) / 1000)} s, dropping it`);
            sock.drop();
            return;
        }
        this.busy = true;
        try {
            // like the refresh below: the timer may fire a few ms before a renewal that is due now
            if (Date.now() >= this.renewAt - 1000) {
                try {
                    await this.authenticate(false);
                } catch (err) {
                    this.log(`auth refresh failed: ${this.redact(err)}`);
                }
            }
            // the timer may fire a few ms early: a refresh due within the next second counts as due
            if (Date.now() - this.lastRefresh >= this.args.refreshMs - 1000 && this.sock && !this.sock.closed && !this.connecting && !this.paused()) {
                this.lastRefresh = Date.now();
                const s = this.sock;
                if (this.drainOf === s) {
                    for (const feed of this.feeds) if (feed.wanted.length && this.sock === s) await this.refreshGreeks(feed);
                    return;
                }
                for (const feed of this.feeds) {
                    if (!this.sock || this.sock.closed) break;
                    try {
                        if (await this.prepare(feed, !feed.ready && !feed.previewReady)) this.hooks.onWindow?.(feed.root);
                    } catch (err) {
                        this.log(`${feed.root} refresh: ${this.redact(err)}`);
                    }
                }
                if (this.sock === s && !s.closed) await this.drain(s);
            }
        } finally {
            this.busy = false;
        }
    }

    /** Write the file of every ready root; returns how many were written. */
    writeAll(): number {
        let written = 0;
        const dir = this.opts.dir ?? FUTURES_DIR;
        const distDir = this.opts.distDir !== undefined ? this.opts.distDir : existsSync(join(REPO, 'dist', 'api')) ? DIST_FUTURES_DIR : null;
        for (const feed of this.feeds) {
            if (!feed.ready) continue;
            if (this.hooks.writeOnlyOnChange && !feed.dirtySinceWrite) continue;
            feed.dirtySinceWrite = false;
            const { payload, stats } = this.payloadOf(feed, new Date());
            if (!stats.quotes) {
                this.log(`${feed.root}: no quotes yet, file not written`);
                continue;
            }
            const text = payloadText(payload);
            mkdirSync(dir, { recursive: true });
            const path = join(dir, `${feed.root}.json`);
            writeFileAtomic(path, text);
            if (distDir) {
                mkdirSync(distDir, { recursive: true });
                writeFileAtomic(join(distDir, `${feed.root}.json`), text);
            }
            if (stats.spot != null && stats.spotSource === 'parity') feed.lastSpot = stats.spot;
            const mode = String(feed.wanted.map((w) => feed.values.get(w.symbol)?.update_mode).filter(Boolean)[0] ?? '');
            const live = mode === 'streaming' ? 'realtime' : mode.startsWith('delayed') ? 'DELAYED (no realtime CME entitlement)' : mode || 'update mode unknown';
            this.log(`${feed.root.padEnd(3)} wrote ${relative(REPO, path)}${distDir ? ' + dist' : ''}: ${feed.front?.split(':')[1]} spot ${stats.spot?.toFixed(2) ?? '-'} (${stats.spotSource}), ${stats.expirations} exps, ${stats.quotes} quotes, OI ${stats.withOi}, gamma ${stats.withGamma} (greeks of ${feed.greeksAt ? clock(new Date(feed.greeksAt)) : 'never'}), ${live}`);
            written++;
        }
        return written;
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(HELP);
        return;
    }
    console.log(`tv:futures ${args.roots.join(' ')}: ${args.once ? 'one pass' : `files every ${args.watchMs / 1000} s, greeks and option list every ${args.refreshMs / 1000} s, Ctrl+C stops`}. To publish: commit api/futures and push`);
    const watcher = new FuturesWatcher(args);
    if (args.once) {
        const n = await watcher.runOnce();
        if (n < args.roots.length) process.exitCode = 1;
        return;
    }
    const stop = () => {
        watcher.stop();
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    // debug: `kill -USR2 <pid>` drops the websocket to check the reconnect (README, Local futures)
    process.on('SIGUSR2', () => watcher.debugDrop());
    await watcher.runWatch();
}

if (require.main === module) {
    main().catch((err: unknown) => {
        console.error(`tv:futures failed: ${redact(err instanceof Error ? err.message : String(err))}`);
        process.exitCode = 1;
    });
}
