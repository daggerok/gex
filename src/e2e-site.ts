/// <reference types="node" />
/// <reference types="bun" />
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBackupZip } from './backtest/backup';
import { siteZipPath } from './backtest/entries';

// ============================================================================
// Helper of the browser (e2e) checks, `*.e2e.ts`: builds the app into a temp
// folder, copies the tickers of the CACHE provider it needs (SPY and QQQ) and serves
// the result. Not a unit test file, `bun test` does not pick it up. Never
// imported by src/ code.
// ============================================================================

const ROOT = join(import.meta.dir, '..');

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
