/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of review GEX-M9: the GEX chart's wheel zoom (a native listener on the chart box) must work after the
// futures-priced placeholder was shown. A VIX file (QQQ's quotes under the VIX name, the site has no VIX) with the VIX
// futures pricing off shows the placeholder, which renders no chart box; then SPY is loaded on the same tab. The
// listeners were keyed on `!!chart`, which could stay true across the placeholder. A regression guard: since #181 a
// ticker switch passes through a frame with no quotes, which re-ran those effects too, so this path also passes on the
// old code; the fix keys them on the box element itself.
// Run: `bun run test:e2e`.
// ============================================================================

const ticks = async (page: Page) => (await page.locator('.recharts-wrapper svg text').allTextContents()).filter((t) => /^\d{2,5}(\.\d)?$/.test(t));

async function load(page: Page, symbol: string): Promise<void> {
    const ticker = page.locator('input[role=combobox]');
    await ticker.fill(symbol);
    await page.waitForTimeout(400);
    await ticker.press('Escape'); // close the suggestions, so Enter loads exactly this ticker (VIX would pick UVIX)
    await ticker.press('Enter');
    await page.waitForTimeout(2500);
}

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        const qqq = JSON.parse(readFileSync(join(__dirname, '..', 'api', 'options', 'QQQ.json'), 'utf8')) as Record<string, unknown>;
        await page.route('**/api/options/VIX.json', (route) => route.fulfill({ json: { ...qqq, symbol: 'VIX' } }));
        await page.goto(site.url);
        await page.getByText('💾').first().click(); // CACHE provider
        await page.getByRole('button', { name: 'GEX' }).first().click();
        await load(page, 'VIX');
        assert.equal(await page.locator('.recharts-wrapper').count(), 0, 'VIX without futures pricing shows the placeholder, no chart');

        await load(page, 'SPY');
        let before: string[] = [];
        for (let i = 0; i < 20 && before.length === 0; i++) { await page.waitForTimeout(250); before = await ticks(page); }
        assert.ok(before.length > 2, `SPY draws its chart (${before.join(' ')})`);
        // wheel DOWN over the plot zooms in (GexView's native wheel listener)
        const box = await page.locator('.recharts-wrapper').first().boundingBox();
        assert.ok(box, 'chart box');
        let after = before;
        for (let i = 0; i < 8 && JSON.stringify(after) === JSON.stringify(before); i++) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.wheel(0, 200);
            await page.waitForTimeout(300);
            after = await ticks(page);
        }
        assert.notDeepEqual(after, before, 'the wheel zooms the SPY chart after the VIX placeholder');
        console.log('gex listeners e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
