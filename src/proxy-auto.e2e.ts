/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Browser, type Page } from 'playwright';
import { noProxy, startFakeProxy, startTestSite, type FakeProxy } from './e2e-site';

// ============================================================================
// Browser check of the auto proxy (owner 2026-10-25, src/proxy-discovery.ts): no provider menu and no cache / live switch;
// the app looks for the local proxy and loads live data through it (CBOE first) or the cache when there is none, with a
// source label next to the ticker. Proxy down -> CACHE <date>; up -> LIVE CBOE; "Proxy auto-discovery" OFF needs a
// reload to notice a change, ON switches by itself; CBOE failing -> the cache in the end; on a host not served from this
// machine (the published site) no request at all reaches this machine before "Use my local proxy". A fake proxy
// (e2e-site.ts) stands in for scripts/options-local-proxy.ts. Run: `bun run test:e2e proxy-auto`.
// ============================================================================

const SETTINGS_KEY = 'gex.settings.v5';

async function pageWith(browser: Browser, settings: Record<string, unknown> | null): Promise<Page> {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
    if (settings) await page.addInitScript(([key, value]) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); }, [SETTINGS_KEY, JSON.stringify(settings)] as const); // first load only, a reload keeps what the app saved
    return page;
}

const label = (page: Page) => page.locator('[data-source-label]');

async function waitLabel(page: Page, re: RegExp, what: string, timeout = 8000): Promise<void> {
    try {
        await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-source-label]')?.textContent ?? ''), re.source, { timeout });
    } catch {
        assert.fail(`${what}: the source label is "${await label(page).textContent().catch(() => '?')}", expected ${re}`);
    }
}

/**
 * Waits until the fake proxy got no request for `quietMs`: a page closed while it was still loading (a live chain, its
 * candles) has requests on the wire that reach the proxy after the close, and they must not count for the next step.
 */
async function drained(proxy: FakeProxy, quietMs = 400): Promise<void> {
    let seen = -1;
    while (seen !== proxy.hits.length) {
        seen = proxy.hits.length;
        await new Promise((r) => setTimeout(r, quietMs));
    }
}

const healthHits = (proxy: FakeProxy) => proxy.hits.filter((h) => h.path === '/health').length;

