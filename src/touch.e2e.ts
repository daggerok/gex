/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type CDPSession, type Page } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the touch screen: on the GEX tab and the Chart tab a long press (one finger held still) opens the custom
// level editor, a short tap or a drag does not; on the GEX tab two fingers pinch to zoom and one finger drags the zoomed chart.
// Touch is sent through the DevTools protocol (Input.dispatchTouchEvent). Run: `bun run test:e2e`.
// ============================================================================

const ZOOM = 'gex.chartZoom.v2';
async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 900, height: 900 }, hasTouch: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const cdp: CDPSession = await context.newCDPSession(page);

    type Pt = { x: number; y: number; id: number };
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Pt[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const editor = (p: Page) => p.locator('input[aria-label^="Level name"]');
    const zoom = () => page.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, [number, number]>).SPY ?? null, ZOOM);

    async function longPress(at: { x: number; y: number }, hold = 700, drift = 0) {
        await touch('touchStart', [{ ...at, id: 0 }]);
        if (drift) await touch('touchMove', [{ x: at.x + drift, y: at.y, id: 0 }]);
        await page.waitForTimeout(hold);
        await touch('touchEnd', []);
        await page.waitForTimeout(300);
    }

    try {
        await page.goto(site.url);
        await page.getByText('💾').first().click();
        const ticker = page.locator('input[role=combobox]');
        await ticker.fill('SPY');
        await ticker.press('Enter');
        await page.waitForTimeout(2500);

        // ---- GEX tab ----
        await page.getByRole('button', { name: 'GEX' }).first().click();
        await page.waitForTimeout(2500);
        const box = (await page.locator('.recharts-wrapper').first().boundingBox())!;
        const at = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.45 };

        await longPress(at, 120); // a tap
        assert.equal(await editor(page).count(), 0, 'a short tap does not open the editor');
        await longPress(at, 700, 40); // a drag
        assert.equal(await editor(page).count(), 0, 'a drag is not a long press');
        await longPress(at);
        assert.equal(await editor(page).count(), 1, 'a long press opens the editor on the GEX tab');
        await page.keyboard.press('Escape');
        await editor(page).waitFor({ state: 'detached', timeout: 2000 });

        // two fingers apart zoom in around the middle, together zoom out again
        const mid = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.45 };
        assert.equal(await zoom(), null, 'the chart starts at the full range');
        await touch('touchStart', [{ x: mid.x - 40, y: mid.y, id: 0 }, { x: mid.x + 40, y: mid.y, id: 1 }]);
        for (const d of [60, 90, 120, 150]) await touch('touchMove', [{ x: mid.x - d, y: mid.y, id: 0 }, { x: mid.x + d, y: mid.y, id: 1 }]);
        await touch('touchEnd', []);
        await page.waitForTimeout(500);
        const zoomed = await zoom();
        assert.ok(zoomed, 'a pinch out zooms in and the zoom is saved');
        const width = zoomed![1] - zoomed![0];
        await touch('touchStart', [{ x: mid.x - 150, y: mid.y, id: 0 }, { x: mid.x + 150, y: mid.y, id: 1 }]);
        for (const d of [120, 90, 60]) await touch('touchMove', [{ x: mid.x - d, y: mid.y, id: 0 }, { x: mid.x + d, y: mid.y, id: 1 }]);
        await touch('touchEnd', []);
        await page.waitForTimeout(500);
        const wider = await zoom();
        assert.ok(wider === null || wider[1] - wider[0] > width, 'a pinch in zooms out');

        // zoom in again, then one finger drags the chart sideways
        await touch('touchStart', [{ x: mid.x - 40, y: mid.y, id: 0 }, { x: mid.x + 40, y: mid.y, id: 1 }]);
        for (const d of [80, 140, 200]) await touch('touchMove', [{ x: mid.x - d, y: mid.y, id: 0 }, { x: mid.x + d, y: mid.y, id: 1 }]);
        await touch('touchEnd', []);
        await page.waitForTimeout(500);
        const before = (await zoom())!;
        await touch('touchStart', [{ x: mid.x, y: mid.y, id: 0 }]);
        for (const dx of [-30, -80, -150]) await touch('touchMove', [{ x: mid.x + dx, y: mid.y, id: 0 }]);
        await touch('touchEnd', []);
        await page.waitForTimeout(500);
        const panned = (await zoom())!;
        assert.ok(panned[0] > before[0] && Math.abs(panned[1] - panned[0] - (before[1] - before[0])) < 1e-6, 'one finger drags the zoomed chart, the width stays');

        // ---- Chart tab ----
        await page.getByRole('button', { name: 'Chart' }).first().click();
        await page.waitForTimeout(2000);
        const cbox = (await page.locator('canvas').first().boundingBox())!;
        const cat = { x: cbox.x + cbox.width * 0.4, y: cbox.y + cbox.height * 0.5 };
        await longPress(cat, 120);
        assert.equal(await editor(page).count(), 0, 'Chart: a short tap does not open the editor');
        await longPress(cat);
        assert.equal(await editor(page).count(), 1, 'a long press opens the editor on the Chart tab');

        assert.deepEqual(errors, [], 'no page errors');
        console.log('touch e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
