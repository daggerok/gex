/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium } from 'playwright';
import { startTestSite } from './e2e-site';
import { AG_DOT_COLORS } from './gex-colors';

// ============================================================================
// Browser check of the Absolute Gamma dots on the GEX chart (owner 2026-10-25, "AG dots v2"): a bold dot at every strike,
// dark blue where the strike's Net GEX is >= 0 and light blue where it is negative (gex-colors.ts AG_DOT_COLORS, one
// pair per theme), never the Net GEX (-) red; the hovered dot gets the theme's hover ring. Both themes. SPY from the
// cache has strikes of both signs. Run: `bun run test:e2e ag-dots`.
// ============================================================================

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        for (const scheme of ['light', 'dark'] as const) {
            const tokens = AG_DOT_COLORS[scheme];
            const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })).newPage();
            await page.goto(site.url);
            await page.getByText('💾').first().click(); // CACHE provider
            const ticker = page.locator('input[role=combobox]');
            await ticker.fill('SPY');
            await ticker.press('Enter');
            await page.waitForTimeout(2500);
            await page.getByRole('button', { name: 'GEX' }).first().click();
            await page.waitForTimeout(1200);
            const read = () => page.locator('[data-ag-dot]').evaluateAll((els) => els.map((e) => ({ sign: e.getAttribute('data-ag-dot'), fill: e.getAttribute('fill'), stroke: e.getAttribute('stroke'), r: Number(e.getAttribute('r')) })));
            const dots = await read();
            const neg = dots.filter((d) => d.sign === 'neg');
            const pos = dots.filter((d) => d.sign === 'pos');
            assert.ok(neg.length > 0 && pos.length > 0, `${scheme}: dots of both signs (${neg.length} negative, ${pos.length} other)`);
            assert.ok(neg.every((d) => d.fill === tokens.neg), `${scheme}: negative Net GEX dots are light blue ${tokens.neg}: ${Array.from(new Set(neg.map((d) => d.fill))).join(', ')}`);
            assert.ok(pos.every((d) => d.fill === tokens.pos), `${scheme}: the other dots are dark blue ${tokens.pos}: ${Array.from(new Set(pos.map((d) => d.fill))).join(', ')}`);
            const red = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gex-neg').trim());
            assert.ok(dots.every((d) => d.fill !== red), `${scheme}: no dot is the Net GEX (-) red`);
            assert.ok(dots.every((d) => d.r >= 3.5), `${scheme}: every dot is bold (r >= 3.5)`);

            // ---- hover: the active dot has the theme's hover ring (no hard-coded white) ----
            const box = await page.locator('.recharts-wrapper').first().boundingBox();
            assert.ok(box, `${scheme}: the chart is on the page`);
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.waitForTimeout(400);
            const active = (await read()).filter((d) => d.stroke === tokens.hover);
            assert.ok(active.length >= 1, `${scheme}: the hovered dot has the hover ring ${tokens.hover}`);
            assert.ok(active.every((d) => d.r > 3.5), `${scheme}: the hovered dot is larger`);
            console.log(`ag-dots e2e ${scheme}: ${neg.length} light blue, ${pos.length} dark blue, hover ring ${tokens.hover}: ok`);
            await page.context().close();
        }
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => { console.error(err); process.exitCode = 1; });
