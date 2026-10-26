/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Page } from 'playwright';
import { noProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of review GEX-H11: the Desk's expiration sections are memoized, so typing in the ticker box (each
// keystroke re-renders App) costs about the same with one expiration on the Desk as with every expiration of SPY
// (thousands of rows). Before the memo the cost grew with the rows (about 75 ms a keystroke with all of SPY against
// about 10 ms with one). Also checks that the sections still toggle after the change.
// A slow or busy CI runner can make one round of keystrokes slow by chance (2026-10-26: 44.7 ms vs 12.9 ms once), so the
// all-expirations side is measured up to ROUNDS times and the best round counts: a real regression (every row re-rendered,
// ~7x the one-expiration cost) fails every round, noise does not. Run: `bun run test:e2e`.
// ============================================================================

/** Rounds of keystrokes on the all-expirations desk before the budget fails (the best round counts). */
const ROUNDS = 3;
/** The all-expirations keystroke may cost this much more than the one-expiration one: 2x + 15 ms of noise floor. */
const withinBudget = (all: number, one: number): boolean => all < one * 2 + 15;

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
        await noProxy(page); // no local proxy: the app uses the CACHE provider by itself
        await page.goto(site.url);
        const ticker = page.locator('input[role=combobox]');
        await ticker.fill('SPY');
        await ticker.press('Enter');
        await page.locator('.od-drow.od-atm').first().waitFor({ timeout: 30000 });
        await page.waitForTimeout(1000); // the rows fade in
        const oneRows = await page.locator('.od-drow').count();
        const one = await keystrokeMedian(page, 15);

        await page.getByRole('button', { name: /^(All|Все)$/ }).first().click();
        await page.waitForFunction((n) => document.querySelectorAll('.od-drow').length > n * 5, oneRows, { timeout: 30000 });
        await page.waitForTimeout(1500); // the rows fade in
        const allRows = await page.locator('.od-drow').count();
        assert.ok(allRows > oneRows * 5, `every expiration loaded (${allRows} rows vs ${oneRows})`);
        const rounds: number[] = [];
        while (rounds.length < ROUNDS && !rounds.some((all) => withinBudget(all, one))) rounds.push(await keystrokeMedian(page, 15));
        const all = Math.min(...rounds);
        console.log(`keystroke median: ${one.toFixed(1)} ms with ${oneRows} rows, ${rounds.map((r) => r.toFixed(1)).join(' / ')} ms with ${allRows} rows`);
        assert.ok(withinBudget(all, one), `a keystroke must not re-render every row: ${all.toFixed(1)} ms (best of ${rounds.length}) with ${allRows} rows vs ${one.toFixed(1)} ms with ${oneRows}`);

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
