/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Page } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of review GEX-H11: the Desk's expiration sections are memoized, so typing in the ticker box (each
// keystroke re-renders App) costs about the same with one expiration on the Desk as with every expiration of SPY
// (thousands of rows). Before the memo the cost grew with the rows (about 75 ms a keystroke with all of SPY against
// about 10 ms with one). Also checks that the sections still toggle after the change.
// Run: `bun run test:e2e`.
// ============================================================================

/** Median ms from a keydown in the ticker box to the frame after it, over `n` keystrokes. */
async function keystrokeMedian(page: Page, n: number): Promise<number> {
    await page.evaluate(() => {
        const w = window as unknown as { __lat: number[]; __latOn?: boolean };
        w.__lat = [];
        if (w.__latOn) return;
        w.__latOn = true;
        document.querySelector('input[role=combobox]')?.addEventListener('keydown', () => {
            const t0 = performance.now();
            requestAnimationFrame(() => setTimeout(() => w.__lat.push(performance.now() - t0), 0));
        }, true);
    });
    const ticker = page.locator('input[role=combobox]');
    await ticker.click();
    for (let i = 0; i < n; i++) {
        await page.keyboard.type('Q');
        await page.waitForTimeout(200);
    }
    await ticker.fill('');
    await page.keyboard.press('Escape');
    const lat = (await page.evaluate(() => (window as unknown as { __lat: number[] }).__lat)).sort((a, b) => a - b);
    return lat[Math.floor(lat.length / 2)];
}

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(site.url);
        await page.getByText('💾').first().click(); // CACHE provider
        const ticker = page.locator('input[role=combobox]');
        await ticker.fill('SPY');
        await ticker.press('Enter');
        await page.waitForTimeout(2500);
        const oneRows = await page.locator('.od-drow').count();
        const one = await keystrokeMedian(page, 15);

        await page.getByRole('button', { name: /^(All|Все)$/ }).first().click();
        await page.waitForTimeout(3500);
        const allRows = await page.locator('.od-drow').count();
        assert.ok(allRows > oneRows * 5, `every expiration loaded (${allRows} rows vs ${oneRows})`);
        const all = await keystrokeMedian(page, 15);
        console.log(`keystroke median: ${one.toFixed(1)} ms with ${oneRows} rows, ${all.toFixed(1)} ms with ${allRows} rows`);
        assert.ok(all < one * 2 + 15, `a keystroke must not re-render every row: ${all.toFixed(1)} ms with ${allRows} rows vs ${one.toFixed(1)} ms with ${oneRows}`);

        // the sections still toggle: collapse the first one, expand it again
        const bar = page.locator('.od-bar').first();
        await bar.click();
        await page.waitForTimeout(400);
        assert.equal(await bar.getAttribute('aria-expanded'), 'false', 'the first section collapses');
        await bar.click();
        await page.waitForTimeout(600);
        assert.equal(await bar.getAttribute('aria-expanded'), 'true', 'and expands again');
        assert.ok((await page.locator('.od-atm').count()) >= 1, 'an ATM row is shown');
        console.log('desk memo e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
