/// <reference types="bun" />
/// <reference types="node" />

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPlist,
  defaultRunnerPath,
  defaultStateDir,
  legacyPaths,
  migrateLegacy,
  migrationPlan,
  HELP,
  lockDecision,
  nextNyInstant,
  nextRun,
  NY_TZ,
  nySlotToLocal,
  partialSlotsNy,
  partialWindow,
  planJob,
  resolvePaths,
  tzOffsetMinutes,
  zonedInstant,
} from './data-local';

describe('slots', () => {
  test('partial: the old hourly GitHub slots, Mon-Fri 8:45 .. 16:45 and 17:15, 18:15, 19:15 New York time', () => {
    const slots = partialSlotsNy();
    expect(slots.length).toBe(60);
    const monday = slots.filter((s) => s.weekday === 1).map((s) => `${s.hour}:${s.minute}`);
    expect(monday).toEqual(['8:45', '9:45', '10:45', '11:45', '12:45', '13:45', '14:45', '15:45', '16:45', '17:15', '18:15', '19:15']);
    expect(slots.some((s) => s.weekday === 0 || s.weekday === 6)).toBe(false);
  });

  test('New York offsets in summer and winter, wall clock to instant across the DST switch', () => {
    expect(tzOffsetMinutes(new Date('2026-07-01T12:00:00Z'), NY_TZ)).toBe(-240);
    expect(tzOffsetMinutes(new Date('2026-12-01T12:00:00Z'), NY_TZ)).toBe(-300);
    expect(zonedInstant(2026, 7, 1, 9, 45, NY_TZ).toISOString()).toBe('2026-07-01T13:45:00.000Z');
    expect(zonedInstant(2026, 12, 1, 9, 45, NY_TZ).toISOString()).toBe('2026-12-01T14:45:00.000Z');
    // Sunday 2026-11-01 is the switch back to EST: Monday 9:45 is 14:45 UTC
    expect(zonedInstant(2026, 11, 2, 9, 45, NY_TZ).toISOString()).toBe('2026-11-02T14:45:00.000Z');
  });

  test('a Mac on New York time keeps the slots as they are (the owner, EDT)', () => {
    const s = { weekday: 1, hour: 9, minute: 45 };
    expect(nySlotToLocal(s, NY_TZ, new Date('2026-10-26T12:00:00Z'))).toEqual(s);
  });

  test('another zone gets the converted wall clock, the weekday may change', () => {
    const ref = new Date('2026-10-26T12:00:00Z');
    // Berlin is on CET (UTC+1) from 2026-10-25, New York on EDT (UTC-4) until 11-01: 9:45 NY = 14:45 Berlin
    expect(nySlotToLocal({ weekday: 1, hour: 9, minute: 45 }, 'Europe/Berlin', ref)).toEqual({ weekday: 1, hour: 14, minute: 45 });
    // 19:15 NY on a Friday = 00:15 Saturday in Berlin
    expect(nySlotToLocal({ weekday: 5, hour: 19, minute: 15 }, 'Europe/Berlin', ref)).toEqual({ weekday: 6, hour: 0, minute: 15 });
    // Los Angeles is 3 hours behind all year: 8:45 NY = 5:45 LA
    expect(nySlotToLocal({ weekday: 3, hour: 8, minute: 45 }, 'America/Los_Angeles', ref)).toEqual({ weekday: 3, hour: 5, minute: 45 });
  });

  test('next run: the first slot strictly after now, Friday evening rolls over to Monday 8:45', () => {
    // Monday 2026-10-26 10:00 EDT = 14:00Z -> 10:45 EDT
    expect(nextRun(partialSlotsNy(), new Date('2026-10-26T14:00:00Z'))?.toISOString()).toBe('2026-10-26T14:45:00.000Z');
    // exactly on a slot -> the next one
    expect(nextNyInstant({ weekday: 1, hour: 10, minute: 45 }, new Date('2026-10-26T14:45:00Z')).toISOString()).toBe('2026-11-02T15:45:00.000Z');
    // Friday 2026-10-30 20:00 EDT -> Monday 2026-11-02 8:45 EST = 13:45Z
    expect(nextRun(partialSlotsNy(), new Date('2026-10-31T00:00:00Z'))?.toISOString()).toBe('2026-11-02T13:45:00.000Z');
  });
});