async function main(): Promise<void> {
    const site = await startTestSite();
    const proxy = startFakeProxy();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        // 1. no proxy: cache, no menu in the header, the controls in the settings menu
        {
            const page = await pageWith(browser, null);
            await noProxy(page);
            await page.goto(site.url);
            await waitLabel(page, /^CACHE$/, 'no proxy, nothing loaded');
            assert.equal(await page.locator('select').count(), 0, 'no dropdown in the header');
            assert.equal(await page.getByText('💾').count(), 0, 'no cache / live switch');
            const ticker = page.locator('input[role=combobox]');
            await ticker.fill('SPY');
            await ticker.press('Enter');
            await waitLabel(page, /^CACHE \d{4}-\d{2}-\d{2}$/, 'no proxy, SPY loaded');
            await page.locator('button[aria-label="Settings"]').click();
            assert.equal(await page.locator('[data-proxy-status]').getAttribute('data-proxy-status'), 'down');
            assert.equal(await page.locator('[data-proxy-autopoll]').getAttribute('data-proxy-autopoll'), 'off', 'auto-discovery polling is OFF by default');
            await page.locator('[data-source-advanced] summary').click();
            const override = page.locator('[data-source-override]');
            assert.deepEqual(await override.locator('option').allInnerTexts(), ['Auto', 'Always cache', 'CBOE only', 'YAHOO only', 'NASDAQ only']);
            assert.equal(await override.inputValue(), 'auto');
            assert.equal(await page.locator('[data-proxy-base]').inputValue(), 'http://localhost:8787');
            await page.close();
        }

        // 2. proxy up, polling OFF: live CBOE on load (the restored ticker too), a stop is noticed only after a reload
        {
            proxy.setUp(true);
            proxy.setCboe(true);
            const page = await pageWith(browser, { proxyBase: proxy.base, lastTicker: 'SPY' });
            await page.goto(site.url);
            await waitLabel(page, /^LIVE CBOE$/, 'proxy up, SPY restored');
            assert.ok(proxy.hits.some((h) => h.path === '/api/cboe'), 'SPY came through the proxy');
            await page.getByRole('button', { name: 'Chart' }).first().click();
            await page.waitForTimeout(800);
            assert.ok(proxy.hits.some((h) => h.path === '/api/chart'), 'the Chart tab asks the proxy for candles too');
            const probes = healthHits(proxy);
            proxy.setUp(false);
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            await page.waitForTimeout(1500);
            assert.equal(healthHits(proxy), probes, 'OFF: no probe after the one on load');
            assert.match(await label(page).textContent() ?? '', /^LIVE CBOE$/, 'OFF: still live until a reload');
            await page.reload();
            await waitLabel(page, /^CACHE \d{4}-\d{2}-\d{2}$/, 'OFF: after a reload with the proxy stopped');
            await page.close();
        }

        // 3. polling ON: the source switches both ways without a reload
        {
            proxy.setUp(false);
            const page = await pageWith(browser, { proxyBase: proxy.base, lastTicker: 'SPY', proxyAutoPoll: true });
            await page.goto(site.url);
            await waitLabel(page, /^CACHE \d{4}-\d{2}-\d{2}$/, 'ON: proxy down at load');
            proxy.setUp(true);
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            await waitLabel(page, /^LIVE CBOE$/, 'ON: the proxy started, focus probes again');
            proxy.setUp(false);
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            await waitLabel(page, /^CACHE \d{4}-\d{2}-\d{2}$/, 'ON: the proxy stopped');
            await page.close();
        }

        // 4. fallback: CBOE fails, YAHOO and NASDAQ too (the fake serves only CBOE) -> the cache serves SPY
        {
            proxy.setUp(true);
            proxy.setCboe(false);
            await drained(proxy);
            const before = proxy.hits.length;
            const page = await pageWith(browser, { proxyBase: proxy.base, lastTicker: 'SPY' });
            await page.goto(site.url);
            await waitLabel(page, /^CACHE \d{4}-\d{2}-\d{2}$/, 'every live provider failed');
            const tried = proxy.hits.slice(before).map((h) => h.path);
            assert.ok(tried.includes('/api/cboe'), `CBOE was tried first: ${tried.join(', ')}`);
            assert.ok(tried.indexOf('/api/cboe') < tried.lastIndexOf('/api/nasdaq'), `then NASDAQ: ${tried.join(', ')}`);
            await page.close();
        }

        // 5. the "Always cache" override: cache with the proxy running, and no probe at all
        {
            proxy.setUp(true);
            proxy.setCboe(true);
            await drained(proxy);
            const before = healthHits(proxy);
            const page = await pageWith(browser, { proxyBase: proxy.base, lastTicker: 'SPY', source: 'static' });
            await page.goto(site.url);
            await waitLabel(page, /^CACHE \d{4}-\d{2}-\d{2}$/, 'Always cache');
            assert.equal(healthHits(proxy), before, 'Always cache: the proxy is not probed');
            await page.close();
        }

        // 6. an old saved provider menu choice does not break: dropped, Auto takes over
        {
            proxy.setUp(true);
            const page = await pageWith(browser, { proxyBase: proxy.base, lastTicker: 'SPY', providerId: 'yahoo' });
            await page.goto(site.url);
            await waitLabel(page, /^LIVE CBOE$/, 'old providerId: yahoo');
            const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), SETTINGS_KEY);
            assert.equal(saved.providerId, undefined, 'the old providerId is gone from the saved settings');
            assert.equal(saved.source, 'auto');
            await page.close();
        }
        // 7. published site (any host not served from this machine): no request to this machine before "Use my local proxy"
        {
            proxy.setUp(true);
            proxy.setCboe(true);
            await drained(proxy);
            const before = proxy.hits.length;
            const pages = await chromium.launch({ args: ['--mute-audio', '--host-resolver-rules=MAP gex.test 127.0.0.1'] });
            try {
                const page = await pageWith(pages, { proxyBase: proxy.base, lastTicker: 'SPY' });
                const local: string[] = [];
                page.on('request', (r) => { const h = new URL(r.url()).hostname; if (h === 'localhost' || h === '127.0.0.1') local.push(r.url()); });
                const url = site.url.replace('localhost', 'gex.test');
                await page.goto(url);
                await waitLabel(page, /^CACHE \d{4}-\d{2}-\d{2}$/, 'published site, before the opt-in');
                await page.getByRole('button', { name: 'Chart' }).first().click();
                await page.waitForTimeout(1500);
                await page.getByRole('button', { name: 'Desk' }).first().click();
                const ticker = page.locator('input[role=combobox]');
                await ticker.fill('QQ');
                await page.waitForTimeout(800);
                assert.deepEqual(local, [], 'no request to this machine before the opt-in (no probe, no search, no candles)');
                // only what came from the published origin counts: a request of the page of step 6 (it was loading SPY live
                // when it closed) may still reach the proxy now (CI, 2026-10-26: 18 hits instead of 17)
                const published = new URL(url).origin;
                assert.deepEqual(proxy.hits.slice(before).filter((h) => h.origin === published), [], 'the proxy saw nothing from the published site');
                await ticker.fill('SPY');
                await page.keyboard.press('Escape');
                await page.locator('button[aria-label="Settings"]').click();
                const optIn = page.locator('[data-proxy-optin] button');
                assert.equal(await page.locator('[data-proxy-optin]').getAttribute('data-proxy-optin'), 'off');
                assert.equal(await page.locator('[data-proxy-status]').getAttribute('data-proxy-status'), 'off');
                await optIn.click();
                await waitLabel(page, /^LIVE CBOE$/, 'published site, after "Use my local proxy"');
                const seen = proxy.hits.slice(before);
                assert.ok(seen.some((h) => h.path === '/health' && h.origin === new URL(url).origin), 'the probe came from the published origin');
                await page.reload();
                await waitLabel(page, /^LIVE CBOE$/, 'the opt-in is remembered after a reload');
                await page.close();
            } finally {
                await pages.close();
            }
        }
        console.log('proxy auto e2e: ok');
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
