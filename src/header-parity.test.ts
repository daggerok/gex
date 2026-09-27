import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const main = readFileSync(join(import.meta.dir, 'main.tsx'), 'utf8');
const ci = readFileSync(join(import.meta.dir, '../.github/workflows/ci.yaml'), 'utf8');
const pkg = JSON.parse(readFileSync(join(import.meta.dir, '../package.json'), 'utf8'));

describe('header parity + CACHE-muted proxies (options-desk)', () => {
  test('uses fundamentals surface tokens on sticky header', () => {
    expect(main).toContain('bg-slate-950/95 text-slate-100');
    expect(main).toContain('bg-white/95 text-slate-900');
    expect(main).toContain('backdrop-blur-md');
    expect(main).toContain('px-4 xl:px-8');
    expect(main).toContain('gap-2 sm:gap-3 py-3');
  });

  test('theme / i18n / settings match fundamentals control chrome', () => {
    // emoji theme toggle (not SVG ThemeSwitch in header)
    expect(main).toContain("dark ? '☀️' : '🌙'");
    // flag pills
    expect(main).toContain("{ k: 'en', l: '🇺🇸' }");
    expect(main).toContain("{ k: 'ru', l: '🇷🇺' }");
    // settings gear emoji
    expect(main).toContain('⚙️');
    // shared Pill segmented control
    expect(main).toContain('const Pill =');
    expect(main).toContain('rounded-lg p-0.5 border');
  });

  test('debug + settings popovers use fundamentals card shell', () => {
    expect(main).toContain('w-[min(92vw,22rem)] z-[60]');
    expect(main).toContain('rounded-xl shadow-xl p-3 space-y-3');
    expect(main).toContain("bg-slate-800 border-slate-600 text-slate-100");
    expect(main).toContain("bg-white border-slate-200 text-slate-900 shadow-sm");
  });

  test('provider select keeps fixed width so CACHE/LIVE toggle does not reflow header', () => {
    expect(main).toContain('w-[7.25rem]');
    expect(main).toContain('box-border w-full max-w-full');
  });

  test('provider select: CACHE locks to CACHE; LIVE lists only 3 proxies', () => {
    expect(main).toContain('LIVE_PROVIDERS');
    // CACHE → only static option; LIVE → LIVE_PROVIDERS (CBOE/NASDAQ/YAHOO, no CACHE)
    expect(main).toContain("PROVIDERS.filter((p) => p.id === 'static')");
    expect(main).toContain('LIVE_PROVIDERS).map');
    expect(main).toContain("p.id !== 'static'");
  });

  test('CACHE mode disables provider select and mutes proxy dots', () => {
    expect(main).toContain('data-proxy-indicators=');
    expect(main).toContain('data-provider-select=');
    expect(main).toContain('bg-slate-400/50 dark:bg-slate-600/50');
    expect(main).toContain('cursor-not-allowed');
    expect(main).toContain('disabled={isCache}');
  });

  test('LIVE mode probes proxyBase /health', () => {
    expect(main).toContain('fetch(`${base}/health`');
    expect(main).toContain('proxyOk');
  });

  test('CI runs unit tests before build', () => {
    expect(pkg.scripts.test).toBe('bun test');
    expect(ci).toContain('bun run test');
    expect(ci).toContain('pull_request');
    expect(ci.indexOf('bun run test')).toBeLessThan(ci.indexOf('bun run build'));
  });
});