describe('partial window (the workflow guard)', () => {
  test('scheduled: weekdays from 8:40, final from 16:30; weekends and early runs skip; manual always runs', () => {
    expect(partialWindow({ weekday: 1, hour: 8, minute: 39 }, true).run).toBe(false);
    expect(partialWindow({ weekday: 1, hour: 8, minute: 45 }, true)).toEqual({ run: true, final: false, why: 'inside the market window' });
    expect(partialWindow({ weekday: 5, hour: 16, minute: 30 }, true).final).toBe(true);
    expect(partialWindow({ weekday: 5, hour: 23, minute: 59 }, true)).toEqual({ run: true, final: true, why: 'inside the market window' });
    expect(partialWindow({ weekday: 6, hour: 0, minute: 15 }, true).run).toBe(false); // a slot launchd catches up after wake on Saturday
    expect(partialWindow({ weekday: 0, hour: 12, minute: 0 }, false)).toEqual({ run: true, final: false, why: 'manual run' });
  });
});

describe('plist', () => {
  const plist = buildPlist({
    label: 'com.daggerok.gex-data',
    programArguments: ['/Users/me/.bun/bin/bun', '/w/data-runner/scripts/data-local.ts', 'run', 'partial', '--scheduled'],
    workingDirectory: '/w/data-runner',
    env: { PATH: '/usr/bin:/bin', GEX_DATA_LOG: '/ws/gex-data-state/gex-data.log' },
    slots: [{ weekday: 1, hour: 8, minute: 45 }, { weekday: 5, hour: 19, minute: 15 }],
    logPath: '/ws/gex-data-state/gex-data.log',
  });

  test('has the label, the program, one calendar dict per slot, the log for both streams and no RunAtLoad', () => {
    expect(plist).toContain('<key>Label</key>\n  <string>com.daggerok.gex-data</string>');
    expect(plist).toContain('    <string>--scheduled</string>');
    expect(plist).toContain('<dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>45</integer></dict>');
    expect(plist).toContain('<dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>19</integer><key>Minute</key><integer>15</integer></dict>');
    expect(plist.match(/gex-data\.log<\/string>/g)?.length).toBe(3); // env + StandardOutPath + StandardErrorPath
    expect(plist).toContain('<key>RunAtLoad</key>\n  <false/>');
    expect(plist.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  test('escapes XML in paths', () => {
    const p = buildPlist({ label: 'x', programArguments: ['/a & b/<c>'], workingDirectory: '/', env: {}, slots: [], logPath: '/l' });
    expect(p).toContain('<string>/a &amp; b/&lt;c&gt;</string>');
  });
});

describe('lock', () => {
  test('no lock: take it; a dead pid or garbage: stale (removed by the next run); a live pid: held', () => {
    expect(lockDecision(null, () => true).action).toBe('take');
    expect(lockDecision('not json', () => true).action).toBe('stale');
    const text = JSON.stringify({ pid: 42, job: 'partial', started: '2026-10-26T13:45:00Z' });
    expect(lockDecision(text, () => false).action).toBe('stale');
    expect(lockDecision(text, (pid) => pid === 42)).toEqual({ action: 'held', info: { pid: 42, job: 'partial', started: '2026-10-26T13:45:00Z' } });
  });
});

describe('jobs mirror their workflows', () => {
  const base = { dryRun: false, tickers: [] as string[], allTxt: 'AAPL\nMSFT\n\nNVDA\n', env: {} };

  test('partial: the hourly env, the archive and latest.json committed only on a final run, a Pages deploy every run', () => {
    const intraday = planJob('partial', { ...base, final: false });
    expect(intraday.env).toEqual({ MAX_EXPIRATIONS: '15', KEEP_EXPIRATIONS: '1', CONCURRENCY: '4', REQUEST_SLEEP: '0.1', HISTORY: '0', HISTORY_KEEP_DAYS: '14', HISTORY_KEEP_BACKUP_DAYS: '14' });
    expect(intraday.commit).toEqual([]);
    expect(intraday.deploy).toBe('always');
    const final = planJob('partial', { ...base, final: true, env: { HISTORY_KEEP_DAYS: '30' } });
    expect(final.env.HISTORY).toBe('1');
    expect(final.env.HISTORY_KEEP_DAYS).toBe('30');
    expect(final.commit).toEqual(['api/history', 'api/latest.json']);
    expect(final.message).toBe('chore(data): archive the trading day [skip ci]');
  });

  test('weekly: api/All.txt + ROTATE_STALE=500, all of api/ committed, deploy only after a push', () => {
    const w = planJob('weekly', { ...base, final: false });
    expect(w.env).toEqual({ TICKERS: 'AAPL MSFT NVDA', ROTATE_STALE: '500', MAX_FETCHES: '500', MAX_EXPIRATIONS: '50', REQUEST_SLEEP: '0.5' });
    expect(w.commit).toEqual(['api']);
    expect(w.deploy).toBe('pushed');
  });

  test('dry run: the fetcher gets DRY_RUN=1, the backup only prints what it would do', () => {
    expect(planJob('partial', { ...base, final: true, dryRun: true }).env.DRY_RUN).toBe('1');
    expect(planJob('weekly', { ...base, final: false, dryRun: true }).env.DRY_RUN).toBe('1');
    expect(planJob('backup', { ...base, final: false, dryRun: true, tickers: ['SPY'] }).command[0]).toBe('echo');
    expect(planJob('backup', { ...base, final: false, tickers: ['SPY', 'NDX'] }).command).toEqual(['bun', 'scripts/backtest-backup.ts', 'SPY', 'NDX']);
    expect(planJob('deps', { ...base, final: false }).commit).toEqual([]);
  });
});

describe('paths and help', () => {
  test('the runner sits next to the checkout under .worktrees/<repo>/data-runner; env overrides every path', () => {
    expect(defaultRunnerPath('/ws/gex')).toBe('/ws/.worktrees/gex/data-runner');
    const p = resolvePaths({ GEX_DATA_HOME: '/h', GEX_DATA_PLIST: '/p.plist', GEX_DATA_LOG: '/l.log', GEX_DATA_RUNNER: '/r' }, '/ws/gex');
    expect(p).toMatchObject({ home: '/h', lock: '/h/run.lock', state: '/h/state.json', plist: '/p.plist', log: '/l.log', runner: '/r', label: 'com.daggerok.gex-data' });
    expect(resolvePaths({}, '/ws/gex').plist).toMatch(/Library\/LaunchAgents\/com\.daggerok\.gex-data\.plist$/);
  });

  test('log, state and lock default to gex-data-state next to the main checkout (../gex-data-state from gex)', () => {
    expect(defaultStateDir('/ws/gex')).toBe('/ws/gex-data-state');
    const p = resolvePaths({}, '/ws/gex');
    expect(p).toMatchObject({ home: '/ws/gex-data-state', log: '/ws/gex-data-state/gex-data.log', state: '/ws/gex-data-state/state.json', lock: '/ws/gex-data-state/run.lock' });
    // GEX_DATA_HOME alone moves the log with it; GEX_DATA_LOG still overrides the log alone
    expect(resolvePaths({ GEX_DATA_HOME: '/h' }, '/ws/gex').log).toBe('/h/gex-data.log');
    expect(resolvePaths({ GEX_DATA_HOME: '/h', GEX_DATA_LOG: '/x/y.log' }, '/ws/gex')).toMatchObject({ home: '/h', log: '/x/y.log' });
  });

  test('help lists every package.json data:* command', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const cmds = Object.keys(pkg.scripts).filter((k) => k.startsWith('data:'));
    expect(cmds.length).toBe(8);
    for (const c of cmds) expect(HELP).toContain(`bun run ${c}`);
  });
});

describe('migration from ~/Library (first version)', () => {
  const legacy = legacyPaths('/Users/me');
  const p = resolvePaths({}, '/ws/gex');

  test('the old paths are the ones PR #240 used', () => {
    expect(legacy).toEqual({
      dir: '/Users/me/Library/Application Support/gex-data',
      log: '/Users/me/Library/Logs/gex-data.log',
      state: '/Users/me/Library/Application Support/gex-data/state.json',
      lock: '/Users/me/Library/Application Support/gex-data/run.lock',
    });
  });

  test('moves the old log and state when the new place has none; never the lock', () => {
    const plan = migrationPlan(p, legacy, (f) => f.startsWith('/Users/me/'));
    expect(plan.moves).toEqual([
      { from: legacy.log, to: '/ws/gex-data-state/gex-data.log' },
      { from: legacy.state, to: '/ws/gex-data-state/state.json' },
    ]);
    expect(plan.kept).toEqual([]);
  });

  test('nothing old -> nothing to do; a file already at the new place wins and the old one is kept', () => {
    expect(migrationPlan(p, legacy, () => false)).toEqual({ moves: [], kept: [] });
    const plan = migrationPlan(p, legacy, (f) => f === legacy.state || f === p.state || f === legacy.log);
    expect(plan.moves).toEqual([{ from: legacy.log, to: p.log }]);
    expect(plan.kept).toEqual([{ from: legacy.state, to: p.state }]);
  });

  test('env overrides that point at the old paths mean no move', () => {
    const same = resolvePaths({ GEX_DATA_HOME: legacy.dir, GEX_DATA_LOG: legacy.log }, '/ws/gex');
    expect(migrationPlan(same, legacy, () => true).moves).toEqual([]);
  });

  test('migrateLegacy moves the files on disk, drops a stale old lock and the empty old folder', () => {
    const root = join(__dirname, '..', '.temp', 'data-local-migrate');
    rmSync(root, { recursive: true, force: true });
    const old = legacyPaths(join(root, 'home'));
    mkdirSync(old.dir, { recursive: true });
    mkdirSync(join(root, 'home', 'Library', 'Logs'), { recursive: true });
    writeFileSync(old.log, 'old log\n');
    writeFileSync(old.state, '{"partial":{}}\n');
    writeFileSync(old.lock, JSON.stringify({ pid: 2 ** 22 + 12345, job: 'partial', started: 'x' })); // no such pid
    const np = resolvePaths({}, join(root, 'ws', 'gex'));
    const lines: string[] = [];
    expect(migrateLegacy(np, old, (l) => lines.push(l))).toBe(true);
    expect(readFileSync(np.log, 'utf8')).toBe('old log\n');
    expect(readFileSync(np.state, 'utf8')).toBe('{"partial":{}}\n');
    expect(existsSync(old.log) || existsSync(old.state) || existsSync(old.lock) || existsSync(old.dir)).toBe(false);
    expect(lines.length).toBe(2);
    // a second run finds nothing to move
    expect(migrateLegacy(np, old, (l) => lines.push(l))).toBe(true);
    expect(lines.length).toBe(2);
    rmSync(root, { recursive: true, force: true });
  });

  test('migrateLegacy refuses while a live process holds the old lock', () => {
    const root = join(__dirname, '..', '.temp', 'data-local-migrate-held');
    rmSync(root, { recursive: true, force: true });
    const old = legacyPaths(join(root, 'home'));
    mkdirSync(old.dir, { recursive: true });
    writeFileSync(old.state, '{}');
    writeFileSync(old.lock, JSON.stringify({ pid: process.pid, job: 'partial', started: 'x' }));
    const np = resolvePaths({}, join(root, 'ws', 'gex'));
    expect(migrateLegacy(np, old, () => {})).toBe(false);
    expect(existsSync(old.state)).toBe(true);
    expect(existsSync(np.state)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
