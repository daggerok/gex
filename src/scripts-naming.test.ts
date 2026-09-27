import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const agent = readFileSync(join(root, 'AGENT.md'), 'utf8');
const main = readFileSync(join(root, 'src/main.tsx'), 'utf8');

describe('domain script names (PR1)', () => {
  test('fetcher and local proxy use domain-specific filenames', () => {
    expect(existsSync(join(root, 'scripts/options-data.py'))).toBe(true);
    expect(existsSync(join(root, 'scripts/options-local-proxy.ts'))).toBe(true);
    expect(existsSync(join(root, 'scripts/fetch_data.py'))).toBe(false);
    expect(existsSync(join(root, 'scripts/yahoo-proxy.ts'))).toBe(false);
  });

  test('package.json proxy script points at options-local-proxy.ts', () => {
    expect(pkg.scripts['all:proxy']).toContain('scripts/options-local-proxy.ts');
    expect(pkg.scripts['all:proxy']).not.toContain('yahoo-proxy.ts');
  });

  test('agent contract documents renamed scripts', () => {
    expect(agent).toContain('scripts/options-data.py');
    expect(agent).toContain('scripts/options-local-proxy.ts');
    expect(agent).not.toContain('scripts/fetch_data.py');
    expect(agent).not.toContain('scripts/yahoo-proxy.ts');
  });

  test('UI strings/comments reference renamed proxy and fetcher', () => {
    expect(main).toContain('scripts/options-local-proxy.ts');
    expect(main).toContain('scripts/options-data.py');
    expect(main).not.toContain('scripts/yahoo-proxy.ts');
    expect(main).not.toContain('scripts/fetch_data.py');
  });

  test('update-data workflow runs renamed fetcher', () => {
    const wf = readFileSync(join(root, '.github/workflows/update-data.yml'), 'utf8');
    expect(wf).toContain('scripts/options-data.py');
    expect(wf).not.toContain('scripts/fetch_data.py');
  });
});
