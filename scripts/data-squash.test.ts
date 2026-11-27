/// <reference types="bun" />
/// <reference types="node" />

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDataSubject, isOn, parseSquashAfter, scanDepth, squashDecision, squashMessage, squashTip, tipRun } from './data-squash';

describe('rules', () => {
  test('a data commit is one whose subject starts with chore(data):', () => {
    expect(isDataSubject('chore(data): archive the trading day [skip ci]')).toBe(true);
    expect(isDataSubject('chore(data): refresh option chains [skip ci]')).toBe(true);
    expect(isDataSubject('chore(deps): bump parcel')).toBe(false);
    expect(isDataSubject('feat(gex): chore(data): in the middle')).toBe(false);
  });

  test('tipRun counts data commits from the tip down to the first other commit', () => {
    expect(tipRun([])).toBe(0);
    expect(tipRun(['feat: x', 'chore(data): a'])).toBe(0);
    expect(tipRun(['chore(data): a', 'chore(data): b', 'fix: y', 'chore(data): c'])).toBe(2);
    expect(tipRun(['chore(data): a', 'chore(data): b'])).toBe(2);
  });

  test('squash at the limit, or on a final run with 2 or more; never with SQUASH_AFTER=0', () => {
    expect(squashDecision({ run: 9, after: 10, final: false }).squash).toBe(false);
    expect(squashDecision({ run: 10, after: 10, final: false }).squash).toBe(true);
    expect(squashDecision({ run: 75, after: 10, final: false }).squash).toBe(true);
    expect(squashDecision({ run: 2, after: 60, final: true }).squash).toBe(true);
    expect(squashDecision({ run: 1, after: 60, final: true }).squash).toBe(false);
    expect(squashDecision({ run: 1, after: 1, final: false }).squash).toBe(false);
    expect(squashDecision({ run: 500, after: 0, final: true }).squash).toBe(false);
  });

  test('SQUASH_AFTER: blank is 10, 0 is off, anything else must be a whole number', () => {
    expect(parseSquashAfter(undefined)).toBe(10);
    expect(parseSquashAfter('  ')).toBe(10);
    expect(parseSquashAfter('0')).toBe(0);
    expect(parseSquashAfter(' 25 ')).toBe(25);
    expect(() => parseSquashAfter('-1')).toThrow('SQUASH_AFTER');
    expect(() => parseSquashAfter('many')).toThrow('SQUASH_AFTER');
    expect(() => parseSquashAfter('1.5')).toThrow('SQUASH_AFTER');
  });

  test('flags, message and scan depth', () => {
    expect(isOn('true')).toBe(true);
    expect(isOn('1')).toBe(true);
    expect(isOn('false')).toBe(false);
    expect(isOn(undefined)).toBe(false);
    expect(squashMessage(60)).toBe('chore(data): squash 60 data commits [skip ci]');
    expect(isDataSubject(squashMessage(3))).toBe(true);
    expect(scanDepth(60)).toBe(200);
    expect(scanDepth(100)).toBe(300);
  });
});

// ---- the real thing against a local remote: a shallow clone like the one CI has ----------------------------------------

