/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Browser, type Page } from 'playwright';
import { eventually, startFakeProxy, startTestSite, type FakeProxy } from './e2e-site';

// ============================================================================
// Browser check of the top bar against the settings menu (owner 2026-10-26):
//   - the "Auto" switch of the top bar and "Proxy auto-discovery" in the menu are one setting: either one flips both, and
//     ON probes the proxy again on tab focus, OFF does not
//   - every top bar control has its counterpart in the menu with the same state: theme, language, As of, the source
//     label (read-only status line), Auto
//   - the published site: Auto ON is the consent to contact this computer (it turns "Use my local proxy" on, the first
//     localhost request comes only after the click), "Use my local proxy" OFF turns Auto off; nothing reaches this
//     machine while both are off
//   - Chrome denied local network access: the menu and the CACHE tooltip say so
// A fake proxy (e2e-site.ts) stands in for scripts/options-local-proxy.ts. Run: `bun run test:e2e topbar-settings`.
// ============================================================================

const SETTINGS_KEY = 'gex.settings.v5';

async function pageWith(browser: Browser, settings: Record<string, unknown>): Promise<Page> {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await page.addInitScript(([key, value]) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); }, [SETTINGS_KEY, JSON.stringify(settings)] as const);
    return page;
}

async function waitText(page: Page, selector: string, re: RegExp, what: string, timeout = 8000): Promise<void> {
    try {
        await page.waitForFunction(([sel, src]) => new RegExp(src).test(document.querySelector(sel)?.textContent ?? ''), [selector, re.source] as const, { timeout });
    } catch {
        assert.fail(`${what}: ${selector} is "${await page.locator(selector).first().textContent().catch(() => '?')}", expected ${re}`);
    }
}

async function waitAttr(page: Page, selector: string, attr: string, value: string, what: string): Promise<void> {
    const ok = await eventually(async () => (await page.locator(selector).first().getAttribute(attr).catch(() => null)) === value, 8000);
    assert.ok(ok, `${what}: ${selector} ${attr}="${await page.locator(selector).first().getAttribute(attr).catch(() => null)}", expected "${value}"`);
}

const topAuto = (page: Page) => page.locator('[data-topbar-auto] [role=switch]');
const menuAuto = (page: Page) => page.locator('[data-proxy-autopoll] [role=switch]');
const healthHits = (proxy: FakeProxy) => proxy.hits.filter((h) => h.path === '/health').length;

async function openMenu(page: Page): Promise<void> {
    if (await page.locator('[data-data-source]').count()) return;
    await page.locator('button[aria-label="Settings"]').click();
    await page.locator('[data-data-source]').waitFor();
}

async function closeMenu(page: Page): Promise<void> {
    if (!(await page.locator('[data-data-source]').count())) return;
    await page.locator('button[aria-label="Settings"]').click();
    await page.locator('[data-data-source]').waitFor({ state: 'detached' });
}

