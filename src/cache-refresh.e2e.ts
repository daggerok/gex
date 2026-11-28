/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { eventually, freezeClock, noProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the auto refresh from the published cache (src/cache-refresh.ts): SPY is open on the GEX tab, the page
// asks for its file again when the tab becomes visible (the same code the 2 minute timer runs).
//  - the same file: nothing changes
//  - a newer file (later `updated`, another price): the new spot is shown and the chart is the SAME element as before,
//    so the refresh is in place: no reload of the tab, no blank chart, the ticker and the tab stay
// Run: `bun run test:e2e`.
// ============================================================================

const FILE = join(__dirname, 'e2e-fixtures', 'options', 'SPY.json');

async function main(): Promise<void> {
    const original = JSON.parse(readFileSync(FILE, 'utf8')) as { underlyingPrice: number; updated: string };
    const oldSpot = original.underlyingPrice.toFixed(2);
    const newer = { ...original, underlyingPrice: Math.round((original.underlyingPrice + 3.21) * 100) / 100, updated: new Date(Date.parse(original.updated) + 5 * 60_000).toISOString() };
    const newSpot = newer.underlyingPrice.toFixed(2);
    assert.ok(!Number.isNaN(Date.parse(original.updated)), 'the fixture has an `updated` stamp');

    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        let requests = 0;
        let serveNewer = false;
        await page.route('**/api/options/SPY.json', async (route) => {
            requests++;
            if (serveNewer) await route.fulfill({ contentType: 'application/json', body: JSON.stringify(newer) });
            else await route.continue();
        });
        await noProxy(page); // no local proxy: the app uses the CACHE provider by itself
        await freezeClock(page); // the fixtures are frozen, so is the day
        await page.goto(site.url);
        const ticker = page.locator('input[role=combobox]');
        await ticker.fill('SPY');
        await ticker.press('Enter');
        await page.getByRole('button', { name: 'GEX' }).first().click();
        const chart = page.locator('.recharts-wrapper').first();
        await chart.waitFor({ timeout: 10_000 });
        await page.waitForTimeout(1500);
        const spotShown = async (spot: string) => (await page.locator('body').innerText()).includes(spot);
        assert.ok(await spotShown(oldSpot), `the spot ${oldSpot} of the first file is shown`);
        // a mark on the chart element: it is still there afterwards only if the chart was never unmounted
        await chart.evaluate((el) => { (el as HTMLElement).dataset.keep = '1'; });
        const visible = () => page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });

        // ---- the same file again: asked for, nothing changes ----
        const before = requests;
        await visible();
        assert.ok(await eventually(async () => requests > before), 'the page asks for the file again when the tab becomes visible');
        await page.waitForTimeout(800);
        assert.ok(await spotShown(oldSpot), 'the same file changes nothing');
        assert.equal(await page.locator('.recharts-wrapper[data-keep="1"]').count(), 1, 'the chart is untouched by an unchanged file');

        // ---- a newer file: swapped in place ----
        serveNewer = true;
        await visible();
        assert.ok(await eventually(() => spotShown(newSpot), 8000), `the spot ${newSpot} of the newer file is shown`);
        await page.waitForTimeout(500);
        assert.ok(!(await spotShown(oldSpot)), 'the old spot is gone');
        assert.equal(await page.locator('.recharts-wrapper[data-keep="1"]').count(), 1, 'the chart element is the same one: the refresh is in place');
        assert.equal(await ticker.inputValue(), 'SPY', 'the ticker stays');
        assert.ok(!/Request cancelled|Запрос отменён/i.test(await page.locator('body').innerText()), 'no notice after a refresh');
        assert.deepEqual(errors, [], 'no page errors');
        console.log('cache refresh e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
