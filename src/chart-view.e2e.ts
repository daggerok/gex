/// <reference types="node" />
/// <reference types="bun" />
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the Chart tab: the panel (symbol, Daily candles, Range) sits flush in the top left corner of the chart,
// the (?) help shows BELOW its button, and the pan and zoom of the candles and the range button survive a page refresh
// (and a ticker switch). Run: `bun run test:e2e`.
// ============================================================================

const VIEW = 'gex.chartView.v1';
const site = await startTestSite();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));

async function openChart() {
    await page.goto(site.url);
    await page.getByText('💾').first().click();
    const ticker = page.locator('input[role=combobox]');
    await ticker.fill('SPY');
    await ticker.press('Enter');
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Chart' }).first().click();
    await page.waitForTimeout(2000);
}
const view = () => page.locator('[data-last-bar]').getAttribute('data-view');
const stored = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null') as Record<string, [number, number]> | null, VIEW);

try {
    await openChart();

    // ---- the panel is in the very corner of the chart: no gap above or left of it ----
    const container = (await page.locator('[data-last-bar]').boundingBox())!;
    const panel = (await page.locator('[data-chart-header]').boundingBox())!;
    assert.ok(Math.abs(panel.x - container.x) <= 1 && Math.abs(panel.y - container.y) <= 1, `panel at the corner of the chart (panel ${panel.x},${panel.y} chart ${container.x},${container.y})`);

    // ---- the help opens below the (?) button ----
    const help = page.locator('[data-chart-header] button[aria-label]').first();
    const helpBox = (await help.boundingBox())!;
    await help.hover();
    await page.waitForTimeout(400);
    const tipId = await help.getAttribute('aria-describedby');
    const tip = (await page.locator(`[id="${tipId}"]`).boundingBox())!;
    assert.ok(tip.y >= helpBox.y + helpBox.height, `the help is below its button (tooltip top ${tip.y}, button bottom ${helpBox.y + helpBox.height})`);
    assert.ok(tip.y + tip.height <= 900, 'and inside the window');
    await page.mouse.move(700, 600);

    // ---- untouched chart: nothing is stored (the code's own range is not a user choice) ----
    assert.equal(await stored(), null, 'the default view is not saved');
    const defaultView = await view();

    // ---- pan and zoom with the mouse: saved, and back after a refresh ----
    const box = (await page.locator('[data-last-bar]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600); // zoom in
    await page.waitForTimeout(200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 250, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    const changed = await view();
    assert.notEqual(changed, defaultView, 'the mouse changed the window');
    const saved = await stored();
    assert.ok(saved?.SPY, 'the window is saved for SPY');

    await openChart();
    assert.equal(await view(), changed, 'after a refresh the chart is where it was left');

    // ---- Interval: the label, no "Daily candles", and All shows every loaded bar ----
    const header = await page.locator('[data-chart-header]').innerText();
    assert.ok(header.includes('Interval') && !header.includes('Range') && !header.includes('Daily candles'), `header text: ${header}`);
    await page.locator('button[aria-pressed]', { hasText: 'All' }).click();
    await page.waitForTimeout(1000);
    const bars = Number(await page.locator('[data-bars]').getAttribute('data-bars'));
    assert.ok(bars > 100, 'bars loaded');
    assert.equal((await view())!.split(',')[0], (-(bars - 1) - 0.5).toFixed(1), 'All starts at the first bar');

    // ---- a range button resets the window and is remembered ----
    await page.locator('button[aria-pressed]', { hasText: '1M' }).click();
    await page.waitForTimeout(800);
    assert.equal((await stored())?.SPY, undefined, 'a range click clears the saved window');
    await openChart();
    assert.equal(await page.locator('button[aria-pressed=true]', { hasText: '1M' }).count(), 1, 'the chosen range stays after a refresh');

    assert.deepEqual(errors, [], 'no page errors');
    console.log('chart view e2e: ok');
} finally {
    await browser.close();
    site.close();
}
