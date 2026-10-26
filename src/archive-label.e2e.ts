/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Browser, type Page } from 'playwright';
import { startFakeProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the source label next to the ticker when live is off (owner 2026-10-26: CACHE on the published site
// with the proxy running and nothing said why):
//   - an "As of" day open: the label says ARCHIVE <day> (not LIVE or CACHE), live stays off with the proxy up, its tooltip
//     says why, and a click on it goes back to the latest data (LIVE CBOE again)
//   - the proxy down: CACHE <day>, and its tooltip says the proxy did not answer
// A fake proxy (e2e-site.ts) stands in for scripts/options-local-proxy.ts. Run: `bun run test:e2e archive-label`.
// ============================================================================

const SETTINGS_KEY = 'gex.settings.v5';

async function pageWith(browser: Browser, settings: Record<string, unknown>): Promise<Page> {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
    await page.addInitScript(([key, value]) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); }, [SETTINGS_KEY, JSON.stringify(settings)] as const);
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

/** Hovers the source label and waits for its tooltip to hold `text`. */
async function waitTip(page: Page, text: string, what: string): Promise<void> {
    await label(page).hover();
    try {
        await page.waitForFunction((t) => Array.from(document.querySelectorAll('[role=tooltip]')).some((e) => (e.textContent ?? '').includes(t)), text, { timeout: 5000 });
    } catch {
        const tips = await page.locator('[role=tooltip]').allTextContents();
        assert.fail(`${what}: no tooltip with "${text}", seen: ${JSON.stringify(tips)}`);
    }
    await page.mouse.move(5, 790);
}

const cboeHits = (hits: Array<{ path: string }>) => hits.filter((h) => h.path === '/api/cboe').length;

async function main(): Promise<void> {
    const site = await startTestSite({ latest: '2026-09-30', snapshots: [{ id: '2026-09-29', tickers: ['SPY'], spot: 700.5 }] });
    const proxy = startFakeProxy();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        // 1. proxy up: live, then an "As of" day -> ARCHIVE, live off, a click on the label -> live again
        {
            proxy.setUp(true);
            proxy.setCboe(true);
            const page = await pageWith(browser, { proxyBase: proxy.base, lastTicker: 'SPY' });
            await page.goto(site.url);
            await waitLabel(page, /^LIVE CBOE$/, 'proxy up, SPY restored');
            assert.equal(await page.locator('[data-asof-select]').getAttribute('data-asof-select'), 'live');

            await page.locator('[data-asof-select] [data-asof-trigger]').click();
            await page.locator('[data-asof-option="2026-09-29"]').click();
            await waitLabel(page, /^ARCHIVE 2026-09-29$/, 'an As of day is open');
            assert.equal(await label(page).getAttribute('data-source-label'), 'archive');
            await page.waitForFunction(() => document.body.innerText.includes('700.5'), undefined, { timeout: 8000 });
            await waitTip(page, 'Showing the saved day 2026-09-29', 'archive tooltip');

            // live stays off: loading the ticker again reads the snapshot, not the proxy
            const before = cboeHits(proxy.hits);
            const ticker = page.locator('input[role=combobox]');
            await ticker.fill('SPY');
            await ticker.press('Enter');
            await page.waitForFunction(() => document.body.innerText.includes('700.5'), undefined, { timeout: 8000 });
            await waitLabel(page, /^ARCHIVE 2026-09-29$/, 'the reload in archive mode');
            assert.equal(cboeHits(proxy.hits), before, 'no live request while an As of day is open');

            // one click on the label goes back to today
            await label(page).click();
            await waitLabel(page, /^LIVE CBOE$/, 'back to today from the label');
            assert.equal(await page.locator('[data-backtest-banner]').count(), 0, 'the banner is gone');
            assert.equal(await page.locator('[data-asof-select]').getAttribute('data-asof-select'), 'live');
            await page.close();
        }

        // 2. proxy down: CACHE <day>, the tooltip says the proxy did not answer
        {
            proxy.setUp(false);
            const page = await pageWith(browser, { proxyBase: proxy.base, lastTicker: 'SPY' });
            await page.goto(site.url);
            await waitLabel(page, /^CACHE \d{4}-\d{2}-\d{2}$/, 'proxy down');
            await waitTip(page, `the local proxy at ${proxy.base} did not answer when the page loaded`, 'cache tooltip');
            await page.close();
        }
        console.log('archive label e2e: ok');
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
