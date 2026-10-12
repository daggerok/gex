/// <reference types="node" />
/// <reference types="bun" />
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check that the GEX chart remembers its zoom and position PER TICKER: zoom SPY, zoom QQQ
// differently, go back to SPY and find it as it was left (it used to be reset, because one entry
// held one ticker). Also after a reload. Run: `bun run test:e2e`.
// ============================================================================

const site = await startTestSite();
const browser = await chromium.launch();

/** The strike labels of the X axis (recharts puts the tick texts next to the tick marks, not inside them): whole strikes or one decimal. */
const ticks = async (page: Page) => (await page.locator('.recharts-wrapper svg text').allTextContents()).filter((t) => /^\d{2,5}(\.\d)?$/.test(t));
const zoomIn = (page: Page, times: number) => (async () => {
    for (let i = 0; i < times; i++) { await page.getByRole('button', { name: 'Horizontal Zoom In' }).click(); await page.waitForTimeout(150); }
})();
async function load(page: Page, symbol: string) {
    const ticker = page.locator('input[role=combobox]');
    await ticker.fill(symbol);
    await ticker.press('Enter');
    await page.waitForTimeout(2500);
}

try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(site.url);
    await page.getByText('💾').first().click(); // CACHE provider
    await load(page, 'SPY');
    await page.getByRole('button', { name: 'GEX' }).first().click();
    await page.waitForTimeout(2000);

    const spyFull = await ticks(page);
    await zoomIn(page, 3);
    const spyZoomed = await ticks(page);
    assert.notDeepEqual(spyZoomed, spyFull, 'zooming SPY changes the strike axis');

    // another ticker: its own zoom, different from SPY's
    await load(page, 'QQQ');
    await page.waitForTimeout(1000);
    const qqqFull = await ticks(page);
    await zoomIn(page, 1);
    const qqqZoomed = await ticks(page);
    assert.notDeepEqual(qqqZoomed, qqqFull, 'zooming QQQ changes its axis');

    // back to SPY: its zoom is still there (the reported bug: it was reset to the full view)
    await load(page, 'SPY');
    await page.waitForTimeout(1000);
    assert.deepEqual(await ticks(page), spyZoomed, 'SPY comes back zoomed exactly as it was left');

    // and QQQ too
    await load(page, 'QQQ');
    await page.waitForTimeout(1000);
    assert.deepEqual(await ticks(page), qqqZoomed, 'QQQ comes back zoomed as it was left');

    // both are remembered in the browser, so a reload keeps them
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gex.chartZoom.v2') ?? '{}') as Record<string, number[]>);
    assert.deepEqual(Object.keys(saved).sort(), ['QQQ', 'SPY'], 'one entry per ticker');
    await page.reload();
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'GEX' }).first().click();
    await page.waitForTimeout(2000);
    assert.deepEqual(await ticks(page), qqqZoomed, 'after a reload the last ticker keeps its zoom');
    await load(page, 'SPY');
    await page.waitForTimeout(1000);
    assert.deepEqual(await ticks(page), spyZoomed, 'after a reload the other ticker keeps its zoom too');

    assert.deepEqual(errors, [], 'no page errors');
    console.log('chart zoom per ticker e2e: ok');
} finally {
    await browser.close();
    site.close();
}
