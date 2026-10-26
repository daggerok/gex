/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import {
    age,
    buildRows,
    type EngineStatus,
    engineWords,
    findWatchers,
    formatReport,
    newestCmeFile,
    parseEngineStatus,
    parseLsofCwd,
    parsePm2List,
    parsePorcelain,
    parsePs,
    pm2DaemonRuns,
    type Probe,
    shortCommand,
    subscribedText,
    summary,
} from './status';

const TZ = 'America/New_York';
// Mon 2026-10-26 14:30 New York
const NOW = Date.parse('2026-10-26T14:30:00-04:00');

const engine = (o: Partial<EngineStatus> = {}): EngineStatus => ({
    engine: true, state: 'live', message: 'streaming ES', until: null, since: NOW - 5 * 60_000, progress: null, subscribed: null, roots: ['ES', 'NQ'], tokenValidUntil: NOW + 4 * 3600_000, ...o,
});

/** Everything running, live. */
function probe(o: Partial<Probe> = {}): Probe {
    return {
        at: NOW,
        app: { port: 1234, url: 'http://localhost:1234', holders: [{ pid: 11, command: 'node parcel --port 1234' }], answers: true },
        proxy: { port: 8787, url: 'http://localhost:8787', holders: [{ pid: 12, command: 'bun ./scripts/options-local-proxy.ts' }], health: true, checkout: '/x/gex' },
        engine: engine(),
        cme: { file: 'daily_volume_20261023.xlsx', day: '2026-10-23', modified: NOW - 3600_000 },
        watchers: [],
        session: { path: '/home/u/.config/gex/tradingview.env', present: true },
        pm2: { daemon: false, app: null, error: null },
        runner: { installed: true, loaded: true, plist: '/p.plist', next: NOW + 15 * 60_000, last: {}, lock: { state: 'free', pid: null, job: null, since: null } },
        futures: { dir: '/x/gex/api/futures', files: [{ root: 'ES', modified: NOW, updated: '2026-10-26T14:29:00-04:00', git: 'modified' }], gitKnown: true },
        ...o,
    };
}

const off = (): Partial<Probe> => ({
    app: { port: 1234, url: 'http://localhost:1234', holders: [], answers: false },
    proxy: { port: 8787, url: 'http://localhost:8787', holders: [], health: false, checkout: null },
    engine: null,
});

