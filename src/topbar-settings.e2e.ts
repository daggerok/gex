/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Browser, type Page } from 'playwright';
import { eventually, startFakeProxy, startTestSite, type FakeProxy } from './e2e-site';

// ============================================================================
// Browser check of the top bar against the settings menu (owner 2026-10-26):
//   - the "Auto" switch of the top bar and "Proxy auto-discovery" in the menu are one setting, the only proxy control
//     (owner 2026-10-26): either one flips both, ON probes the proxy at once and again on tab focus, OFF never does
//   - every top bar control has its counterpart in the menu with the same state: theme, language, As of, the source
//     label (read-only status line), Auto
//   - the published site: Auto ON is the consent to contact this computer (the first localhost request comes only after
//     the click), nothing reaches this machine while it is off; there is no "Use my local proxy" button, a saved one
//     (localProxyOptIn) starts Auto ON
//   - Chrome denied local network access: the menu and the CACHE tooltip say so; a probe that fails with a network error
//     on the published site names both causes (proxy not running, or Chrome blocked the site)
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
            const page = await pageWith(browser, { proxyBase: proxy.base, lastTicker: 'SPY', proxyAutoPoll: false });
            await page.goto(site.url);
            await waitText(page, '[data-source-label]', /^CACHE \d{4}-\d{2}-\d{2}$/, 'local, proxy up, Auto off: the cache');

            // Auto: top bar -> menu
            assert.equal(await page.locator('[data-topbar-auto]').getAttribute('data-topbar-auto'), 'off', 'Auto is off as saved');
            await topAuto(page).click();
            await waitAttr(page, '[data-topbar-auto]', 'data-topbar-auto', 'on', 'the top bar switch turns Auto on');
            await waitText(page, '[data-source-label]', /^LIVE CBOE$/, 'local, Auto on: live');
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
            await waitText(page, '[data-source-label]', /^CACHE \d{4}-\d{2}-\d{2}$/, 'local, Auto off again: the cache');
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

        // 1b. the scrollbars follow the app theme (owner 2026-10-26: a white scrollbar in the dark Settings menu)
        for (const theme of ['dark', 'light'] as const) {
            const page = await pageWith(browser, { proxyBase: proxy.base, lastTicker: 'SPY', theme });
            await page.goto(site.url);
            await openMenu(page);
            const style = await page.locator('[data-settings-menu]').evaluate((el) => {
                const cs = getComputedStyle(el);
                return { scheme: cs.colorScheme, color: cs.scrollbarColor };
            });
            assert.equal(style.scheme, theme, `${theme} theme: color-scheme of the menu`);
            assert.notEqual(style.color, 'auto', `${theme} theme: a themed scrollbar-color on the menu`);
            // one scroll only (owner 2026-10-26: the Desk columns list had its own scroll inside the menu's scroll): the
            // menu is the only element in it that overflows with overflow auto or scroll, and it follows the theme
            const scrollers = await page.locator('[data-settings-menu]').evaluate((menu) => [menu, ...Array.from(menu.querySelectorAll('*'))]
                .filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)
                .map((el) => ({ menu: el.hasAttribute('data-settings-menu'), scheme: getComputedStyle(el).colorScheme, tag: `${el.tagName}.${(el as HTMLElement).className}`.slice(0, 80) })));
            assert.equal(scrollers.length, 1, `${theme} theme: exactly one scroll in the open menu: ${JSON.stringify(scrollers)}`);
            assert.ok(scrollers[0].menu, `${theme} theme: the menu itself scrolls`);
            assert.equal(scrollers[0].scheme, theme, `${theme} theme: the menu scroll follows the theme`);
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
                assert.equal(await page.locator('[data-proxy-optin]').count(), 0, 'no "Use my local proxy" button');
                assert.match(await page.locator('[data-proxy-status]').textContent() ?? '', /not in use \(Auto is off\)/);
                await closeMenu(page);
                assert.equal(local.length, 0, `no localhost request with Auto off: ${local.join(', ')}`);
                await topAuto(page).click();
                assert.ok(await eventually(async () => local.includes('/health')), 'the first /health request comes after Auto on');
                await waitText(page, '[data-source-label]', /^LIVE CBOE$/, 'published, after Auto on');
                await openMenu(page);
                assert.equal(await menuAuto(page).getAttribute('aria-checked'), 'true', 'the menu shows Auto on');
                await menuAuto(page).click();
                assert.equal(await page.locator('[data-topbar-auto]').getAttribute('data-topbar-auto'), 'off', 'the menu switch turned the top bar off');
                await waitText(page, '[data-source-label]', /^CACHE \d{4}-\d{2}-\d{2}$/, 'published, Auto off again: the cache');
                const n = local.length;
                await page.evaluate(() => window.dispatchEvent(new Event('focus')));
                assert.equal(await eventually(async () => local.length > n, 300), false, 'published, Auto off: nothing more reaches this machine');
                await page.close();

                // 3. Chrome denied local network access: the menu and the CACHE tooltip say so. The saved removed "Use my local
                //    proxy" (localProxyOptIn true) starts Auto ON
                proxy.setUp(false);
                const denied = await pageWith(pages, { proxyBase: proxy.base, lastTicker: 'SPY', proxyAutoPoll: false, localProxyOptIn: true });
                await denied.addInitScript(() => {
                    const query = navigator.permissions.query.bind(navigator.permissions);
                    navigator.permissions.query = ((d: { name: string }) => (d.name === 'loopback-network' || d.name === 'local-network-access'
                        ? Promise.resolve({ state: 'denied', name: d.name, onchange: null, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })
                        : query(d as PermissionDescriptor))) as typeof navigator.permissions.query;
                });
                await denied.goto(site.url.replace('localhost', 'gex.test'));
                await waitText(denied, '[data-source-label]', /^CACHE \d{4}-\d{2}-\d{2}$/, 'denied: cache');
                assert.equal(await denied.locator('[data-topbar-auto]').getAttribute('data-topbar-auto'), 'on', 'a saved localProxyOptIn starts Auto ON');
                const saved = await denied.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), SETTINGS_KEY);
                assert.equal(saved.localProxyOptIn, undefined, 'the old key is dropped from the saved settings');
                await openMenu(denied);
                await denied.locator('[data-lna-denied]').waitFor();
                assert.match(await denied.locator('[data-lna-denied]').textContent() ?? '', /Chrome blocked access to your computer/);
                await closeMenu(denied);
                await denied.locator('[data-source-label]').hover();
                assert.ok(await eventually(async () => (await denied.locator('[role=tooltip]').allTextContents()).some((t) => t.includes('Chrome blocked access'))), 'the CACHE tooltip names the blocked access');
                await denied.close();

                // 4. Chrome blocks the fetch but navigator.permissions still says "prompt" (seen on the real site, Chrome 153):
                //    a probe that fails with a network error names both causes, in the menu and the CACHE tooltip
                const blocked = await pageWith(pages, { proxyBase: proxy.base, lastTicker: 'SPY', proxyAutoPoll: true });
                await blocked.route(`${proxy.base}/**`, (route) => route.abort('blockedbyclient'));
                await blocked.goto(site.url.replace('localhost', 'gex.test'));
                await waitText(blocked, '[data-source-label]', /^CACHE \d{4}-\d{2}-\d{2}$/, 'blocked: cache');
                await openMenu(blocked);
                await waitAttr(blocked, '[data-lna-denied]', 'data-lna-denied', 'maybe', 'the menu hint of a failed probe');
                assert.match(await blocked.locator('[data-lna-denied]').textContent() ?? '', /did not answer, or Chrome blocked this site from reaching your computer: start bun run proxy, and in the address bar's site settings allow Local network access/);
                await closeMenu(blocked);
                await blocked.locator('[data-source-label]').hover();
                assert.ok(await eventually(async () => (await blocked.locator('[role=tooltip]').allTextContents()).some((t) => t.includes('or Chrome blocked this site'))), 'the CACHE tooltip names both causes');
                await blocked.close();
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
