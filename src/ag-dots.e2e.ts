/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium } from 'playwright';
import { noProxy, startTestSite } from './e2e-site';
import { AG_DOT_HOVER_RING } from './gex-colors';

// ============================================================================
// Browser check of the Absolute Gamma dots on the GEX chart (owner 2026-10-25, "AG dots v3"): a hollow ring at every
// strike, stroke in the AG line colour (the computed AG path stroke, so a custom colour is followed), fill none, r 3.5,
// stroke 1.5-2 px; the hovered ring is larger and takes the theme's hover token (gex-colors.ts AG_DOT_HOVER_RING).
// Both themes. Run: `bun run test:e2e ag-dots`.
// ============================================================================

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        for (const scheme of ['light', 'dark'] as const) {
            const hover = AG_DOT_HOVER_RING[scheme];
            const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })).newPage();
            await noProxy(page); // no local proxy: the app uses the CACHE provider by itself
            await page.goto(site.url);
            const ticker = page.locator('input[role=combobox]');
            await ticker.fill('SPY');
            await ticker.press('Enter');
            await page.waitForTimeout(2500);
            await page.getByRole('button', { name: 'GEX' }).first().click();
            await page.waitForTimeout(1200);
            const read = () => page.locator('[data-ag-dot]').evaluateAll((els) => els.map((e) => ({ kind: e.getAttribute('data-ag-dot'), fill: e.getAttribute('fill'), stroke: e.getAttribute('stroke'), width: Number(e.getAttribute('stroke-width')), r: Number(e.getAttribute('r')) })));
            const dots = await read();
            assert.ok(dots.length > 10, `${scheme}: a ring at every strike (${dots.length})`);
            const line = await page.locator('.recharts-area-curve').first().getAttribute('stroke');
            assert.ok(line, `${scheme}: the AG line is on the chart`);
            assert.ok(dots.every((d) => d.kind === 'ring' && d.fill === 'none'), `${scheme}: every dot is a hollow ring: ${Array.from(new Set(dots.map((d) => d.fill))).join(', ')}`);
            assert.ok(dots.every((d) => d.stroke === line), `${scheme}: every ring is the AG line colour ${line}: ${Array.from(new Set(dots.map((d) => d.stroke))).join(', ')}`);
            assert.ok(dots.every((d) => d.r === 3.5 && d.width >= 1.5 && d.width <= 2), `${scheme}: r 3.5, stroke 1.5-2 px`);

            // ---- hover: the active dot has the theme's hover ring (no hard-coded white) ----
            const box = await page.locator('.recharts-wrapper').first().boundingBox();
            assert.ok(box, `${scheme}: the chart is on the page`);
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.waitForTimeout(400);
            const active = (await read()).filter((d) => d.kind === 'active');
            assert.ok(active.length >= 1, `${scheme}: there is a hovered ring`);
            assert.ok(active.every((d) => d.stroke === hover && d.fill === 'none' && d.r === 5.5), `${scheme}: the hovered ring is larger, hollow, stroke ${hover}`);
            console.log(`ag-dots e2e ${scheme}: ${dots.length} rings ${line}, hover ring ${hover}: ok`);
            await page.context().close();
        }
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => { console.error(err); process.exitCode = 1; });