describe('status: parsing', () => {
    test('ps lines, tv:futures watchers, the pm2 daemon', () => {
        const procs = parsePs('  101 bun scripts/tv/futures.ts --watch 2m\n  102 /bin/zsh -c bun scripts/tv/futures.ts\n 103 PM2 v7.0.1: God Daemon (/Users/u/.pm2)\n\n 104 bun ./scripts/options-local-proxy.ts\n');
        expect(procs).toHaveLength(4);
        expect(findWatchers(procs).map((p) => p.pid)).toEqual([101]);
        expect(pm2DaemonRuns(procs)).toBe(true);
        expect(pm2DaemonRuns(procs.filter((p) => p.pid !== 103))).toBe(false);
    });

    test('lsof cwd', () => {
        expect(parseLsofCwd('p123\nfcwd\nn/Users/u/gex\n')).toBe('/Users/u/gex');
        expect(parseLsofCwd('')).toBeNull();
    });

    test('pm2 jlist: skips the version warning, keeps only the plain fields (never the env)', () => {
        const json = JSON.stringify([{ name: 'other', pid: 1, pm2_env: { status: 'online' } }, { name: 'app', pid: 4242, pm2_env: { status: 'online', restart_time: 2, pm_uptime: NOW, SECRET: 'x' } }]);
        const r = parsePm2List(`>>>> In-memory PM2 is out-of-date, do:\n>>>> $ pm2 update\n\n${json}`, 'app');
        expect(r).toEqual({ app: { status: 'online', pid: 4242, restarts: 2, since: NOW }, error: null });
        expect(JSON.stringify(r)).not.toContain('SECRET');
        expect(parsePm2List('[]', 'app')).toEqual({ app: null, error: null });
        expect(parsePm2List('nothing', 'app').error).toContain('no list');
        expect(parsePm2List('[{oops', 'app').error).toContain('no valid JSON');
        expect(parsePm2List(JSON.stringify([{ name: 'app', pid: 0, pm2_env: { status: 'stopped' } }]), 'app').app).toEqual({ status: 'stopped', pid: null, restarts: 0, since: null });
    });

    test('git porcelain', () => {
        const m = parsePorcelain(' M api/futures/ES.json\n?? api/futures/MES.json\n');
        expect(m.get('ES.json')).toBe('modified');
        expect(m.get('MES.json')).toBe('untracked');
        expect(m.size).toBe(2);
        expect(parsePorcelain('').size).toBe(0);
    });

    test('engine status keeps only the known fields', () => {
        const e = parseEngineStatus({ engine: true, state: 'starting', message: 'm', until: null, since: 5, progress: 'ES 1/4', subscribed: { ES: [3200, 5560], bad: 'x' }, roots: ['ES', 3], tokenValidUntil: 9, token: 'eyJhbGciOi.secret.value' });
        expect(e).toEqual({ engine: true, state: 'starting', message: 'm', until: null, since: 5, progress: 'ES 1/4', subscribed: { ES: [3200, 5560] }, roots: ['ES'], tokenValidUntil: 9 });
        expect(JSON.stringify(e)).not.toContain('secret');
        expect(parseEngineStatus({ engine: false, state: 'off', message: 'TradingView live mode off (GEX_TV=0)' })?.engine).toBe(false);
        expect(parseEngineStatus(null)).toBeNull();
        expect(parseEngineStatus({ ok: true })).toBeNull();
    });

    test('newest CME file', () => {
        expect(newestCmeFile(['daily_volume_20261022.xlsx', 'x.tmp', 'daily_volume_20261023.xlsx'])).toEqual({ file: 'daily_volume_20261023.xlsx', day: '2026-10-23' });
        expect(newestCmeFile([])).toBeNull();
    });
});

describe('status: words', () => {
    test('age and commands', () => {
        expect(age(10_000)).toBe('<1 min');
        expect(age(12 * 60_000)).toBe('12 min');
        expect(age(185 * 60_000)).toBe('3 h 5 min');
        expect(age(120 * 60_000)).toBe('2 h');
        expect(age(52 * 3600_000)).toBe('2 d 4 h');
        expect(shortCommand('short')).toBe('short');
        const long = shortCommand(`node /very/long/path/${'x'.repeat(100)}/parcel --port 1234`);
        expect(long.length).toBe(72);
        expect(long.startsWith('node /very')).toBe(true);
        expect(long.endsWith('parcel --port 1234')).toBe(true);
    });

    test('engine states', () => {
        expect(engineWords(engine(), NOW, TZ)).toEqual({ level: 'ok', state: 'live' });
        expect(subscribedText({ ES: [3200, 5560], NQ: [0, 4894] })).toBe('ES 3,200/5,560, NQ 0/4,894');
        expect(engineWords(engine({ state: 'starting', progress: 'ES 1/4', subscribed: { ES: [3200, 5560] } }), NOW, TZ).state).toBe('starting (reading ES 1/4, ES 3,200/5,560)');
        const login = engineWords(engine({ state: 'expired' }), NOW, TZ);
        expect(login.level).toBe('off');
        expect(login.state).toContain('login needed');
        expect(login.fix).toContain('bun run tv:session');
        expect(engineWords(engine({ state: 'rate-limited', until: NOW + 10 * 60_000 }), NOW, TZ).state).toBe('rate limited by TradingView, retries at 14:40');
        expect(engineWords(engine({ engine: false, state: 'off' }), NOW, TZ).fix).toContain('GEX_TV=0');
        expect(engineWords(engine({ state: 'error', message: 'boom' }), NOW, TZ).state).toBe('error: boom');
    });

    test('summary line', () => {
        expect(summary(probe(), TZ)).toEqual({ level: 'ok', text: 'Everything for live data is running', live: true });
        expect(summary(probe(off()), TZ).text).toBe('Live data is off: run bun run all');
        expect(summary(probe({ ...off(), app: probe().app }), TZ).text).toBe('Live data is off: run bun run proxy');
        expect(summary(probe({ engine: engine({ state: 'no-session' }) }), TZ).text).toContain('log in to tradingview.com in Chrome');
        expect(summary(probe({ engine: engine({ state: 'starting', progress: 'ES 1/4' }) }), TZ)).toMatchObject({ level: 'warn', live: false });
        expect(summary(probe({ app: off().app }), TZ).text).toContain('the app is off: run bun run app');
        const taken = probe({ proxy: { ...probe().proxy, health: false } });
        expect(summary(taken, TZ).text).toContain('port 8787 is taken');
    });
});

