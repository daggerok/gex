import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const fetcher = readFileSync(join(root, 'scripts/options-data.py'), 'utf8');
// App source is split into modules under src/ (Phase 0), so scan all of it.
const main = readdirSync(join(root, 'src'), { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .sort()
    .map((f) => readFileSync(join(root, 'src', f), 'utf8'))
    .join('\n');

describe('data/options path layout (PR2)', () => {
  test('fetcher writes under data/options', () => {
    expect(fetcher).toContain(', "data", "options")');
    expect(fetcher).toContain('data/options/index.json');
    expect(fetcher).toContain('cdn.cboe.com');
  });

  test('UI static cache reads data/options/*', () => {
    expect(main).toContain("fetchStaticJson('data/options/index.json'");
    expect(main).toContain('data/options/${encodeURIComponent(raw)}.json');
    expect(main).not.toContain("fetchStaticJson('data/index.json'");
  });
});
