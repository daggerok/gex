/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const fetcherTs = readFileSync(join(root, 'scripts/options-data.ts'), 'utf8');
// App source is split into modules under src/ (Phase 0), so scan all of it.
const main = readdirSync(join(root, 'src'), { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .sort()
    .map((f) => readFileSync(join(root, 'src', f), 'utf8'))
    .join('\n');

describe('api/options path layout', () => {
  test('fetcher writes under api/options', () => {
    expect(fetcherTs).toContain('"api", "options"');
    expect(fetcherTs).toContain('api/options/index.json');
    expect(fetcherTs).toContain('cdn.cboe.com');
  });

  test('UI static cache reads api/options/*', () => {
    expect(main).toContain("fetchStaticJson('api/options/index.json'");
    expect(main).toContain('api/options/${encodeURIComponent(raw)}.json');
    expect(main).not.toContain("fetchStaticJson('data/");
  });
});

describe('the daily archive is part of the site', () => {
  test('the build copies all of api to dist, so api/history/*.zip and index.json are deployed', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.ncp).toBe('ncp api dist/api');
  });
});
