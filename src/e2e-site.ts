/// <reference types="node" />
/// <reference types="bun" />
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildBackupZip } from './backtest/backup';
import { siteZipPath } from './backtest/entries';

// ============================================================================
// Helper of the browser (e2e) checks, `*.e2e.ts`: builds the app into a temp
// folder, copies the tickers of the CACHE provider it needs (SPY and QQQ) and serves
// the result. Not a unit test file, `bun test` does not pick it up. Never
// imported by src/ code.
// ============================================================================

const ROOT = join(__dirname, '..');

export interface TestSite {
    url: string;
    close: () => void;
}

/** A snapshot to put on the test site: its id, the tickers in it (SPY, QQQ) and the spot the SPY file gets so it can be told from today's. */
export interface TestSnapshot {
    id: string;
    tickers: Array<'SPY' | 'QQQ'>;
    spot: number;
}

/** `snapshots` become `api/history/<month>/<id>.zip` plus `api/history/index.json`, and `api/latest.json` gets `latest`. */
export async function startTestSite(opts: { snapshots?: TestSnapshot[]; latest?: string; futures?: Record<string, string> } = {}): Promise<TestSite> {
    const dir = mkdtempSync(join(tmpdir(), 'gex-e2e-'));
    // `bun run test:e2e` (src/e2e-run.ts) builds the app ONCE and hands the folder over, every check copies it (it adds its own
    // files to the copy); a check run alone builds for itself
    const shared = process.env.E2E_BUILD;
    if (shared && existsSync(shared)) cpSync(shared, dir, { recursive: true });
    else {
        const build = Bun.spawn(['bunx', 'parcel', 'build', '--no-cache', '--no-source-maps', '--dist-dir', dir], { cwd: ROOT, stdout: 'ignore', stderr: 'inherit' });
        if ((await build.exited) !== 0) throw new Error('parcel build failed');
    }
    for (const f of ['options/index.json', 'options/SPY.json', 'charts/SPY.json', 'options/QQQ.json', 'charts/QQQ.json']) {
        mkdirSync(join(dir, 'api', f.split('/')[0]), { recursive: true });
        cpSync(join(ROOT, 'api', f), join(dir, 'api', f));
    }
    if (opts.snapshots?.length) {
        const index: Record<string, string[]> = {};
        for (const snap of opts.snapshots) {
            const files = snap.tickers.map((symbol) => {
                const file = JSON.parse(readFileSync(join(ROOT, 'api', 'options', `${symbol}.json`), 'utf8'));
                file.underlyingPrice = snap.spot;
                file.date = snap.id.slice(0, 10);
                return { symbol, text: JSON.stringify(file) };
            });
            const zipPath = join(dir, siteZipPath(snap.id));
            mkdirSync(join(zipPath, '..'), { recursive: true });
            writeFileSync(zipPath, await buildBackupZip(snap.id, files));
            index[snap.id] = [...snap.tickers].sort();
        }
        writeFileSync(join(dir, 'api', 'history', 'index.json'), JSON.stringify({ version: 1, snapshots: index }));
    }
    if (opts.latest) writeFileSync(join(dir, 'api', 'latest.json'), JSON.stringify({ version: 1, date: opts.latest }));
    // futures files (api/futures/<ROOT>.json, as tv:futures writes them), by root
    for (const [root, text] of Object.entries(opts.futures ?? {})) {
        mkdirSync(join(dir, 'api', 'futures'), { recursive: true });
        writeFileSync(join(dir, 'api', 'futures', `${root}.json`), text);
    }
    const server = Bun.serve({
        port: 0,
        fetch(req) {
            const p = new URL(req.url).pathname;
            const file = Bun.file(join(dir, p === '/' ? 'index.html' : p));
            return file.size ? new Response(file) : new Response('not found', { status: 404 });
        },
    });
    return { url: `http://localhost:${server.port}/`, close: () => { server.stop(true); rmSync(dir, { recursive: true, force: true }); } };
}

/** Any request to the default local proxy (http://localhost:8787, also as 127.0.0.1) fails, as when no proxy runs. */
const LOCAL_PROXY_URL = /^https?:\/\/(localhost|127\.0\.0\.1):8787\//;

/**
 * Auto proxy (src/proxy-discovery.ts): the app looks for the local proxy on load and uses live data when it answers.
 * Checks that want the CACHE provider call this before `page.goto`, so a proxy running on the developer's machine does
 * not turn them live; with the proxy "down" the app uses the cache by itself (this replaced the old 💾 click).
 */
export async function noProxy(page: Page): Promise<void> {
    await page.route(LOCAL_PROXY_URL, (route) => route.abort());
    await slowCpu(page);
}

/**
 * `E2E_CPU_THROTTLE=<rate>` (e.g. 4-6) slows the page's CPU down by that factor (Chrome DevTools' CPU throttling), to
 * reproduce a slow CI runner locally: `E2E_CPU_THROTTLE=5 bun run test:e2e desk`. No-op without it. `noProxy` applies it,
 * so every check that uses the cache gets it.
 */
