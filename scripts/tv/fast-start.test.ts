/// <reference types="node" />
/// <reference types="bun" />
// Fast TradingView live start (owner 2026-10-26) end to end against a local fake TradingView (fake-tv.ts): the real
// FuturesWatcher inside the real TvLiveEngine. The first snapshot comes from the scanner (bid, ask) with the last file's
// open interest before the websocket subscription is done; the focused root and its selected expirations join the
// websocket first; an option streams from its first answer; a focus change re-prioritises the running subscription.
// No fixed sleeps: every wait polls a condition with a deadline.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isoDate, TV_SCAN } from './chain';
import { startFakeTv, WS_BID_SHIFT, type FakeTv } from './fake-tv';
import { FuturesWatcher } from './futures';
import { TvLiveEngine } from './live';
import { TV_HTTP } from './ws';

const DIR = join(__dirname, '..', '..', '.temp', `fast-start-test-${process.pid}`);
const saved = { chart: TV_HTTP.chartUrl, ws: TV_HTTP.wsUrl, scan: TV_SCAN.url, sessionid: process.env.TV_SESSIONID };
let fake: FakeTv;

beforeAll(() => {
    // NQ 488 options, ES 2,264 (4 dates each, pickSeries' fallback); 30 ms per websocket answer
    fake = startFakeTv({
        NQ: { continuous: 'CME_MINI:NQ1!', front: 'NQZ2026', forward: 25000, strikeStep: 50, families: ['Q1A'], dates: 4 },
        ES: { continuous: 'CME_MINI:ES1!', front: 'ESZ2026', forward: 7000, strikeStep: 5, families: ['E1A'], dates: 4 },
    }, { answerMs: 30 });
    TV_HTTP.chartUrl = fake.chartUrl;
    TV_HTTP.wsUrl = fake.wsUrl;
    TV_SCAN.url = fake.scanUrl;
    process.env.TV_SESSIONID = 'fake-session-for-tests';
    mkdirSync(DIR, { recursive: true });
});

afterAll(() => {
    fake.close();
    TV_HTTP.chartUrl = saved.chart;
    TV_HTTP.wsUrl = saved.ws;
    TV_SCAN.url = saved.scan;
    if (saved.sessionid === undefined) delete process.env.TV_SESSIONID; else process.env.TV_SESSIONID = saved.sessionid;
    rmSync(DIR, { recursive: true, force: true });
});

/** Wait until `cond` holds, polling; fails after `ms`. */
async function until(cond: () => boolean, what: string, ms = 15000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
        await new Promise((r) => setTimeout(r, 10));
    }
}

/** Collect the SSE events of a response in the background. */
function collect(res: Response): { events: Array<{ event: string; data: any; at: number }>; stop: () => void } {
    const events: Array<{ event: string; data: any; at: number }> = [];
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let stopped = false;
    void (async () => {
        while (!stopped) {
            const next = await reader.read();
            if (next.done) break;
            buf += dec.decode(next.value, { stream: true });
            let i: number;
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const block = buf.slice(0, i);
                buf = buf.slice(i + 2);
                const ev = /^event: (\w+)$/m.exec(block)?.[1];
                const data = /^data: (.*)$/m.exec(block)?.[1];
                if (ev && data) events.push({ event: ev, data: JSON.parse(data), at: Date.now() });
            }
        }
    })();
    return { events, stop: () => { stopped = true; void reader.cancel(); } };
}

