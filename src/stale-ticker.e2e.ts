/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of review GEX-H2: a superseded ticker request must not land. SPY is entered first and its file answers
// late (held back 2 s), QQQ is entered right after it and answers at once. Before the fix SPY's late answer replaced
// QQQ: every tab showed SPY while the input said QQQ, and SPY was saved as the last ticker.
// Run: `bun run test:e2e`.
// ============================================================================

const spotOf = (symbol: string): number =>
    JSON.parse(readFileSync(join(__dirname, '..', 'api', 'options', `${symbol}.json`), 'utf8')).underlyingPrice as number;

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        let held = 0;
        await page.route('**/api/options/SPY.json', async (route) => {
            held++;
            await new Promise((r) => setTimeout(r, 2000));
            await route.continue();
        });
        await page.goto(site.url);
        await page.getByText('💾').first().click(); // CACHE provider
        const ticker = page.locator('input[role=combobox]');
        await ticker.fill('SPY');
        await ticker.press('Enter');
        await page.waitForTimeout(300);
        await ticker.fill('QQQ');
        await ticker.press('Enter');
        await page.waitForTimeout(4000); // well past SPY's late answer
        assert.ok(held >= 1, 'the SPY request was made and held back');

        const lastTicker = await page.evaluate(() => (JSON.parse(localStorage.getItem('gex.settings.v5') ?? '{}') as { lastTicker?: string }).lastTicker);
        assert.equal(lastTicker, 'QQQ', 'the late SPY answer must not be saved as the last ticker');
        assert.equal(await ticker.inputValue(), 'QQQ');
        const text = await page.locator('body').innerText();
        const qqq = spotOf('QQQ').toFixed(2);
        const spy = spotOf('SPY').toFixed(2);
        assert.ok(text.includes(qqq), `the QQQ spot ${qqq} is shown`);
        assert.ok(!text.includes(spy), `the SPY spot ${spy} is not shown`);
        // the superseded request says nothing (no "Request cancelled" notice)
        assert.ok(!/Request cancelled|Запрос отменён/i.test(text), 'no cancel notice for a superseded request');
        console.log('stale ticker e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
