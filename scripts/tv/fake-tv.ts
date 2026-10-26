/// <reference types="node" />
/// <reference types="bun" />
/**
 * A local fake of TradingView for the tests of the futures live mode (fast-start.test.ts) and for timing runs: the chart
 * page (auth token), the scanner (bid, ask, greeks of a window) and the realtime websocket (quote sessions answering
 * `quote_add_symbols` with `qsd` + `quote_completed` after `answerMs`). Point the watcher at it with TV_HTTP.chartUrl,
 * TV_HTTP.wsUrl and TV_SCAN.url. No real request, no session: the token is a fixed non-secret string.
 *
 * Prices are a plain shape (intrinsic value plus a time value), not a model: the websocket answers every option with the
 * scanner's bid and ask plus WS_BID_SHIFT, so a test can tell which source a value came from.
 */
import { encodeFrame, decodeFrames } from './ws';
import { isThirdFriday, optionSymbol, type Family, type Series } from './chain';

/** The websocket's bid and ask are the scanner's plus this (tests tell the two sources apart). */
export const WS_BID_SHIFT = 1;

export interface FakeRoot {
    /** the continuous symbol, e.g. CME_MINI:ES1! */
    continuous: string;
    /** the front contract without the prefix, e.g. ESZ2026 */
    front: string;
    forward: number;
    strikeStep: number;
    /** option roots per expiration date (families), e.g. ['E1A'] */
    families: string[];
    /** how many expiration dates (weekdays from tomorrow, never a third Friday: pickSeries then takes the nearest 4) */
    dates: number;
    /** strikes listed each side of the forward, as a fraction (wider than the watcher's window) */
    spanPct?: number;
}

export interface FakeTv {
    chartUrl: string;
    wsUrl: string;
    scanUrl: string;
    /** every option symbol added on the websocket, in order, with the time it was added (ms since the fake started) */
    added: { symbol: string; at: number }[];
    /** scanner POSTs answered */
    scans: number;
    /** the expiration dates (YYYYMMDD) of the fake chain */
    dates: number[];
    close(): void;
}

/** The next `n` weekdays after `now` that are not third Fridays, as YYYYMMDD. */
export function fakeDates(now: Date, n: number): number[] {
    const out: number[] = [];
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    while (out.length < n) {
        d.setUTCDate(d.getUTCDate() + 1);
        const ymd = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
        if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || isThirdFriday(ymd)) continue;
        out.push(ymd);
    }
    return out;
}