describe('fast start against a fake TradingView', () => {
    test('scanner snapshot first, the focused root and its selected expiration subscribed first, each option live at once, focus re-prioritises', async () => {
        const nqFront = 'Q1A';
        const second = isoDate(fake.dates[1]);
        // the last file of NQ: open interest 4242 (dated) on every option, volume of an older day (must not be used)
        const nqNames: string[] = [];
        for (const exp of fake.dates.slice(0, 4)) for (let k = 23500; k <= 26500; k += 50) for (const s of ['C', 'P']) nqNames.push(`${nqFront}${String(exp).slice(2)}${s}${k}`);
        writeFileSync(join(DIR, 'NQ.json'), JSON.stringify({ date: '2020-01-02', quotes: nqNames.map((symbol) => ({ symbol, openInterest: 4242, oiDate: '2026-10-23', volume: 999, last: 1 })) }));

        const logs: string[] = [];
        const engine = new TvLiveEngine({
            roots: ['ES', 'NQ'], log: (l) => logs.push(l), flushMs: 50,
            makeWatcher: (roots, hooks) => new FuturesWatcher({ roots, once: false, watchMs: 60_000, refreshMs: 600_000, help: false }, hooks, { dir: DIR, distDir: null, batchPauseMs: 15, batchTimeoutMs: 3000 }),
        });
        // the page has /NQ open with its second expiration selected (GET /api/futures/focus before the engine runs)
        expect(engine.focus('NQ', [second])).toBe(true);
        expect(engine.focus('CL')).toBe(false);
        const t0 = Date.now();
        engine.start();
        const nq = collect(engine.response('NQ'));
        try {
            await until(() => nq.events.some((e) => e.event === 'snapshot'), 'NQ snapshot');
            const snap = nq.events.find((e) => e.event === 'snapshot')!;
            const nqAddedAtSnapshot = fake.added.filter((a) => a.symbol.includes(':Q1A')).length;
            const quotes = snap.data.payload.quotes as Array<{ symbol: string; bid: number; openInterest: number; oiDate: string | null; volume: number | null; strike: number }>;
            expect(quotes.length).toBe(488); // 61 strikes within ±6% x 2 sides x 4 dates
            // the snapshot came before the websocket held the window
            expect(nqAddedAtSnapshot).toBeLessThan(quotes.length);
            // options not on the websocket yet: the scanner's bid (no WS_BID_SHIFT), the file's open interest and day, no
            // volume of an older day
            const waiting = quotes.filter((q) => q.openInterest === 4242);
            expect(waiting.length).toBeGreaterThan(quotes.length / 2);
            expect(waiting.every((q) => q.oiDate === '2026-10-23' && q.volume === null)).toBe(true);
            const scanBid = waiting.find((q) => q.bid != null)!;
            expect(scanBid.bid % 0.25).toBe(0);

            // NQ before ES on the websocket, the selected expiration first, the nearest strikes first
            await until(() => logs.some((l) => /^NQ: subscribed \d+ options/.test(l)), 'NQ fully subscribed');
            const opts = fake.added.map((a) => a.symbol);
            const firstEs = opts.findIndex((s) => s.includes(':E1A'));
            const lastNq = opts.length - 1 - opts.slice().reverse().findIndex((s) => s.includes(':Q1A'));
            expect(firstEs === -1 || firstEs > lastNq).toBe(true);
            const firstBatch = opts.slice(0, 50);
            const ymd2 = String(fake.dates[1]).slice(2);
            expect(firstBatch.every((s) => s.includes(`Q1A${ymd2}`))).toBe(true);
            const strikes = firstBatch.map((s) => Number(/[CP](\d+)$/.exec(s)![1]));
            // 1% bands around the forward 25,000: the 18 options closer than 250 points come first, the bands never go back
            const bands = strikes.map((k) => Math.floor(Math.abs(k - 25000) / 250));
            expect(bands.slice(0, 18).every((b) => b === 0)).toBe(true);
            expect(bands.every((b, i) => i === 0 || b >= bands[i - 1])).toBe(true);
            expect(strikes[0]).toBe(25000);

            // an option streams from its first answer: a delta with the websocket's bid (scanner + WS_BID_SHIFT) and its OI
            await until(() => nq.events.some((e) => e.event === 'delta' && (e.data.rows as unknown[][]).some((r) => r[5] !== 4242)), 'a websocket delta');
            const live = nq.events.filter((e) => e.event === 'delta').flatMap((e) => e.data.rows as Array<[string, number, number, number, number, number, string]>).find((r) => r[5] !== 4242)!;
            const atm = quotes.find((q) => q.symbol === live[0])!;
            expect(live[1]).toBe(atm.bid + WS_BID_SHIFT);
            // the status counts the options on the websocket per root
            const st = nq.events.filter((e) => e.event === 'status').map((e) => e.data).find((s) => s.subscribed?.NQ);
            expect(st.state).toBe('live');
            expect(st.subscribed.NQ[1]).toBe(quotes.length);

            // re-prioritise: ES is being subscribed now; a page opens NQ again -> nothing left there; ES finishes
            await until(() => logs.some((l) => /^ES: subscribed \d+ options/.test(l)), 'ES fully subscribed');
            const done = engine.statusJson() as { state: string; subscribed: Record<string, [number, number]> };
            expect(done.state).toBe('live');
            expect(done.subscribed.ES[0]).toBe(done.subscribed.ES[1]);
            expect(done.subscribed.NQ[0]).toBe(done.subscribed.NQ[1]);
            // the timing of this run (fake answers in 30 ms, 15 ms between batches)
            const firstSnapshotMs = snap.at - t0;
            expect(firstSnapshotMs).toBeLessThan(3000);
        } finally {
            nq.stop();
            engine.stop();
        }
    }, 30_000);

    test('a focus change re-prioritises the running subscription', async () => {
        rmSync(join(DIR, 'NQ.json'), { force: true });
        const logs: string[] = [];
        const engine = new TvLiveEngine({
            roots: ['NQ', 'ES'], log: (l) => logs.push(l), flushMs: 50,
            makeWatcher: (roots, hooks) => new FuturesWatcher({ roots, once: false, watchMs: 60_000, refreshMs: 600_000, help: false }, hooks, { dir: DIR, distDir: null, batchPauseMs: 15, batchTimeoutMs: 3000 }),
        });
        const from = fake.added.length;
        engine.start();
        // NQ (the default first root) is being subscribed; the page opens ES
        await until(() => fake.added.slice(from).filter((a) => a.symbol.includes(':Q1A')).length >= 100, 'NQ under way');
        const es = collect(engine.response('ES'));
        try {
            const switchAt = fake.added.length;
            await until(() => logs.some((l) => /^ES: subscribed \d+ options/.test(l)), 'ES fully subscribed');
            const after = fake.added.slice(switchAt).map((a) => a.symbol);
            // at most the batch that was in flight is still NQ, then ES runs to the end before NQ continues
            const firstEs = after.findIndex((s) => s.includes(':E1A'));
            expect(firstEs).toBeGreaterThanOrEqual(0);
            expect(firstEs).toBeLessThanOrEqual(50);
            const esDone = after.length;
            expect(after.slice(firstEs, esDone).every((s) => s.includes(':E1A'))).toBe(true);
            expect(logs.some((l) => /^NQ: subscribed/.test(l))).toBe(false);
            await until(() => logs.some((l) => /^NQ: subscribed \d+ options/.test(l)), 'NQ finishes after ES');
        } finally {
            es.stop();
            engine.stop();
        }
    }, 30_000);
});
