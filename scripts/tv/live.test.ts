/// <reference types="node" />
/// <reference types="bun" />
// The TradingView live mode of the proxy (scripts/tv/live.ts) with a fake watcher and a fake Chrome import: the event
// stream (status, snapshot, batched deltas), the automatic session recovery and the file endpoint. No network.
import { describe, expect, test } from 'bun:test';
import type { Payload, Quote } from '../options-data';
import type { LiveGreekRow, LiveValueRow, WatcherHooks, WatcherStatus } from './futures';
import { engineDecision, futuresFileResponse, quoteName, sseEvent, TvLiveEngine, type WatcherLike } from './live';
import type { ImportResult } from './session';

const quote = (symbol: string, bid: number): Quote => ({
    symbol, expiration: '2026-10-30', side: 'call', strike: 7600, bid, ask: bid + 0.5, mid: bid + 0.25, last: null, volume: 1, openInterest: 10,
    iv: 0.2, delta: 0.5, gamma: 0.001, theta: null, vega: null, rho: null, greeksSource: 'tradingview', greeksMissingReason: null,
});

class FakeWatcher implements WatcherLike {
    status: WatcherStatus = { state: 'starting', message: 'starting', until: null, since: 0 };
    quotes = new Map<string, Quote>([['E4A261030C7600', quote('E4A261030C7600', 10)], ['E4A261030P7600', quote('E4A261030P7600', 12)]]);
    ready = false;
    stopped = false;
    constructor(readonly hooks: WatcherHooks, private readonly fail: WatcherStatus | null) {}
    async runWatch(): Promise<void> {
        if (this.fail) {
            this.status = this.fail;
            this.hooks.onStatus?.(this.fail);
            throw new Error(this.fail.message);
        }
        this.ready = true;
        this.status = { state: 'live', message: 'streaming ES', until: null, since: 1 };
        this.hooks.onStatus?.(this.status);
    }
    stop(): void { this.stopped = true; }
    readyRoots(): string[] { return this.ready ? ['ES'] : []; }
    valueRows(_root: string, symbols: Iterable<string>): LiveValueRow[] {
        return Array.from(symbols).map((sym) => quoteName(sym)).filter((n) => this.quotes.has(n)).map((n) => {
            const q = this.quotes.get(n)!;
            return [n, q.bid, q.ask, q.last, q.volume, q.openInterest, '2026-10-23'];
        });
    }
    greekRows(): LiveGreekRow[] {
        return Array.from(this.quotes.values()).map((q) => [q.symbol, q.iv, q.delta, q.gamma, q.theta, q.vega, q.rho]);
    }
    snapshot(root: string): Payload | null {
        if (!this.ready) return null;
        return { symbol: root, updated: '2026-10-26T10:00:01-04:00', date: '2026-10-26', underlyingPrice: 7650.25, greeks: {} as Payload['greeks'], expirations: ['2026-10-30'], quotes: Array.from(this.quotes.values()) };
    }
}

