/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Page } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the Desk's ATM row (the strike nearest to spot, owner 2026-10-25): it is tinted with the Spot level
// colour in both themes, "Expand all" brings the ATM row of the FIRST expiration to the vertical middle of the desk, and
// expanding ONE expiration while all are collapsed brings THAT expiration's ATM row there. Run: `bun run test:e2e`.
// ============================================================================

/** Where the ATM row of expiration `exp` sits in the desk's scroll area: 0 = top edge, 1 = bottom edge, null = no row. */
async function atmPlace(page: Page, exp: string): Promise<number | null> {
    return page.evaluate((e) => {
        const box = document.querySelector('.table-container');
        const sec = document.querySelector(`.od-sec[data-exp="${e}"]`);
        const row = sec?.querySelector('.od-drow.od-atm');
        if (!box || !row) return null;
        const b = box.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        return (r.top + r.height / 2 - b.top) / b.height;
    }, exp);
}

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        for (const scheme of ['light', 'dark'] as const) {
            const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })).newPage();
            const errors: string[] = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(site.url);
            await page.getByText('💾').first().click(); // CACHE provider
            const ticker = page.locator('input[role=combobox]');
            await ticker.fill('SPY');
            await ticker.press('Enter');
            await page.waitForTimeout(2500);
            await page.getByRole('button', { name: 'Desk', exact: true }).first().click();
            // the Desk shows the nearest expiration; select a few more so there are sections to collapse and expand
            const chips = page.locator('button[aria-pressed]').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });
            if (await chips.count()) for (let i = 1; i < 4; i++) await chips.nth(i).click().catch(() => {});
            await page.waitForTimeout(2500);
            const exps = await page.locator('.od-sec').evaluateAll((els) => els.map((e) => e.getAttribute('data-exp') ?? ''));
            assert.ok(exps.length >= 2, `several expirations on the desk: ${exps.join(', ')}`);

            // ---- the ATM row carries the Spot colour (amber by default): clearly warmer than the plain rows ----
            const bg = await page.locator('.od-drow.od-atm').first().evaluate((e) => getComputedStyle(e).backgroundColor);
            const plain = await page.locator('.od-drow:not(.od-atm)').first().evaluate((e) => getComputedStyle(e).backgroundColor);
            // color-mix() computes to `color(srgb r g b)` with 0..1 channels, plain colours to `rgb(r, g, b)`
            const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => Number(v) * (c.startsWith('color(') ? 255 : 1));
            const [r, g, b] = rgb(bg);
            assert.ok(r > b + 30 && g > b, `${scheme}: the ATM row is tinted with the Spot amber (${bg}, plain row ${plain})`);
            assert.notEqual(bg, plain, `${scheme}: the ATM row differs from a plain row`);

            // ---- Expand all: the first expiration's ATM row in the middle third ----
            const toggleAll = page.getByRole('button', { name: /Collapse all|Expand all/ });
            if (/Collapse all/.test(await toggleAll.innerText())) await toggleAll.click();
            await page.waitForTimeout(500);
            await page.locator('.table-container').evaluate((e) => { e.scrollTop = 0; });
            await page.getByRole('button', { name: 'Expand all' }).click();
            await page.waitForTimeout(1500);
            const first = await atmPlace(page, exps[0]);
            assert.ok(first !== null && first > 1 / 3 && first < 2 / 3, `${scheme}: after Expand all the first ATM row is in the middle third (at ${first})`);

            // ---- all collapsed, then ONE expiration expanded: its ATM row in the middle third ----
            await page.getByRole('button', { name: 'Collapse all' }).click();
            await page.waitForTimeout(800);
            for (const exp of [exps[0], exps[exps.length - 1], exps[1]]) {
                const bar = page.locator(`.od-sec[data-exp="${exp}"] > button.od-bar`);
                await bar.click();
                await page.waitForTimeout(1500);
                assert.equal(await bar.getAttribute('aria-expanded'), 'true', `${scheme}: ${exp} expanded`);
                const place = await atmPlace(page, exp);
                assert.ok(place !== null && place > 1 / 3 && place < 2 / 3, `${scheme}: after expanding ${exp} alone its ATM row is in the middle third (at ${place})`);
                await page.getByRole('button', { name: /Collapse all/ }).click().catch(async () => { await bar.click(); });
                await page.waitForTimeout(800);
            }
            assert.deepEqual(errors, [], `${scheme}: no page errors`);
            await page.context().close();
        }
        // ---- a ticker loaded on another tab (the Desk is hidden, no height): opening the Desk shows its ATM row in the middle ----
        {
            const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
            await page.goto(site.url);
            await page.getByText('💾').first().click();
            await page.getByRole('button', { name: 'GEX', exact: true }).first().click();
            const ticker = page.locator('input[role=combobox]');
            await ticker.fill('SPY');
            await ticker.press('Enter');
            await page.waitForTimeout(2500);
            await page.getByRole('button', { name: 'Desk', exact: true }).first().click();
            await page.waitForTimeout(1500);
            const exp = await page.locator('.od-sec').first().getAttribute('data-exp');
            const place = exp ? await atmPlace(page, exp) : null;
            assert.ok(place !== null && place > 1 / 3 && place < 2 / 3, `a chain loaded on the GEX tab: the Desk opens with its ATM row in the middle third (at ${place})`);
            await page.close();
        }
        console.log('desk atm e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
