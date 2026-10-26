/// <reference types="node" />
/// <reference types="bun" />
// Cheap guard of the TradingView session (owner 2026-10-25, it replaced the local-only checks when the futures files became
// published): no tracked file, and none of the futures files that get committed (api/futures/), holds a JWT, a session
// cookie or, on the owner's machine, the session value itself. The big data folders (api/options, api/charts, api/history)
// are written by the public fetcher, which never sees the session, and are skipped to keep the test fast.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv, TV_ENV_PATH } from './env';

const REPO = join(__dirname, '..', '..');
const SKIP = /^(api\/(options|charts|history)\/|.*\.(png|jpe?g|gif|ico|zip|woff2?)$)/;

function filesToScan(): string[] {
    const tracked = Bun.spawnSync(['git', 'ls-files'], { cwd: REPO }).stdout.toString().split('\n').filter(Boolean);
    const futuresDir = join(REPO, 'api', 'futures');
    const futures = existsSync(futuresDir) ? readdirSync(futuresDir).filter((f) => f.endsWith('.json')).map((f) => `api/futures/${f}`) : [];
    return Array.from(new Set(tracked.concat(futures))).filter((f) => !SKIP.test(f) && existsSync(join(REPO, f)));
}

describe('no TradingView secret in the repository', () => {
    const files = filesToScan();
    test('no JWT, no session cookie, no auth token value in any tracked file or futures file', () => {
        expect(files.length).toBeGreaterThan(10);
        const hits = files.filter((f) => {
            const text = readFileSync(join(REPO, f), 'utf8');
            return /eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/.test(text) || /sessionid=[a-z0-9]{8,}/i.test(text) || /"auth_token":"eyJ/.test(text);
        });
        expect(hits).toEqual([]);
    });

    test('on the owner\'s machine the session value appears in no tracked file or futures file', () => {
        if (!existsSync(TV_ENV_PATH)) return;
        const env = parseEnv(readFileSync(TV_ENV_PATH, 'utf8'));
        const secrets = [env.TV_SESSIONID, env.TV_SESSIONID_SIGN].filter((v): v is string => Boolean(v && v.length >= 8));
        // only the file names are reported, never the value
        const hits = files.filter((f) => { const text = readFileSync(join(REPO, f), 'utf8'); return secrets.some((s) => text.includes(s)); });
        expect(hits).toEqual([]);
    });
});