/** Parsed SSE events of a response, read for `ms`. */
async function readEvents(res: Response, ms: number): Promise<Array<{ event: string; data: any }>> {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const out: Array<{ event: string; data: any }> = [];
    const deadline = Date.now() + ms;
    for (;;) {
        const left = deadline - Date.now();
        if (left <= 0) break;
        const next = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), left))]);
        if (!next || next.done) break;
        buf += dec.decode(next.value, { stream: true });
    }
    void reader.cancel();
    for (const block of buf.split('\n\n')) {
        const ev = /^event: (\w+)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (ev && data) out.push({ event: ev, data: JSON.parse(data) });
    }
    return out;
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('live mode: event stream', () => {
    test('on connect: status and the snapshot (the file object); then ONE batched delta per flush with the changed quotes only', async () => {
        let w: FakeWatcher | null = null;
        const engine = new TvLiveEngine({ roots: ['ES'], log: () => {}, flushMs: 100, makeWatcher: (_r, hooks) => (w = new FakeWatcher(hooks, null)) });
        engine.start();
        await tick(20);
        const res = engine.response('ES');
        setTimeout(() => {
            // three pushes of the same call within one flush window -> one delta with that quote once
            w!.quotes.set('E4A261030C7600', quote('E4A261030C7600', 11));
            for (let i = 0; i < 3; i++) w!.hooks.onValues?.('ES', ['CME_MINI:E4A261030C7600']);
            // the futures themselves are not options: no row
            w!.hooks.onValues?.('ES', ['CME_MINI:ESZ2026']);
        }, 30);
        setTimeout(() => w!.hooks.onGreeks?.('ES'), 250);
        const events = await readEvents(res, 400);
        engine.stop();
        expect(events.map((e) => e.event)).toEqual(['status', 'snapshot', 'delta', 'greeks']);
        expect(events[0].data.state).toBe('live');
        expect(events[1].data.root).toBe('ES');
        expect(events[1].data.payload.quotes).toHaveLength(2);
        expect(events[1].data.payload.underlyingPrice).toBe(7650.25);
        expect(events[2].data.root).toBe('ES');
        expect(events[2].data.rows).toEqual([['E4A261030C7600', 11, 11.5, null, 1, 10, '2026-10-23']]);
        expect(events[3].data.rows).toEqual([['E4A261030C7600', 0.2, 0.5, 0.001, null, null, null], ['E4A261030P7600', 0.2, 0.5, 0.001, null, null, null]]);
        expect(engine.stats.deltas).toBe(1);
    });

    test('a moved window sends a fresh snapshot; an unknown root is a 404', async () => {
        let w: FakeWatcher | null = null;
        const engine = new TvLiveEngine({ roots: ['ES'], log: () => {}, flushMs: 100, makeWatcher: (_r, hooks) => (w = new FakeWatcher(hooks, null)) });
        engine.start();
        await tick(20);
        const res = engine.response('es');
        setTimeout(() => w!.hooks.onWindow?.('ES'), 30);
        const events = await readEvents(res, 250);
        engine.stop();
        expect(events.map((e) => e.event)).toEqual(['status', 'snapshot', 'snapshot']);
        expect(engine.response('CL').status).toBe(404);
    });

    test('helpers', () => {
        expect(engineDecision({})).toEqual({ start: true });
        expect(engineDecision({ GEX_TV: '0' })).toEqual({ start: false, note: 'TV     | TradingView live mode off (GEX_TV=0)' });
        expect(quoteName('CME_MINI:E4A261026C7630')).toBe('E4A261026C7630');
        expect(sseEvent('status', { a: 1 })).toBe('event: status\ndata: {"a":1}\n\n');
    });
});