export async function slowCpu(page: Page): Promise<void> {
    const rate = Number(process.env.E2E_CPU_THROTTLE);
    if (!(rate > 1)) return;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

/**
 * Waits until the scroll container `selector` stops moving: its scrollTop unchanged for `frames` animation frames in a row,
 * after it moved at all or after `idleMs` without any move (nothing to scroll). A smooth scroll (a scroll marks click)
 * takes about 1.5 s across a long desk and longer on a slow runner, so a fixed sleep caught the row still gliding.
 * Resolves with the settled scrollTop, rejects after `timeoutMs`.
 */
export async function scrollSettled(page: Page, selector: string, opts: { frames?: number; idleMs?: number; timeoutMs?: number } = {}): Promise<number> {
    const { frames = 10, idleMs = 600, timeoutMs = 15000 } = opts;
    return page.evaluate(([sel, still, idle, timeout]) => new Promise<number>((resolve, reject) => {
        const el = document.querySelector(sel);
        if (!el) { reject(new Error(`scrollSettled: no ${sel}`)); return; }
        const t0 = performance.now();
        const start = el.scrollTop;
        let last = start;
        let same = 0;
        const step = () => {
            const now = el.scrollTop;
            same = Math.abs(now - last) < 0.5 ? same + 1 : 0;
            last = now;
            const moved = Math.abs(now - start) >= 0.5;
            if (same >= still && (moved || performance.now() - t0 >= idle)) { resolve(now); return; }
            if (performance.now() - t0 > timeout) { reject(new Error(`scrollSettled: ${sel} still scrolling after ${timeout} ms`)); return; }
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }), [selector, frames, idleMs, timeoutMs] as const);
}

/**
 * Polls `check` every `everyMs` until it is true or `timeoutMs` passed; returns its last answer. For a state the app reaches
 * asynchronously (the browser's full screen, a toast): the check asserts the answer, a fixed sleep guessed how long it takes.
 */
export async function eventually(check: () => Promise<boolean>, timeoutMs = 5000, everyMs = 50): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    for (;;) {
        if (await check()) return true;
        if (Date.now() > end) return false;
        await new Promise((r) => setTimeout(r, everyMs));
    }
}

export interface FakeProxy {
    /** http://localhost:<port> */
    base: string;
    /** /health answers 200 (true) or the server refuses (false: 503, as if not running) */
    setUp: (up: boolean) => void;
    /** /api/cboe serves SPY and QQQ (true) or answers 500 (false), to check the fallback */
    setCboe: (ok: boolean) => void;
    /** paths requested so far (with the Origin header seen and the query string) */
    hits: Array<{ path: string; origin: string | null; query?: string }>;
    /** send one TradingView live mode event (status, snapshot, delta, greeks) to every /api/futures/live client (scripts/tv/live.ts) */
    sendLive: (event: string, data: unknown) => void;
    /** clients connected to /api/futures/live right now */
    liveClients: () => number;
    close: () => void;
}

/**
 * A stand-in for scripts/options-local-proxy.ts: /health, and /api/cboe with the cached SPY / QQQ chains in the Cboe
 * shape; every other /api route answers 500 (so YAHOO and NASDAQ fail and the cache is the last fallback). CORS for
 * any Origin plus the private network preflight answer, like the real proxy for its allowed origins.
 */
export function startFakeProxy(): FakeProxy {
    let up = true;
    let cboe = true;
    const hits: FakeProxy['hits'] = [];
    const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
    const enc = new TextEncoder();
    const cboeBody = (symbol: string): string | null => {
        const file = join(ROOT, 'api', 'options', `${symbol}.json`);
        if (!existsSync(file)) return null;
        const j = JSON.parse(readFileSync(file, 'utf8'));
        const options = (j.quotes as Array<Record<string, unknown>>).map((q) => ({
            option: q.symbol, bid: q.bid, ask: q.ask, last_trade_price: q.last, volume: q.volume, open_interest: q.openInterest,
            iv: q.iv, delta: q.delta, gamma: q.gamma, theta: q.theta, vega: q.vega, rho: q.rho,
        }));
        return JSON.stringify({ data: { current_price: j.underlyingPrice, options } });
    };
    const server = Bun.serve({
        port: 0,
        fetch(req, srv) {
            const url = new URL(req.url);
            const origin = req.headers.get('origin');
            hits.push({ path: url.pathname, origin, query: url.search });
            const cors: Record<string, string> = origin
                ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Private-Network': 'true', Vary: 'Origin' }
                : {};
            if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
            if (url.pathname === '/health') return new Response(up ? 'ok' : 'down', { status: up ? 200 : 503, headers: cors });
            if (!up) return new Response('down', { status: 503, headers: cors });
            // CME's product totals of the open interest cross-check (scripts/tv/cme-oi.ts): SPY's file under the YM name has
            // symbols like SPY261030C00500000, so the fake product is SPY
            if (url.pathname === '/api/futures/cme-oi') return new Response(JSON.stringify({ day: '2026-10-22', file: 'daily_volume_20261022.xlsx', products: { 'SPY|call': 1e9, 'SPY|put': 1e9 } }), { headers: { ...cors, 'Content-Type': 'application/json' } });
            // fast start: the page names the expirations it shows (scripts/tv/live.ts focus)
            if (url.pathname === '/api/futures/focus') return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
            if (url.pathname === '/api/futures/live' || url.pathname === '/api/tv/live') {
                srv.timeout(req, 0);
                let self: ReadableStreamDefaultController<Uint8Array> | null = null;
                const stream = new ReadableStream<Uint8Array>({
                    start: (c) => { self = c; streams.add(c); c.enqueue(enc.encode(': connected\n\n')); },
                    cancel: () => { if (self) streams.delete(self); },
                });
                return new Response(stream, { headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
            }
            if (url.pathname === '/api/cboe' && cboe) {
                const body = cboeBody(String(url.searchParams.get('symbol') ?? '').replace(/^_/, ''));
                if (body) return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify({ error: 'fake proxy: not served' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
        },
    });
    return {
        base: `http://localhost:${server.port}`,
        setUp: (v) => { up = v; },
        setCboe: (v) => { cboe = v; },
        hits,
        sendLive: (event, data) => {
            const bytes = enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            for (const c of Array.from(streams)) {
                try { c.enqueue(bytes); } catch { streams.delete(c); }
            }
        },
        liveClients: () => streams.size,
        close: () => server.stop(true),
    };
}