function familiesOf(root: FakeRoot, dates: number[]): Family[] {
    const prefix = root.continuous.slice(0, root.continuous.indexOf(':'));
    const span = root.forward * (root.spanPct ?? 0.1);
    const strikes: number[] = [];
    for (let k = Math.ceil((root.forward - span) / root.strikeStep) * root.strikeStep; k <= root.forward + span; k += root.strikeStep) strikes.push(k);
    return root.families.map((name) => ({
        name, prefix,
        series: dates.map((exp): Series => {
            const s = String(exp);
            return { exp, expTime: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T20:00:00Z`, root: name, strikes, underlying: `${prefix}:${root.front}` };
        }),
    }));
}

/** The scanner's bid and ask of one option: intrinsic value plus a time value that shrinks away from the money. */
function scanQuote(forward: number, side: 'call' | 'put', strike: number): { bid: number; ask: number } {
    const intrinsic = Math.max(0, side === 'call' ? forward - strike : strike - forward);
    const time = Math.max(0.5, forward * 0.004 - Math.abs(forward - strike) * 0.05);
    const mid = Math.round((intrinsic + time) * 4) / 4;
    return { bid: Math.max(0.25, mid - 0.25), ask: mid + 0.25 };
}

/** `answerMs`: delay of every websocket answer; `scanMs`: delay of every scanner page (timing runs) */
export function startFakeTv(roots: Record<string, FakeRoot>, opts: { answerMs?: number; scanMs?: number; now?: Date } = {}): FakeTv {
    const t0 = Date.now();
    const dates = fakeDates(opts.now ?? new Date(), Math.max(...Object.values(roots).map((r) => r.dates)));
    const byContinuous = new Map<string, { root: FakeRoot; families: Family[] }>();
    const options = new Map<string, { root: FakeRoot; side: 'call' | 'put'; strike: number; exp: number; optRoot: string }>();
    for (const r of Object.values(roots)) {
        const families = familiesOf(r, dates.slice(0, r.dates));
        byContinuous.set(r.continuous, { root: r, families });
        for (const f of families) for (const s of f.series) for (const k of s.strikes) for (const side of ['call', 'put'] as const) {
            options.set(optionSymbol(f.prefix, s.root, s.exp, side, k), { root: r, side, strike: k, exp: s.exp, optRoot: s.root });
        }
    }
    const fronts = new Map(Object.values(roots).map((r) => [`${r.continuous.slice(0, r.continuous.indexOf(':'))}:${r.front}`, r]));
    const fake: FakeTv = { chartUrl: '', wsUrl: '', scanUrl: '', added: [], scans: 0, dates, close: () => server.stop(true) };
    const answer = (ws: { send(data: string): unknown }, qs: string, sym: string) => {
        const send = (m: string, p: unknown[]) => ws.send(encodeFrame(JSON.stringify({ m, p })));
        const cont = byContinuous.get(sym);
        const front = fronts.get(sym);
        const opt = options.get(sym);
        if (cont) send('qsd', [qs, { n: sym, s: 'ok', v: { front_contract: cont.root.front, 'options-info': { families: cont.families }, lp: cont.root.forward } }]);
        else if (front) send('qsd', [qs, { n: sym, s: 'ok', v: { lp: front.forward, bid: front.forward - 0.25, ask: front.forward + 0.25 } }]);
        else if (opt) {
            const q = scanQuote(opt.root.forward, opt.side, opt.strike);
            send('qsd', [qs, { n: sym, s: 'ok', v: { bid: q.bid + WS_BID_SHIFT, ask: q.ask + WS_BID_SHIFT, lp: q.bid, volume: 7, oi: { time: Math.floor(t0 / 1000), value: 100 + (opt.strike % 50) }, update_mode: 'streaming' } }]);
        } else {
            send('qsd', [qs, { n: sym, s: 'error', v: {} }]);
        }
        send('quote_completed', [qs, sym]);
    };
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        async fetch(req, srv) {
            const url = new URL(req.url);
            if (url.pathname === '/socket') return srv.upgrade(req) ? undefined : new Response('no upgrade', { status: 400 });
            if (url.pathname === '/chart/') return new Response('<html>"auth_token":"fake-token","username":"fake","is_pro":true</html>');
            if (url.pathname === '/scan') {
                fake.scans++;
                if (opts.scanMs) await new Promise((r) => setTimeout(r, opts.scanMs));
                const body = (await req.json()) as { index_filters: { values: string[] }[]; filter: { left: string; right: unknown }[]; range: [number, number] };
                const front = body.index_filters[0]?.values[0];
                const r = fronts.get(front);
                const range = (left: string) => (body.filter.find((f) => f.left === left)?.right as [number, number] | undefined) ?? [-Infinity, Infinity];
                const [e0, e1] = range('expiration');
                const [k0, k1] = range('strike');
                const rows: { f: unknown[] }[] = [];
                options.forEach((o, sym) => {
                    if (o.root !== r || o.exp < e0 || o.exp > e1 || o.strike < k0 || o.strike > k1) return;
                    const q = scanQuote(o.root.forward, o.side, o.strike);
                    rows.push({ f: [sym.slice(sym.indexOf(':') + 1), o.side, o.strike, o.exp, o.optRoot, 0.2, o.side === 'call' ? 0.5 : -0.5, 0.001, -1, 1, 0.1, q.bid, q.ask] });
                });
                rows.sort((a, b) => Number(a.f[2]) - Number(b.f[2]));
                return Response.json({ totalCount: rows.length, symbols: rows.slice(body.range[0], body.range[1]) });
            }
            return new Response('not found', { status: 404 });
        },
        websocket: {
            message(ws, data) {
                for (const payload of decodeFrames(String(data))) {
                    if (payload.startsWith('~h~')) continue;
                    const msg = JSON.parse(payload) as { m: string; p: unknown[] };
                    if (msg.m !== 'quote_add_symbols') continue;
                    const [qs, ...syms] = msg.p as string[];
                    for (const s of syms) if (options.has(s)) fake.added.push({ symbol: s, at: Date.now() - t0 });
                    const run = () => syms.forEach((s) => answer(ws, qs, s));
                    if (opts.answerMs) setTimeout(run, opts.answerMs); else run();
                }
            },
        },
    });
    fake.chartUrl = `http://127.0.0.1:${server.port}/chart/`;
    fake.wsUrl = `ws://127.0.0.1:${server.port}/socket`;
    fake.scanUrl = `http://127.0.0.1:${server.port}/scan`;
    return fake;
}
