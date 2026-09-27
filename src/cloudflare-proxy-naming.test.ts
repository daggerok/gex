import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

describe('cloudflare proxy name (PR3)', () => {
  test('worker file uses domain-specific name', () => {
    expect(existsSync(join(root, 'scripts/options-cloudflare-proxy.js'))).toBe(true);
    expect(existsSync(join(root, 'scripts/cloudflare-worker.js'))).toBe(false);
  });

  test('agent contract and UI reference renamed worker', () => {
    const agent = readFileSync(join(root, 'AGENT.md'), 'utf8');
    const main = readFileSync(join(root, 'src/main.tsx'), 'utf8');
    expect(agent).toContain('options-cloudflare-proxy.js');
    expect(agent).not.toContain('cloudflare-worker.js');
    expect(main).toContain('options-cloudflare-proxy.js');
    expect(main).not.toContain('cloudflare-worker.js');
  });
});
