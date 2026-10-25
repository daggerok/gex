/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Page } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the chart full screen on the GEX and Chart tabs: the button and the F key put the chart card over the whole
// window, the button, the F key and Esc bring it back; F is ignored while a field is edited. Run: `bun run test:e2e`.
// ============================================================================

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const buttons = (p: Page) => p.locator('[data-fullscreen-button]');
    /** The first (top left) button; the GEX card has a second one at the top right. */
    const button = (p: Page) => buttons(p).first();
    /** The card around the chart: the nearest ancestor with a border that holds the button. */
    const card = (p: Page) => button(p).locator('xpath=ancestor::section[1]');
    const rect = async (p: Page) => { const b = (await card(p).boundingBox())!; return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const covers = async (p: Page) => { const r = await rect(p); return r.x <= 0 && r.y <= 0 && r.w >= 1199 && r.h >= 799; };
    const settle = () => page.waitForTimeout(400);

    async function check(tab: 'GEX' | 'Chart') {
        await page.getByRole('button', { name: tab }).first().click();
        await page.waitForTimeout(2000);
        assert.equal(await covers(page), false, `${tab}: the card starts as a part of the page`);
        const normal = await rect(page);
        const chartBefore = await page.evaluate(() => (document.querySelector('canvas') ?? document.querySelector('.recharts-wrapper'))!.getBoundingClientRect().width);

        // the button
        await button(page).click(); await settle();
        assert.equal(await covers(page), true, `${tab}: the button makes it cover the window`);
        assert.equal(await button(page).getAttribute('aria-pressed'), 'true');
        const chartFull = await page.evaluate(() => (document.querySelector('canvas') ?? document.querySelector('.recharts-wrapper'))!.getBoundingClientRect().width);
        assert.ok(chartFull > chartBefore, `${tab}: the chart itself grew (${chartBefore} -> ${chartFull})`);
        await button(page).click(); await settle();
        assert.deepEqual(await rect(page), normal, `${tab}: the button brings it back to where it was`);

        // GEX: a button in both top corners of the card, the right one toggles too
        if (tab === 'GEX') {
            assert.equal(await buttons(page).count(), 2, 'GEX: two full screen buttons');
            const [l, r] = [(await buttons(page).first().boundingBox())!, (await buttons(page).last().boundingBox())!];
            assert.ok(l.x - normal.x < 40 && normal.x + normal.w - (r.x + r.width) < 40 && Math.abs(l.y - r.y) < 2, `GEX: one button top left, one top right (${l.x}, ${r.x}; card ${normal.x}..${normal.x + normal.w})`);
            await buttons(page).last().click(); await settle();
            assert.equal(await covers(page), true, 'GEX: the right button makes it cover the window');
            const rf = (await buttons(page).last().boundingBox())!;
            assert.ok(1200 - (rf.x + rf.width) < 40 && rf.y < 40, 'GEX: the right button stays top right in full screen');
            await buttons(page).last().click(); await settle();
            assert.deepEqual(await rect(page), normal, 'GEX: the right button brings it back');
        }

        // F
        await page.mouse.move(600, 400);
        await page.keyboard.press('f'); await settle();
        assert.equal(await covers(page), true, `${tab}: F makes it full screen`);
        await page.keyboard.press('f'); await settle();
        assert.deepEqual(await rect(page), normal, `${tab}: F again brings it back`);

        // the controls of the chart work in full screen
        await page.keyboard.press('f'); await settle();
        if (tab === 'GEX') {
            const zoomKey = 'gex.chartZoom.v2';
            const zoom = () => page.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, number[]>).SPY ?? null, zoomKey);
            const zoomIn = page.getByRole('button', { name: 'Horizontal Zoom In' });
            assert.equal(await zoomIn.isVisible(), true, 'GEX: the zoom buttons are in full screen');
            await zoomIn.click(); await zoomIn.click(); await settle();
            const byButton = await zoom();
            assert.ok(byButton, 'GEX: a zoom button zooms in full screen');
            await zoomIn.hover(); await page.waitForTimeout(500);
            const tipId = await zoomIn.locator('xpath=ancestor::span[@aria-describedby][1]').getAttribute('aria-describedby');
            const tip = page.locator(`[id="${tipId}"]`);
            const tb = (await tip.boundingBox())!;
            assert.ok(tb && tb.x >= 0 && tb.y >= 0 && tb.x + tb.width <= 1200 && (await tip.evaluate((e) => getComputedStyle(e).opacity)) === '1', 'GEX: the tooltip of a button shows in full screen');
            assert.equal(await tip.evaluate((e) => !document.fullscreenElement || document.fullscreenElement.contains(e)), true, 'GEX: the tooltip is inside the full screen element (anything outside it is invisible)');
            await page.mouse.move(600, 400);
            await page.keyboard.press('+'); await settle();
            const byKey = await zoom();
            assert.ok(byKey && byKey[1] - byKey[0] < byButton![1] - byButton![0], 'GEX: the + key zooms in full screen');
            await page.getByRole('button', { name: /Reset Horizontal Zoom/i }).click();
            await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle();
        } else {
            const view = () => page.locator('[data-last-bar]').getAttribute('data-view');
            const before = await view();
            await page.locator('button[aria-pressed]', { hasText: '1M' }).click(); await settle(); await page.waitForTimeout(600);
            assert.notEqual(await view(), before, 'Chart: the interval buttons work in full screen');
            await page.locator('button[aria-pressed]', { hasText: '6M' }).click(); await settle();
            const help = page.locator('[data-chart-header] button[aria-label]').first();
            await help.hover(); await page.waitForTimeout(500);
            const panel = page.locator(`[id="${await help.getAttribute('aria-describedby')}"]`);
            assert.equal(await panel.evaluate((e) => getComputedStyle(e).opacity), '1', 'Chart: the help shows in full screen');
            assert.equal(await panel.evaluate((e) => !document.fullscreenElement || document.fullscreenElement.contains(e)), true, 'Chart: the help is inside the full screen element');
            await page.mouse.move(600, 400);
        }

        // Esc
        await page.keyboard.press('Escape'); await settle();
        if (!(await covers(page))) { /* already left */ } else { await page.keyboard.press('Escape'); await settle(); }
        await page.keyboard.press('f'); await settle();
        await page.keyboard.press('Escape'); await settle();
        assert.deepEqual(await rect(page), normal, `${tab}: Esc leaves full screen`);

        // F while a field is edited is a letter, not the hotkey
        const field = page.locator('input[role=combobox]');
        await field.focus();
        await page.keyboard.press('f'); await settle();
        assert.equal(await covers(page), false, `${tab}: F in a field does not toggle`);
        assert.ok((await field.inputValue()).toLowerCase().endsWith('f'), 'and types the letter');
        await field.fill('SPY');
        await field.blur();
        // with Ctrl or Cmd it is the browser's own (find): ours stays out
        await page.keyboard.press('Control+f'); await settle();
        assert.equal(await covers(page), false, `${tab}: Ctrl+F does not toggle`);
    }

    try {
        await page.goto(site.url);
        await page.getByText('💾').first().click();
        const ticker = page.locator('input[role=combobox]');
        await ticker.fill('SPY');
        await ticker.press('Enter');
        await page.waitForTimeout(2500);
        await check('GEX');
        await check('Chart');
        assert.deepEqual(errors, [], 'no page errors');
        console.log('fullscreen e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