describe('status: the screen', () => {
    test('everything live: no fix lines except the ones that apply, the token time but never a token', () => {
        const rows = buildRows(probe(), TZ);
        const tv = rows.find((r) => r.label === 'TradingView live')!;
        expect(tv.level).toBe('ok');
        expect(tv.details).toContain('token valid until 18:30');
        expect(tv.details).toContain('since 14:25 (5 min)');
        const fut = rows.find((r) => r.label === 'Futures files')!;
        expect(fut.details[0]).toBe('ES   data of 14:29 (1 min old), modified: differs from git');
        expect(fut.details).toContain('a commit would publish ES');
        expect(rows.filter((r) => r.fix)).toEqual([]);
    });

    test('everything off: each part names the command that starts it', () => {
        const rows = buildRows(probe({ ...off(), session: { path: '/s.env', present: false }, runner: { ...probe().runner, installed: false, loaded: false } }), TZ);
        const fix = (label: string) => rows.find((r) => r.label === label)?.fix;
        expect(fix('App')).toContain('bun run all');
        expect(fix('Local proxy')).toBe('bun run proxy');
        expect(fix('TradingView live')).toBe('bun run proxy');
        expect(fix('TradingView session')).toBe('bun run tv:session');
        expect(fix('Data runner')).toBe('bun run data:setup');
        expect(fix('pm2')).toContain('bun run start');
        expect(fix('tv:futures')).toContain('bun run tv:futures');
    });

    test('a tv:futures watcher next to the live proxy is a warning; a paused schedule says data:resume', () => {
        const rows = buildRows(probe({ watchers: [{ pid: 7, command: 'bun scripts/tv/futures.ts' }], runner: { ...probe().runner, loaded: false } }), TZ);
        expect(rows.find((r) => r.label === 'tv:futures')?.level).toBe('warn');
        expect(rows.find((r) => r.label === 'Data runner')?.fix).toBe('bun run data:resume');
    });

    test('pm2 app stopped -> restart', () => {
        const rows = buildRows(probe({ pm2: { daemon: true, app: { status: 'errored', pid: null, restarts: 15, since: null }, error: null } }), TZ);
        const pm2 = rows.find((r) => r.label === 'pm2')!;
        expect(pm2).toMatchObject({ level: 'warn', state: "process 'app' errored", fix: 'bun run restart (bun run logs shows why)' });
    });

    test('plain text: markers, aligned columns, no colour codes; colour only when asked', () => {
        const p = probe(off());
        const plain = formatReport(buildRows(p, TZ), summary(p, TZ), { color: false, title: 'gex status' });
        expect(plain).not.toContain('\x1b[');
        const lines = plain.split('\n');
        expect(lines).toContain('[off]  App                  not running');
        expect(lines).toContain('                            -> bun run proxy');
        expect(lines[lines.length - 1]).toBe('[off]  Live data is off: run bun run all');
        // every state starts in the same column
        const rowLines = lines.filter((l) => /^\[(ok|off|warn|--)\]/.test(l) && !l.includes('Live data'));
        expect(rowLines.length).toBe(9);
        for (const l of rowLines) expect([l[27], l[28] !== ' ']).toEqual([' ', true]);
        const colored = formatReport(buildRows(p, TZ), summary(p, TZ), { color: true, title: 'gex status' });
        expect(colored).toContain('\x1b[31m●');
        expect(colored).not.toContain('[off]');
    });
});
