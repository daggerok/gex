/// <reference types="node" />
/// <reference types="bun" />
/**
 * TradingView hybrid for US stock and index options (owner 2026-10-26, stacked on PR #202). README: "Local proxy and
 * TradingView live mode" -> "Stocks and indices (TradingView hybrid)"; protocol: workspace docs/repos/gex/architecture.md.
 *
 * When the app has a stock or index ticker open through the proxy (SPY, QQQ, NVDA, SPX...), the proxy streams its chain
 * from TradingView: bid, ask, last and volume of OPRA options (15 minutes delayed without an OPRA subscription,
 * `delayed_streaming_900`), TradingView's scanner greeks every HYBRID_SCAN_MS, open interest from Cboe (TradingView's is
 * stale per contract, chain.ts openInterestOf). Same server-sent events as the futures live mode (live.ts):
 *
 *   GET /api/tv/live?symbol=SPY   event: status | snapshot | delta | greeks (the shapes of live.ts)
 *   GET /api/tv/status            {"hybrid":true,"feeds":[{"symbol","state","options"}]}
 *
 * A feed starts when the first page subscribes and stops HYBRID_IDLE_MS after the last one left; at most
 * HYBRID_MAX_FEEDS at once. Window: expirations within HYBRID_DAYS, strikes within +/- WINDOW_PCT of the price, quote
 * sessions of QUOTE_SESSION_LIMIT added 50 symbols per message 0.5 s apart (SPX takes about a minute). OPRA data is for
 * personal use: it is never written to a file, never to api/, never committed. No session value or token is printed.
 */
import {
    allocateSessions, familiesOf, futuresPrice, occSymbol, optionSymbol, QUOTE_FIELDS, QUOTE_SESSION_LIMIT, scanGreeks,
    strikesInWindow, TvRateLimitError, openInterestOf, WINDOW_PCT, WS_BATCH, WS_BATCH_PAUSE_MS, WS_BATCH_TIMEOUT_MS, buildPayload,
    type Family, type QuoteValues, type ScanRow, type WantedOption,
} from './chain';
import { jwtExpiresAt, loadTvSession, redact, sleep, UA, type TvSession } from './env';
import { AUTH_FALLBACK_LIFETIME_MS, rateLimitPauseMs, RECONNECT_MAX_MS, RECONNECT_MIN_MS, renewDueAt, type LiveGreekRow, type LiveValueRow, type WatcherState, type WatcherStatus } from './futures';
import { snapshotEvent, sseEvent } from './live';
import { fetchAuthToken, randomId, type TvMessage, TvSocket } from './ws';
import type { Payload } from '../options-data';

/** Expirations within this many days are watched. */
export const HYBRID_DAYS = 42;
/** TradingView's scanner greeks are read this often per feed. */
export const HYBRID_SCAN_MS = 45_000;
/** Cboe open interest is read again this often (it changes once a day). */
export const HYBRID_OI_MS = 6 * 60 * 60_000;
/** The window follows the price this often. */
export const HYBRID_WINDOW_MS = 5 * 60_000;
/** A feed without pages stops after this long. */
export const HYBRID_IDLE_MS = 2 * 60_000;
/** At most this many tickers stream at once (each one its own websocket). */
export const HYBRID_MAX_FEEDS = 2;
/** Deltas go out at most this often per ticker. */
export const HYBRID_FLUSH_MS = 500;

/** Index tickers of the app -> TradingView's underlying that carries `options-info` (SP:SPX, not CBOE:SPX). */
const INDEX_UNDERLYINGS: Readonly<Record<string, string[]>> = {
    SPX: ['SP:SPX'], XSP: ['CBOE:XSP', 'SP:XSP'], NDX: ['NASDAQ:NDX'], RUT: ['TVC:RUT', 'CBOE:RUT', 'RUSSELL:RUT'], DJX: ['CBOE:DJX'], VIX: ['CBOE:VIX'],
};

