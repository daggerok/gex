/// <reference types="node" />
/// <reference types="bun" />
// Guards of the LOCAL-ONLY rule of the TradingView futures scripts (CME data under the owner's personal licence): CI never
// runs them, the fetcher never imports them, their files are never committed or deployed, the fixtures hold no secret.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseEnv, TV_ENV_PATH } from './env';

const REPO = join(__dirname, '..', '..');
const TV_DIR = __dirname;
const read = (p: string) => readFileSync(p, 'utf8');

function filesUnder(dir: string, re: RegExp): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { recursive: true }).map(String).filter((f) => re.test(f)).map((f) => join(dir, f));
}

/** Every repo file `entry` reaches through relative imports (import ... from './x', import('./x'), require('./x')). */
function importGraph(entry: string): string[] {
    const seen = new Set<string>();
    const todo = [entry];
    while (todo.length) {
        const file = todo.pop() as string;
        if (seen.has(file)) continue;
        seen.add(file);
        const re = /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
        const text = read(file);
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const base = resolve(dirname(file), m[1]);
            const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].filter((p) => existsSync(p) && !p.endsWith('/'))[0];
            if (hit && /\.tsx?$/.test(hit)) todo.push(hit);
        }
    }
    return Array.from(seen).map((f) => relative(REPO, f));
}

const TV_WORDS = /scripts\/tv|tv:futures|tv:session|tv:check|api\/futures|tradingview|TV_SESSIONID/i;

describe('TradingView futures stay local', () => {
    test('the CI fetcher never reaches the TradingView code and never names its files', () => {
        const graph = importGraph(join(REPO, 'scripts', 'options-data.ts'));
        expect(graph).toContain('scripts/options-data.ts');
        expect(graph.filter((f) => f.startsWith('scripts/tv/'))).toEqual([]);
        graph.forEach((f) => expect(TV_WORDS.test(read(join(REPO, f)))).toBe(false));
    });

    test('the app (src) never imports the TradingView scripts', () => {
        const offenders = filesUnder(join(REPO, 'src'), /\.tsx?$/).filter((f) => /from\s+['"][^'"]*scripts\/tv|from\s+['"][^'"]*\/tv\//.test(read(f)));
        expect(offenders.map((f) => relative(REPO, f))).toEqual([]);
    });

    test('no workflow runs, names or force-adds anything of it', () => {
        const workflows = filesUnder(join(REPO, '.github'), /\.ya?ml$/);
        expect(workflows.length).toBeGreaterThan(0);
        workflows.forEach((f) => {
            const text = read(f);
            expect({ file: relative(REPO, f), tv: TV_WORDS.test(text) }).toEqual({ file: relative(REPO, f), tv: false });
            // the data commits use `git add api/`: the ignore below only holds without -f / --force
            const forced = text.split('\n').filter((l) => /git add\b/.test(l) && /\s(-f|--force)\b/.test(l));
            expect(forced).toEqual([]);
        });
    });

    test('the futures files are gitignored, in api/ and in dist/', () => {
        const res = Bun.spawnSync(['git', 'check-ignore', '--no-index', 'api/futures/ES.json', 'api/futures/M2K.json', 'dist/api/futures/ES.json'], { cwd: REPO });
        expect(res.stdout.toString().trim().split('\n')).toEqual(['api/futures/ES.json', 'api/futures/M2K.json', 'dist/api/futures/ES.json']);
        // the fetcher's own folder stays tracked
        expect(Bun.spawnSync(['git', 'check-ignore', '--no-index', '-q', 'api/options/ES.json'], { cwd: REPO }).exitCode).toBe(1);
    });

    test('only the tv:* package scripts run it, none of the build, start or test scripts', () => {
        const scripts = (JSON.parse(read(join(REPO, 'package.json'))) as { scripts: Record<string, string> }).scripts;
        expect(scripts['tv:session']).toBe('bun scripts/tv/session.ts');
        expect(scripts['tv:check']).toBe('bun scripts/tv/check.ts');
        expect(scripts['tv:futures']).toBe('bun scripts/tv/futures.ts');
        const others = Object.keys(scripts).filter((k) => !k.startsWith('tv:') && TV_WORDS.test(scripts[k]));
        expect(others).toEqual([]);
    });

    test('the fixtures and the code hold no secret: no cookie, no JWT, no auth token value', () => {
        const files = filesUnder(TV_DIR, /\.(ts|json|txt)$/).filter((f) => !f.endsWith('local-only.test.ts'));
        expect(files.some((f) => f.includes('fixtures'))).toBe(true);
        files.forEach((f) => {
            const text = read(f);
            expect({ f, cookie: /sessionid=[a-z0-9]{8,}/i.test(text), jwt: /eyJ[\w-]{10,}\.eyJ[\w-]{10,}/.test(text), token: /"auth_token":"eyJ/.test(text) })
                .toEqual({ f, cookie: false, jwt: false, token: false });
        });
        // on the owner's machine: the real session value appears nowhere in the repo's TradingView files
        if (existsSync(TV_ENV_PATH)) {
            const env = parseEnv(read(TV_ENV_PATH));
            [env.TV_SESSIONID, env.TV_SESSIONID_SIGN].filter((v): v is string => Boolean(v && v.length >= 8))
                .forEach((secret) => files.forEach((f) => expect(read(f).includes(secret)).toBe(false)));
        }
    });
});
