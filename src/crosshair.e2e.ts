/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium } from 'playwright';
import { noProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the Chart tab's crosshair magnet (src/crosshair-magnet.ts): the real mouse moves down one column of
// the chart in 1 px steps. Near the hovered candle's open, high, low or close the crosshair snaps to that price
// (data-crosshair-snap holds it), farther away it is free (''), each snap band is at most 2 x CROSSHAIR_SNAP_PX + 1 px
// tall and one column never snaps to more than its candle's four prices. Run: `bun run test:e2e`.
// ============================================================================

const SNAP_PX = 8;

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await noProxy(page); // no local proxy: the app uses the CACHE provider by itself
        await page.goto(site.url);
        const ticker = page.locator('input[role=combobox]');
        await ticker.fill('SPY');
        await ticker.press('Enter');
        await page.waitForTimeout(2500);
        await page.getByRole('button', { name: 'Chart', exact: true }).first().click();
        await page.waitForTimeout(2000);
        const chart = page.locator('[data-last-bar]');
        const box = (await chart.boundingBox())!;
        // a column in the middle of the candles (left of the level labels on the right)
        const x = box.x + box.width * 0.6;
        const snaps: Array<{ y: number; snap: string }> = [];
        for (let y = box.y + 40; y < box.y + box.height - 60; y += 1) {
            await page.mouse.move(x, y);
            snaps.push({ y, snap: (await chart.getAttribute('data-crosshair-snap')) ?? '' });
        }
        const snapped = snaps.filter((s) => s.snap !== '');
        const free = snaps.filter((s) => s.snap === '');
        assert.ok(snapped.length > 0, 'near the candle the crosshair snaps');
        assert.ok(free.length > snaps.length / 2, 'away from the candle the crosshair is free');
        const prices = Array.from(new Set(snapped.map((s) => s.snap)));
        assert.ok(prices.length >= 1 && prices.length <= 4, `one column snaps only to its candle's open, high, low, close: ${prices.join(', ')}`);
        // every run of the same snapped price is at most 2 * SNAP_PX + 1 px tall (it ends where the cursor is too far)
        let run = 0;
        let maxRun = 0;
        for (let i = 0; i < snaps.length; i++) {
            run = snaps[i].snap !== '' && i > 0 && snaps[i - 1].snap === snaps[i].snap ? run + 1 : snaps[i].snap !== '' ? 1 : 0;
            maxRun = Math.max(maxRun, run);
        }
        assert.ok(maxRun <= 2 * SNAP_PX + 1, `a snap band is at most ${2 * SNAP_PX + 1} px tall (got ${maxRun})`);
        // a moment snapped and a moment free, for a look at the crosshair (not asserted on pixels)
        if (process.env.CROSSHAIR_SHOTS) {
            const mid = snapped[Math.floor(snapped.length / 2)];
            await page.mouse.move(x, mid.y);
            await page.screenshot({ path: `${process.env.CROSSHAIR_SHOTS}/crosshair-snapped.png` });
            await page.mouse.move(x, free[Math.floor(free.length / 2)].y);
            await page.screenshot({ path: `${process.env.CROSSHAIR_SHOTS}/crosshair-free.png` });
        }
        assert.deepEqual(errors, [], 'no page errors');
        console.log(`crosshair e2e: ok (${snapped.length} px snapped to ${prices.join(', ')}, ${free.length} px free)`);
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
