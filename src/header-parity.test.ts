/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// App source is split into modules under src/ (Phase 0), so scan all of it.
const main = readdirSync(__dirname, { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .sort()
    .map((f) => readFileSync(join(__dirname, f), 'utf8'))
    .join('\n');
const ci = readFileSync(join(__dirname, '../.github/workflows/ci.yaml'), 'utf8');
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

describe('header parity + auto proxy controls (gex)', () => {
  test('uses fundamentals surface tokens on sticky header', () => {
    expect(main).toContain('bg-slate-950/95 text-slate-100');
    expect(main).toContain('bg-white/95 text-slate-900');
    expect(main).toContain('backdrop-blur-md');
    // side padding follows gex's own page gutter (tabs, <main>, footer), not fundamentals' `px-4 xl:px-8`,
    // so the ticker input and the settings button line up with the content (src/layout.e2e.ts checks it)
    expect(main).toContain('<div className="px-4 lg:px-6">');
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

  test('the settings popover uses the fundamentals card shell', () => {
    expect(main).toContain('w-[min(92vw,22rem)] z-[60]');
    expect(main).toContain('rounded-xl shadow-xl p-3 space-y-3');
    expect(main).toContain("bg-slate-800 border-slate-600 text-slate-100");
    expect(main).toContain("bg-white border-slate-200 text-slate-900 shadow-sm");
  });

  test('debug info and the proxy status are the last block of the settings menu, the header has no debug button and no dots', () => {
    const topBar = readFileSync(join(__dirname, 'components/TopBar.tsx'), 'utf8');
    const header = topBar.slice(0, topBar.indexOf('{openSettings && ('));
    const menu = topBar.slice(topBar.indexOf('{openSettings && ('));
    expect(header).not.toContain('data-proxy-indicators');
    expect(header).not.toContain("t('topBar.debug')");
    expect(menu).toContain('data-debug-info');
    expect(menu.indexOf('data-debug-info')).toBeGreaterThan(menu.indexOf('data-data-source'));
  });

  test('auto proxy: the header shows only the source label, the menu the auto-discovery with the override under Advanced', () => {
    const topBar = readFileSync(join(__dirname, 'components/TopBar.tsx'), 'utf8');
    const header = topBar.slice(0, topBar.indexOf('{openSettings && ('));
    const menu = topBar.slice(topBar.indexOf('{openSettings && ('));
    expect(header).not.toContain('<select');
    expect(header).toContain('data-source-label=');
    // no CACHE / LIVE switch and no provider menu anywhere
    expect(main).not.toContain("{ k: 'cache', l: '💾' }");
    expect(main).not.toContain('data-provider-select');
    expect(main).not.toContain('LIVE_PROVIDERS');
    // one select in the menu: the source override, inside the Advanced block, after the nested SettingsPanel
    expect(menu.match(/<select/g)?.length).toBe(1);
    expect(menu.indexOf('data-source-override')).toBeGreaterThan(menu.indexOf('data-source-advanced'));
    expect(menu.indexOf('data-data-source')).toBeGreaterThan(menu.indexOf('<SettingsPanel'));
    expect(menu).toContain('data-proxy-autopoll=');
  });

  test('the proxy status is muted when the proxy is not probed', () => {
    expect(main).toContain('data-proxy-indicators=');
    expect(main).toContain('bg-slate-400/50 dark:bg-slate-600/50');
  });

  test('auto discovery probes proxyBase /health with a short timeout', () => {
    const discovery = readFileSync(join(__dirname, 'proxy-discovery.ts'), 'utf8');
    expect(discovery).toContain('fetchImpl(`${b}/health`');
    expect(discovery).toContain('PROXY_PROBE_TIMEOUT_MS = 500');
  });

  test('CI runs unit tests before build', () => {
    expect(pkg.scripts.test).toBe('bun test');
    expect(ci).toContain('bun run test');
    expect(ci).toContain('pull_request');
    expect(ci.indexOf('bun run test')).toBeLessThan(ci.indexOf('bun run build'));
  });
});