async function main(): Promise<void> {
    const site = await startTestSite({ latest: '2026-09-30', snapshots: [{ id: '2026-09-29', tickers: ['SPY'], spot: 700.5 }] });
    const proxy = startFakeProxy();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        // 1. local page: Auto in both places, the probing it controls, and every top bar item in the menu
        {
            proxy.setUp(true);
            proxy.setCboe(true);
            const page = await pageWith(browser, { proxyBase: proxy.base, lastTicker: 'SPY' });
            await page.goto(site.url);
            await waitText(page, '[data-source-label]', /^LIVE CBOE$/, 'local, proxy up');

            // Auto: top bar -> menu
            assert.equal(await page.locator('[data-topbar-auto]').getAttribute('data-topbar-auto'), 'off', 'Auto is off by default');
            await topAuto(page).click();
            await waitAttr(page, '[data-topbar-auto]', 'data-topbar-auto', 'on', 'the top bar switch turns Auto on');
            await openMenu(page);
            assert.equal(await menuAuto(page).getAttribute('aria-checked'), 'true', 'the menu shows Auto on');
            await closeMenu(page);
            // ON: a tab focus probes again
            const before = healthHits(proxy);
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            assert.ok(await eventually(async () => healthHits(proxy) > before), 'Auto on: the focus probes the proxy');
            // Auto: menu -> top bar
            await openMenu(page);
            await menuAuto(page).click();
            await waitAttr(page, '[data-proxy-autopoll] [role=switch]', 'aria-checked', 'false', 'the menu switch turns Auto off');
            assert.equal(await page.locator('[data-topbar-auto]').getAttribute('data-topbar-auto'), 'off', 'the top bar shows Auto off');
            await closeMenu(page);
            // OFF: no probe on focus (the request would be sent at once; a poll over 300 ms proves it was not)
            const off = healthHits(proxy);
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            assert.equal(await eventually(async () => healthHits(proxy) > off, 300), false, 'Auto off: no probe on focus');

            // the source label: the menu shows the same text
            await openMenu(page);
            assert.equal(await page.locator('[data-settings-source]').textContent(), await page.locator('[data-source-label]').textContent(), 'source status line = top bar label');

            // theme: menu -> top bar
            const topTheme = page.locator('button[aria-label="Light"], button[aria-label="Dark"]').first();
            const wasDark = (await topTheme.getAttribute('aria-label')) === 'Light';
            await page.locator('[data-data-source]').locator('xpath=..').getByRole('button', { name: wasDark ? '☀️' : '🌙' }).first().click();
            await waitAttr(page, 'button[aria-label="Light"], button[aria-label="Dark"]', 'aria-label', wasDark ? 'Dark' : 'Light', 'the menu theme switches the top bar theme button');

            // language: menu -> top bar (the top bar pill and the Auto label follow)
            const menuRu = page.locator('[data-data-source]').locator('xpath=..').getByRole('button', { name: '🇷🇺' });
            await menuRu.click();
            await waitText(page, '[data-topbar-auto]', /Авто/, 'the menu language switches the top bar');
            const topRu = page.locator('header, div.sticky').first().getByRole('button', { name: '🇷🇺' }).first();
            assert.equal(await topRu.getAttribute('aria-pressed'), 'true', 'the top bar language pill shows ru');
            await page.locator('[data-data-source]').locator('xpath=..').getByRole('button', { name: '🇺🇸' }).click();
            await waitText(page, '[data-topbar-auto]', /Auto/, 'back to en');

            // As of: menu -> top bar (archive label and selector), and back to latest
            await page.locator('[data-asof-mobile] select').selectOption('2026-09-29');
            await waitAttr(page, '[data-asof-select]', 'data-asof-select', 'backtest', 'the menu As of opens the day in the top bar');
            await waitText(page, '[data-source-label]', /^ARCHIVE 2026-09-29$/, 'the menu As of');
            await openMenu(page);
            assert.equal(await page.locator('[data-settings-source]').textContent(), 'ARCHIVE 2026-09-29', 'the menu status line follows');
            await page.locator('[data-asof-mobile] select').selectOption('');
            await waitAttr(page, '[data-asof-select]', 'data-asof-select', 'live', 'Latest in the menu');
            await page.close();
        }

        // 2. published site: nothing reaches this machine while Auto and the opt-in are off; Auto ON is the opt-in
        {
            proxy.setUp(true);
            proxy.setCboe(true);
            const pages = await chromium.launch({ args: ['--mute-audio', '--host-resolver-rules=MAP gex.test 127.0.0.1'] });
            try {
                const page = await pageWith(pages, { proxyBase: proxy.base, lastTicker: 'SPY' });
                const local: string[] = [];
                page.on('request', (r) => { const h = new URL(r.url()).hostname; if (h === 'localhost' || h === '127.0.0.1') local.push(new URL(r.url()).pathname); });
                await page.goto(site.url.replace('localhost', 'gex.test'));
                await waitText(page, '[data-source-label]', /^CACHE \d{4}-\d{2}-\d{2}$/, 'published, before Auto');
                await openMenu(page);
                assert.equal(await page.locator('[data-proxy-optin]').getAttribute('data-proxy-optin'), 'off');
                await closeMenu(page);
                assert.equal(local.length, 0, `no localhost request with Auto off: ${local.join(', ')}`);
                await topAuto(page).click();
                assert.ok(await eventually(async () => local.includes('/health')), 'the first /health request comes after Auto on');
                await waitText(page, '[data-source-label]', /^LIVE CBOE$/, 'published, after Auto on');
                await openMenu(page);
                assert.equal(await page.locator('[data-proxy-optin]').getAttribute('data-proxy-optin'), 'on', 'Auto on turned Use my local proxy on');
                await page.locator('[data-proxy-optin] button').click();
                await waitAttr(page, '[data-proxy-optin]', 'data-proxy-optin', 'off', 'opt-in off');
                assert.equal(await menuAuto(page).getAttribute('aria-checked'), 'false', 'opt-in off turned Auto off (menu)');
                assert.equal(await page.locator('[data-topbar-auto]').getAttribute('data-topbar-auto'), 'off', 'and the top bar');
                await page.close();

                // 3. Chrome denied local network access: the menu and the CACHE tooltip say so
                proxy.setUp(false);
                const denied = await pageWith(pages, { proxyBase: proxy.base, lastTicker: 'SPY', localProxyOptIn: true });
                await denied.addInitScript(() => {
                    const query = navigator.permissions.query.bind(navigator.permissions);
                    navigator.permissions.query = ((d: { name: string }) => (d.name === 'loopback-network' || d.name === 'local-network-access'
                        ? Promise.resolve({ state: 'denied', name: d.name, onchange: null, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })
                        : query(d as PermissionDescriptor))) as typeof navigator.permissions.query;
                });
                await denied.goto(site.url.replace('localhost', 'gex.test'));
                await waitText(denied, '[data-source-label]', /^CACHE \d{4}-\d{2}-\d{2}$/, 'denied: cache');
                await openMenu(denied);
                await denied.locator('[data-lna-denied]').waitFor();
                assert.match(await denied.locator('[data-lna-denied]').textContent() ?? '', /Chrome blocked access to your computer/);
                await closeMenu(denied);
                await denied.locator('[data-source-label]').hover();
                assert.ok(await eventually(async () => (await denied.locator('[role=tooltip]').allTextContents()).some((t) => t.includes('Chrome blocked access'))), 'the CACHE tooltip names the blocked access');
                await denied.close();
            } finally {
                await pages.close();
            }
        }
        console.log('topbar settings e2e: ok');
    } finally {
        await browser.close();
        proxy.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