/** The TradingView symbols to try for an app ticker, the first one with options wins. */
export function underlyingCandidates(ticker: string): string[] {
    const t = ticker.trim().toUpperCase().replace(/^[_^]/, '');
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(t)) return [];
    return INDEX_UNDERLYINGS[t] ?? [`NASDAQ:${t}`, `NYSE:${t}`, `AMEX:${t}`, `CBOE:${t}`, `NYSEARCA:${t}`];
}

/** Calls and puts of every series that expires within `days` (and is still open), strikes within the window. */
export function hybridWanted(families: readonly Family[], center: number, now: Date, days: number = HYBRID_DAYS, pct: number = WINDOW_PCT): WantedOption[] {
    const out: WantedOption[] = [];
    const until = now.getTime() + days * 86_400_000;
    for (const family of families) {
        for (const series of family.series) {
            const t = new Date(series.expTime).getTime();
            if (!(t > now.getTime()) || t > until) continue;
            for (const strike of strikesInWindow(series.strikes, center, pct)) {
                out.push({ symbol: optionSymbol(family.prefix, series.root, series.exp, 'call', strike), root: series.root, exp: series.exp, side: 'call', strike });
                out.push({ symbol: optionSymbol(family.prefix, series.root, series.exp, 'put', strike), root: series.root, exp: series.exp, side: 'put', strike });
            }
        }
    }
    return out.sort((a, b) => a.exp - b.exp || a.strike - b.strike || (a.side === b.side ? 0 : a.side === 'call' ? -1 : 1));
}

/** Scanner names of whole strikes come without the decimal the quote symbols carry: key them both ways. */
export function withOpraNames(rows: ReadonlyMap<string, ScanRow>): Map<string, ScanRow> {
    const out = new Map(rows);
    rows.forEach((v, k) => { if (/[CP]\d+$/.test(k)) out.set(`${k}.0`, v); });
    return out;
}