describe('live mode: the session is handled by itself', () => {
    const expired: WatcherStatus = { state: 'expired', message: 'session expired -> run bun run tv:session', until: null, since: 0 };

    test('expired at start: imports from Chrome once and starts again with the new session', async () => {
        const made: FakeWatcher[] = [];
        let imports = 0;
        const engine = new TvLiveEngine({
            roots: ['ES'], log: () => {}, retryMs: 50,
            makeWatcher: (_r, hooks) => { const w = new FakeWatcher(hooks, made.length === 0 ? expired : null); made.push(w); return w; },
            fingerprint: () => 'Profile 2:abc',
            importSession: async (): Promise<ImportResult> => { imports++; return { ok: true, changed: true, profile: 'Profile 2' }; },
        });
        engine.start();
        await tick(30);
        engine.stop();
        expect(imports).toBe(1);
        expect(made).toHaveLength(2);
        expect(engine.status.state).toBe('live');
    });

    test('Chrome holds the same expired session: ONE import (one Keychain dialog at most), then only retries, a clear status', async () => {
        let imports = 0;
        let made = 0;
        const engine = new TvLiveEngine({
            roots: ['ES'], log: () => {}, retryMs: 40,
            makeWatcher: (_r, hooks) => { made++; return new FakeWatcher(hooks, expired); },
            fingerprint: () => 'Profile 2:abc',
            importSession: async (): Promise<ImportResult> => { imports++; return { ok: true, changed: false, profile: 'Profile 2' }; },
        });
        engine.start();
        await tick(200);
        engine.stop();
        expect(imports).toBe(1);
        expect(made).toBeGreaterThanOrEqual(3); // retried every retryMs, no tight loop (200 ms / 40 ms)
        expect(made).toBeLessThanOrEqual(6);
        expect(engine.status.state).toBe('expired');
        expect(engine.status.message).toBe('the TradingView session in Chrome is expired too: log in to tradingview.com in Chrome');
    });

    test('no Chrome session at all: no import, the status says to log in', async () => {
        let imports = 0;
        const engine = new TvLiveEngine({
            roots: ['ES'], log: () => {}, retryMs: 10_000,
            makeWatcher: (_r, hooks) => new FakeWatcher(hooks, { state: 'no-session', message: 'no session -> run bun run tv:session', until: null, since: 0 }),
            fingerprint: () => null,
            importSession: async (): Promise<ImportResult> => { imports++; return { ok: false, reason: 'x' }; },
        });
        engine.start();
        await tick(30);
        engine.stop();
        expect(imports).toBe(0);
        expect(engine.status.message).toContain('log in to tradingview.com in Chrome');
        expect(engine.statusJson()).toMatchObject({ engine: true, state: 'no-session', roots: [] });
    });

    test('rate limited at start: waits until the pause ends, no import', async () => {
        let made = 0;
        let imports = 0;
        const engine = new TvLiveEngine({
            roots: ['ES'], log: () => {}, retryMs: 10,
            makeWatcher: (_r, hooks) => { made++; return new FakeWatcher(hooks, { state: 'rate-limited', message: 'tradingview.com answered 429', until: Date.now() + 10_000, since: 0 }); },
            fingerprint: () => 'x',
            importSession: async (): Promise<ImportResult> => { imports++; return { ok: true, changed: true, profile: 'p' }; },
        });
        engine.start();
        await tick(100);
        engine.stop();
        expect(made).toBe(1);
        expect(imports).toBe(0);
    });
});

describe('futures file endpoint', () => {
    test('400 for anything that is not a known root, 404 before the file exists', () => {
        expect(futuresFileResponse('/api/futures/..%2Fx.json').status).toBe(400);
        expect(futuresFileResponse('/api/futures/CL.json').status).toBe(400);
        expect(futuresFileResponse('/api/futures/MES.json', '/nonexistent-dir').status).toBe(404);
    });
});

describe('live mode: focus (fast start, owner 2026-10-26)', () => {
    test('what the pages asked for goes to the watcher (replayed when it is created), a new client focuses its root, unknown roots are refused', async () => {
        const calls: string[] = [];
        let w: FakeWatcher | null = null;
        const engine = new TvLiveEngine({
            roots: ['ES', 'NQ'], log: () => {}, flushMs: 100,
            makeWatcher: (_r, hooks) => {
                const fw = new FakeWatcher(hooks, null) as FakeWatcher & { focus: (root: string, exps?: readonly string[]) => void };
                fw.focus = (root, exps) => calls.push(`${root}:${exps ? exps.join('|') : '-'}`);
                return (w = fw);
            },
        });
        expect(engine.focus('NQ', ['2026-10-27'])).toBe(true);
        expect(engine.focus('es')).toBe(true);
        expect(engine.focus('CL')).toBe(false);
        engine.start();
        await tick(20);
        expect(w).not.toBeNull();
        // replayed oldest first, so the most recent (ES) ends up first in the watcher's order
        expect(calls).toEqual(['NQ:2026-10-27', 'ES:-']);
        // a new client of NQ keeps the expirations NQ was focused with
        const res = engine.response('NQ');
        expect(calls[calls.length - 1]).toBe('NQ:2026-10-27');
        void res.body?.cancel();
        engine.stop();
    });
});
