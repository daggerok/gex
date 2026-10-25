/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the Absolute Gamma dots on the GEX chart (owner 2026-10-25): every dot is the AG colour, except on a
// strike whose Net GEX is negative, where it is the Net GEX (-) colour. SPY from the cache has strikes of both signs.
// Run: `bun run test:e2e ag-dots`.
// ============================================================================

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
        await page.getByRole('button', { name: 'GEX' }).first().click();
        await page.waitForTimeout(1200);
        const dots = await page.locator('[data-ag-dot]').evaluateAll((els) => els.map((e) => ({ sign: e.getAttribute('data-ag-dot'), fill: e.getAttribute('fill') })));
        const neg = dots.filter((d) => d.sign === 'neg');
        const pos = dots.filter((d) => d.sign === 'pos');
        assert.ok(neg.length > 0 && pos.length > 0, `dots of both signs (${neg.length} negative, ${pos.length} other)`);
        const negFill = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gex-neg').trim());
        assert.ok(neg.every((d) => d.fill === negFill), `negative Net GEX dots are ${negFill}: ${Array.from(new Set(neg.map((d) => d.fill))).join(', ')}`);
        const posFills = Array.from(new Set(pos.map((d) => d.fill)));
        assert.equal(posFills.length, 1, `the other dots share one colour: ${posFills.join(', ')}`);
        assert.notEqual(posFills[0], negFill, 'the other dots are not red');
        console.log(`ag-dots e2e: ${neg.length} red, ${pos.length} ${posFills[0]}: ok`);
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => { console.error(err); process.exitCode = 1; });