/** Cboe's delayed quotes of a ticker -> open interest by OCC symbol (indices as _SPX). Empty on any error. */
export async function fetchCboeOi(ticker: string, fetchImpl: typeof fetch = fetch): Promise<Map<string, number>> {
    const t = ticker.toUpperCase();
    const sym = INDEX_UNDERLYINGS[t] ? `_${t}` : t;
    const out = new Map<string, number>();
    try {
        const res = await fetchImpl(`https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(sym)}.json`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (!res.ok) return out;
        const j = (await res.json()) as { data?: { options?: { option?: string; open_interest?: number }[] } };
        for (const o of j.data?.options ?? []) if (o.option && typeof o.open_interest === 'number') out.set(o.option, o.open_interest);
    } catch {
        // no Cboe OI: TradingView's newest-day values only
    }
    return out;
}

interface Client {
    controller: ReadableStreamDefaultController<Uint8Array>;
}

/** One ticker streamed from TradingView. */
export class HybridFeed {
    status: WatcherStatus = { state: 'starting', message: 'starting', until: null, since: Date.now() };
    readonly clients = new Set<Client>();
    underlying: string | null = null;
    private sock: TvSocket | null = null;
    private session: TvSession | null = null;
    private token: string | null = null;
    private renewAt = 0;
    private families: Family[] = [];
    wanted: WantedOption[] = [];
    private readonly values = new Map<string, QuoteValues>();
    private readonly completed = new Set<string>();
    private readonly failed = new Set<string>();
    private sessions: { qs: string; count: number }[] = [];
    private readonly sessionOf = new Map<string, string>();
    private readonly qsSet = new Set<string>();
    private greeks = new Map<string, ScanRow>();
    private cboeOi = new Map<string, number>();
    private cboeAt = 0;
    private readonly dirty = new Set<string>();
    private readonly timers: ReturnType<typeof setInterval>[] = [];
    private reconnectDelay = RECONNECT_MIN_MS;
    private pausedUntil = 0;
    private rateHits = 0;
    private stopped = false;
    ready = false;
    idleTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly enc = new TextEncoder();

    constructor(readonly ticker: string, private readonly log: (line: string) => void) {}

    private setStatus(state: WatcherState, message: string, until: number | null = null): void {
        if (this.status.state === state && this.status.message === message) return;
        this.status = { state, message, until, since: this.status.state === state ? this.status.since : Date.now() };
        this.broadcast(sseEvent('status', this.status));
    }

    private say(line: string): void {
        this.log(`${this.ticker}: ${redact(line, this.session)}`);
    }

    async start(): Promise<void> {
        try {
            await this.authenticate();
            await this.connect();
            this.timers.push(setInterval(() => this.flush(), HYBRID_FLUSH_MS));
            this.timers.push(setInterval(() => { void this.refreshGreeks(); }, HYBRID_SCAN_MS));
            this.timers.push(setInterval(() => { void this.housekeeping(); }, 60_000));
        } catch (err) {
            this.setStatus(this.status.state === 'starting' ? 'error' : this.status.state, (err as Error).message);
            this.say(`not streaming: ${(err as Error).message}`);
        }
    }

    stop(): void {
        this.stopped = true;
        this.timers.forEach((t) => clearInterval(t));
        this.sock?.close();
        this.sock = null;
        for (const c of Array.from(this.clients)) {
            try { c.controller.close(); } catch { /* gone */ }
        }
        this.clients.clear();
    }

    private async authenticate(): Promise<void> {
        const session = loadTvSession();
        if (!session) {
            this.setStatus('no-session', 'no TradingView session: log in to tradingview.com in Chrome (the proxy imports it) or run bun run tv:session');
            throw new Error('no session');
        }
        this.session = session;
        const auth = await fetchAuthToken(session);
        if (auth.status === 429 || auth.status === 403) {
            this.rateHits++;
            this.pausedUntil = Date.now() + rateLimitPauseMs(this.rateHits);
            this.setStatus('rate-limited', `tradingview.com answered ${auth.status}`, this.pausedUntil);
            throw new Error('rate limited');
        }
        if (!auth.token || !auth.loggedIn) {
            this.setStatus('expired', 'the TradingView session expired: log in to tradingview.com in Chrome (the proxy imports it)');
            throw new Error('session expired');
        }
        const changed = auth.token !== this.token;
        this.token = auth.token;
        this.renewAt = renewDueAt(jwtExpiresAt(auth.token) ?? Date.now() + AUTH_FALLBACK_LIFETIME_MS, Date.now());
        if (changed && this.sock && !this.sock.closed) this.sock.send('set_auth_token', [auth.token]);
    }

    private onMessage(msg: TvMessage): void {
        if (msg.m === 'qsd') {
            if (!this.qsSet.has(String(msg.p[0]))) return;
            const p = msg.p[1] as { n?: string; s?: string; v?: QuoteValues } | undefined;
            if (!p?.n) return;
            if (p.s === 'error') {
                this.failed.add(p.n);
                this.completed.add(p.n);
                return;
            }
            if (p.v) {
                const prev = this.values.get(p.n);
                this.values.set(p.n, prev ? Object.assign(prev, p.v) : Object.assign({}, p.v));
                this.dirty.add(p.n);
            }
        } else if (msg.m === 'quote_completed') {
            this.completed.add(String(msg.p[1]));
        } else if (msg.m === 'critical_error' || msg.m === 'protocol_error') {
            this.say(`websocket ${msg.m}; reconnecting`);
            this.sock?.drop();
        }
    }

    private async waitFor(symbols: readonly string[], ms: number): Promise<void> {
        const until = Date.now() + ms;
        while (Date.now() < until && !symbols.every((s) => this.completed.has(s)) && this.sock && !this.sock.closed) await sleep(200);
    }

    private openSession(sock: TvSocket): void {
        const qs = randomId('qs_');
        this.qsSet.add(qs);
        sock.send('quote_create_session', [qs]);
        sock.send('quote_set_fields', [qs, ...QUOTE_FIELDS]);
        this.sessions.push({ qs, count: 0 });
    }

    /** Open the socket, find the underlying, subscribe the window (gradually), read Cboe OI and the scanner. */
    private async connect(): Promise<void> {
        const sock = new TvSocket({
            session: this.session,
            onMessage: (m) => this.onMessage(m),
            onClose: (reason) => {
                if (this.stopped || this.sock !== sock) return;
                this.sock = null;
                this.setStatus('reconnecting', `websocket ${reason}, reconnecting in ${Math.round(this.reconnectDelay / 1000)} s`);
                const delay = this.reconnectDelay;
                this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
                setTimeout(() => { if (!this.stopped) void this.connect().catch((e: unknown) => this.say(`reconnect failed: ${(e as Error).message}`)); }, delay);
            },
        });
        this.sock = sock;
        await sock.opened;
        sock.send('set_auth_token', [this.token]);
        this.sessions = [];
        this.sessionOf.clear();
        this.qsSet.clear();
        this.completed.clear();
        this.failed.clear();
        this.openSession(sock);
        const first = this.sessions[0].qs;
        const candidates = this.underlying ? [this.underlying] : underlyingCandidates(this.ticker);
        if (!candidates.length) throw new Error(`not a ticker TradingView can stream: ${this.ticker}`);
        sock.send('quote_add_symbols', [first, ...candidates]);
        await this.waitFor(candidates, 10_000);
        this.underlying = candidates.find((c) => familiesOf(this.values.get(c)).length > 0) ?? null;
        if (!this.underlying) throw new Error(`TradingView lists no options for ${this.ticker}`);
        this.families = familiesOf(this.values.get(this.underlying));
        const price = futuresPrice(this.values.get(this.underlying) ?? {})?.price;
        if (!price) throw new Error(`no price for ${this.underlying}`);
        this.wanted = hybridWanted(this.families, price, new Date());
        if (!this.wanted.length) throw new Error(`no options of ${this.ticker} within ${HYBRID_DAYS} days`);
        if (Date.now() - this.cboeAt > HYBRID_OI_MS) {
            this.cboeOi = await fetchCboeOi(this.ticker);
            this.cboeAt = Date.now();
        }
        await this.refreshGreeks();
        await this.addSymbols(sock, this.wanted.map((w) => w.symbol));
        this.reconnectDelay = RECONNECT_MIN_MS;
        this.ready = true;
        this.say(`streaming ${this.wanted.length} options of ${this.underlying} in ${this.sessions.length} quote session(s), Cboe OI for ${this.cboeOi.size}`);
        this.setStatus('live', `streaming ${this.ticker} (${this.wanted.length} options, 15 min delayed)`);
        this.sendSnapshot();
    }

    private async addSymbols(sock: TvSocket, symbols: readonly string[]): Promise<void> {
        for (let i = 0; i < symbols.length; i += WS_BATCH) {
            if (i > 0) await sleep(WS_BATCH_PAUSE_MS);
            if (this.sock !== sock || sock.closed || this.stopped) throw new Error('websocket dropped while subscribing');
            const batch = symbols.slice(i, i + WS_BATCH);
            const slots = allocateSessions(this.sessions.map((s) => s.count), batch.length, QUOTE_SESSION_LIMIT);
            const groups = new Map<string, string[]>();
            batch.forEach((sym, k) => {
                while (slots[k] >= this.sessions.length) this.openSession(sock);
                const target = this.sessions[slots[k]];
                target.count++;
                this.sessionOf.set(sym, target.qs);
                const list = groups.get(target.qs);
                if (list) list.push(sym); else groups.set(target.qs, [sym]);
            });
            groups.forEach((list, qs) => sock.send('quote_add_symbols', [qs, ...list]));
            await this.waitFor(batch, WS_BATCH_TIMEOUT_MS);
        }
    }

    private async refreshGreeks(): Promise<void> {
        if (!this.underlying || !this.wanted.length || Date.now() < this.pausedUntil) return;
        try {
            this.greeks = withOpraNames(await scanGreeks(this.underlying, this.wanted, this.session));
            this.rateHits = 0;
            if (this.ready) this.broadcast(sseEvent('greeks', { root: this.ticker, at: new Date().toISOString(), rows: this.greekRows() }));
        } catch (err) {
            if (err instanceof TvRateLimitError) {
                this.rateHits++;
                this.pausedUntil = Date.now() + rateLimitPauseMs(this.rateHits);
                this.say(`scanner rate limited, no scanner requests until ${new Date(this.pausedUntil).toTimeString().slice(0, 8)}`);
            } else this.say(`scanner: ${(err as Error).message} (keeping the previous greeks)`);
        }
    }

    /** Every minute: renew the token when due, Cboe OI every few hours, the window every few minutes. */
    private lastWindow = Date.now();
    private async housekeeping(): Promise<void> {
        if (this.stopped || !this.sock || this.sock.closed) return;
        if (Date.now() >= this.renewAt - 1000) {
            try { await this.authenticate(); } catch { /* status says why, the socket keeps running */ }
        }
        if (Date.now() - this.cboeAt > HYBRID_OI_MS) {
            this.cboeOi = await fetchCboeOi(this.ticker);
            this.cboeAt = Date.now();
        }
        if (Date.now() - this.lastWindow >= HYBRID_WINDOW_MS && this.underlying) {
            this.lastWindow = Date.now();
            const price = futuresPrice(this.values.get(this.underlying) ?? {})?.price;
            if (!price) return;
            const next = hybridWanted(this.families, price, new Date());
            const have = new Set(this.wanted.map((w) => w.symbol));
            const added = next.filter((w) => !have.has(w.symbol)).map((w) => w.symbol);
            if (!added.length) return;
            this.wanted = next;
            try {
                await this.addSymbols(this.sock, added);
                this.say(`window moved, +${added.length} options`);
                this.sendSnapshot();
            } catch (err) {
                this.say(`window: ${(err as Error).message}`);
            }
        }
    }

    /** Cboe's OI, else TradingView's with its day (chain.ts openInterestOf; the app marks an old day pale). */
    private oiOf(w: WantedOption): { value: number; day: string | null } | null {
        const tv = this.values.get(w.symbol)?.oi as { time?: unknown; value?: unknown } | undefined;
        return openInterestOf(tv, this.cboeOi.get(occSymbol(w.root, w.exp, w.side, w.strike)));
    }

    /** The chain in the file schema (never written to a file: OPRA data stays in memory). */
    snapshot(): Payload | null {
        if (!this.ready || !this.underlying) return null;
        const values = new Map<string, QuoteValues>();
        for (const w of this.wanted) {
            const v = this.values.get(w.symbol);
            if (!v) continue;
            const oi = this.oiOf(w);
            // a Cboe value has no TradingView day (current); a TradingView one keeps its own day (buildPayload -> oiDate)
            values.set(w.symbol, { ...v, oi: oi == null ? undefined : oi.day == null ? { value: oi.value } : v.oi });
        }
        return buildPayload({
            root: this.ticker, wanted: this.wanted, values, failed: this.failed, completed: new Set(), greeks: this.greeks,
            futures: futuresPrice(this.values.get(this.underlying) ?? {}), now: new Date(),
        }).payload;
    }

    valueRows(symbols: Iterable<string>): LiveValueRow[] {
        const byName = new Map(this.wanted.map((w) => [w.symbol, w]));
        const out: LiveValueRow[] = [];
        for (const sym of Array.from(symbols)) {
            const w = byName.get(sym);
            if (!w || this.failed.has(sym)) continue;
            const v = this.values.get(sym) ?? {};
            const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
            const oi = this.oiOf(w);
            out.push([sym.slice(sym.indexOf(':') + 1), n(v.bid), n(v.ask), n(v.lp), n(v.volume), oi?.value ?? null, oi?.day ?? null]);
        }
        return out;
    }

    greekRows(): LiveGreekRow[] {
        const out: LiveGreekRow[] = [];
        for (const w of this.wanted) {
            const name = w.symbol.slice(w.symbol.indexOf(':') + 1);
            const g = this.greeks.get(name);
            if (g) out.push([name, g.iv, g.delta, g.gamma, g.theta, g.vega, g.rho]);
        }
        return out;
    }

    private flush(): void {
        if (!this.ready || !this.dirty.size || !this.clients.size) {
            if (!this.clients.size) this.dirty.clear();
            return;
        }
        const rows = this.valueRows(this.dirty);
        this.dirty.clear();
        if (rows.length) this.broadcast(sseEvent('delta', { root: this.ticker, updated: new Date().toISOString(), rows }));
    }

    private sendSnapshot(): void {
        const snap = this.snapshot();
        if (snap) this.broadcast(snapshotEvent(this.ticker, snap));
    }

    addClient(c: Client): void {
        this.clients.add(c);
        this.send(c, sseEvent('status', this.status));
        const snap = this.snapshot();
        if (snap) this.send(c, snapshotEvent(this.ticker, snap));
    }

    private send(c: Client, text: string): void {
        try { c.controller.enqueue(this.enc.encode(text)); } catch { this.clients.delete(c); }
    }

    broadcast(text: string): void {
        for (const c of Array.from(this.clients)) this.send(c, text);
    }
}

/** The hybrid feeds of the proxy, one per ticker a page has open. */
export class HybridEngine {
    private readonly feeds = new Map<string, HybridFeed>();
    private readonly keepalive: ReturnType<typeof setInterval>;

    constructor(private readonly log: (line: string) => void = (l) => console.log(`TV     | [${new Date().toTimeString().slice(0, 8)}] hybrid ${l}`)) {
        this.keepalive = setInterval(() => this.feeds.forEach((f) => f.broadcast(': keepalive\n\n')), 15_000);
    }

    statusJson(): Record<string, unknown> {
        return { hybrid: true, maxFeeds: HYBRID_MAX_FEEDS, feeds: Array.from(this.feeds.values()).map((f) => ({ symbol: f.ticker, underlying: f.underlying, state: f.status.state, message: f.status.message, options: f.wanted.length, clients: f.clients.size })) };
    }

    /** GET /api/tv/live?symbol=SPY */
    response(symbol: string): Response {
        const t = symbol.trim().toUpperCase().replace(/^[_^]/, '');
        if (!underlyingCandidates(t).length) return new Response(JSON.stringify({ error: `not a ticker: ${symbol}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        let feed = this.feeds.get(t);
        if (!feed) {
            if (this.feeds.size >= HYBRID_MAX_FEEDS) this.dropIdlest();
            if (this.feeds.size >= HYBRID_MAX_FEEDS) return new Response(JSON.stringify({ error: `at most ${HYBRID_MAX_FEEDS} tickers stream at once` }), { status: 429, headers: { 'Content-Type': 'application/json' } });
            feed = new HybridFeed(t, this.log);
            this.feeds.set(t, feed);
            void feed.start();
        }
        const f = feed;
        if (f.idleTimer) { clearTimeout(f.idleTimer); f.idleTimer = null; }
        let me: Client | null = null;
        const stream = new ReadableStream<Uint8Array>({
            start: (controller) => { me = { controller }; f.addClient(me); },
            cancel: () => {
                if (me) f.clients.delete(me);
                if (!f.clients.size) f.idleTimer = setTimeout(() => this.drop(t), HYBRID_IDLE_MS);
            },
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
    }

    private drop(t: string): void {
        const f = this.feeds.get(t);
        if (!f || f.clients.size) return;
        f.stop();
        this.feeds.delete(t);
        this.log(`${t}: stopped (no page for ${HYBRID_IDLE_MS / 60_000} min)`);
    }

    private dropIdlest(): void {
        const idle = Array.from(this.feeds.values()).find((f) => !f.clients.size);
        if (idle) {
            idle.stop();
            this.feeds.delete(idle.ticker);
        }
    }

    stop(): void {
        clearInterval(this.keepalive);
        this.feeds.forEach((f) => f.stop());
        this.feeds.clear();
    }
}
