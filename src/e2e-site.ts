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
export async function startTestSite(opts: { snapshots?: TestSnapshot[]; latest?: string } = {}): Promise<TestSite> {
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
}

export interface FakeProxy {
    /** http://localhost:<port> */
    base: string;
    /** /health answers 200 (true) or the server refuses (false: 503, as if not running) */
    setUp: (up: boolean) => void;
    /** /api/cboe serves SPY and QQQ (true) or answers 500 (false), to check the fallback */
    setCboe: (ok: boolean) => void;
    /** paths requested so far (with the Origin header seen) */
    hits: Array<{ path: string; origin: string | null }>;
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
        fetch(req) {
            const url = new URL(req.url);
            const origin = req.headers.get('origin');
            hits.push({ path: url.pathname, origin });
            const cors: Record<string, string> = origin
                ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Private-Network': 'true', Vary: 'Origin' }
                : {};
            if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
            if (url.pathname === '/health') return new Response(up ? 'ok' : 'down', { status: up ? 200 : 503, headers: cors });
            if (!up) return new Response('down', { status: 503, headers: cors });
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
        close: () => server.stop(true),
    };
}
