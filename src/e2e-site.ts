/// <reference types="node" />
/// <reference types="bun" />
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ============================================================================
// Helper of the browser (e2e) checks, `*.e2e.ts`: builds the app into a temp
// folder, copies the one ticker of the CACHE provider it needs (SPY) and serves
// the result. Not a unit test file, `bun test` does not pick it up. Never
// imported by src/ code.
// ============================================================================

const ROOT = join(import.meta.dir, '..');

export interface TestSite {
    url: string;
    close: () => void;
}

export async function startTestSite(): Promise<TestSite> {
    const dir = mkdtempSync(join(tmpdir(), 'gex-e2e-'));
    const build = Bun.spawn(['bunx', 'parcel', 'build', '--no-cache', '--no-source-maps', '--dist-dir', dir], { cwd: ROOT, stdout: 'ignore', stderr: 'inherit' });
    if ((await build.exited) !== 0) throw new Error('parcel build failed');
    for (const f of ['options/index.json', 'options/SPY.json', 'charts/SPY.json']) {
        mkdirSync(join(dir, 'data', f.split('/')[0]), { recursive: true });
        cpSync(join(ROOT, 'data', f), join(dir, 'data', f));
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