const root = mkdtempSync(join(tmpdir(), 'gex-squash-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(cwd: string, file: string, text: string, subject: string): void {
  mkdirSync(join(cwd, 'api'), { recursive: true });
  writeFileSync(join(cwd, file), text);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', subject);
}

/** A bare remote with `subjects` (oldest first) on main, and a shallow clone of it (depth 2, as actions/checkout makes). */
function scene(name: string, subjects: string[]): { remote: string; seed: string; clone: string } {
  const remote = join(root, `${name}-remote.git`);
  const seed = join(root, `${name}-seed`);
  const clone = join(root, `${name}-clone`);
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(remote, 'config', 'uploadpack.allowFilter', 'true');
  git(remote, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  git(root, 'init', '-q', '-b', 'main', seed);
  git(seed, 'remote', 'add', 'origin', remote);
  subjects.forEach((s, i) => commit(seed, isDataSubject(s) ? 'api/data.json' : `code-${i}.ts`, `${i}`, s));
  git(seed, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', '--depth=2', `file://${remote}`, clone);
  return { remote, seed, clone };
}

const run = (clone: string, after: number, final = false, dryRun = false) => {
  const prev = { ...process.env };
  Object.assign(process.env, GIT_ENV);
  try {
    return squashTip({ cwd: clone, after, final, branch: 'main', remote: 'origin', dryRun, log: () => {} });
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
  }
};

const subjectsOf = (repo: string) => git(repo, 'log', '--format=%s', 'main').split('\n');

describe('squashTip on a shallow clone', () => {
  test('folds the data commits at the tip into one, the code commit below keeps its hash and the tree stays the same', () => {
    const s = scene('limit', ['feat: code', 'chore(data): old [skip ci]', 'fix: code 2', 'chore(data): 1', 'chore(data): 2', 'chore(data): 3', 'chore(data): 4']);
    const treeBefore = git(s.remote, 'rev-parse', 'main^{tree}');
    const codeBefore = git(s.remote, 'rev-parse', 'main~4');
    const r = run(s.clone, 3);
    expect(r.squashed).toBe(true);
    expect(r.count).toBe(4);
    expect(subjectsOf(s.remote)).toEqual(['chore(data): squash 4 data commits [skip ci]', 'fix: code 2', 'chore(data): old [skip ci]', 'feat: code']);
    expect(git(s.remote, 'rev-parse', 'main^{tree}')).toBe(treeBefore);
    expect(git(s.remote, 'rev-parse', 'main~1')).toBe(codeBefore);
    // the clone follows: HEAD is the new tip and the working tree is clean
    expect(git(s.clone, 'rev-parse', 'HEAD')).toBe(git(s.remote, 'rev-parse', 'main'));
    expect(git(s.clone, 'status', '--porcelain')).toBe('');
  });

  test('below the limit nothing is pushed, a final run squashes anyway, a dry run never pushes', () => {
    const s = scene('final', ['feat: code', 'chore(data): 1', 'chore(data): 2']);
    const tip = git(s.remote, 'rev-parse', 'main');
    expect(run(s.clone, 60).squashed).toBe(false);
    expect(run(s.clone, 60, true, true).squashed).toBe(false);
    expect(git(s.remote, 'rev-parse', 'main')).toBe(tip);
    const r = run(s.clone, 60, true);
    expect(r.squashed).toBe(true);
    expect(subjectsOf(s.remote)).toEqual(['chore(data): squash 2 data commits [skip ci]', 'feat: code']);
  });

  test('a branch of data commits only keeps its oldest commit as the base', () => {
    const s = scene('only-data', ['chore(data): 1', 'chore(data): 2', 'chore(data): 3']);
    const r = run(s.clone, 2);
    expect(r.squashed).toBe(true);
    expect(subjectsOf(s.remote)).toEqual(['chore(data): squash 2 data commits [skip ci]', 'chore(data): 1']);
  });

  test('when main moved after the checkout nothing is rewritten', () => {
    const s = scene('moved', ['feat: code', 'chore(data): 1', 'chore(data): 2', 'chore(data): 3']);
    commit(s.seed, 'merged.ts', 'x', 'feat: merged meanwhile');
    git(s.seed, 'push', '-q', 'origin', 'main');
    const tip = git(s.remote, 'rev-parse', 'main');
    const r = run(s.clone, 2);
    expect(r.squashed).toBe(false);
    expect(r.why).toContain('moved');
    expect(git(s.remote, 'rev-parse', 'main')).toBe(tip);
  });

  test('SQUASH_AFTER=0 does not even fetch', () => {
    const r = squashTip({ cwd: join(root, 'no-such-repo'), after: 0, final: true, branch: 'main', remote: 'origin', dryRun: false, log: () => {} });
    expect(r.squashed).toBe(false);
    expect(r.why).toContain('off');
  });
});
