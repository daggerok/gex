/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Page } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the ONE source of truth for the sign colours (owner, 2026-10-25): a custom Net GEX (+) colour set in the
// Metrics panel reaches the GEX bars, the Chart tab candles and the Board peak dots, and the Metrics panel's Reset brings
// the default green and red back to all of them (nothing keeps a stale colour). Run: `bun run test:e2e`.
// ============================================================================

const CUSTOM = '#38bdf8';
const GREEN = '#22c55e';
const RED = '#ef4444';
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

async function tab(page: Page, name: string): Promise<void> {
    await page.getByRole('button', { name, exact: true }).first().click();
    await page.waitForTimeout(1500);
}

/** The colours in use: GEX bar fills, the candle colours of the Chart tab, the Board dot colours, the CSS variables. */
async function colorsInUse(page: Page): Promise<{ bars: string[]; candleUp: string; candleDown: string; dots: string[]; vars: string[] }> {
    await tab(page, 'GEX');
    const bars = await page.locator('.recharts-bar-rectangle path').evaluateAll((els) => Array.from(new Set(els.map((e) => (e.getAttribute('fill') ?? '').toLowerCase()))));
    const vars = await page.evaluate(() => ['--gex-pos', '--gex-neg'].map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim().toLowerCase()));
    await tab(page, 'Chart');
    const chart = page.locator('[data-candle-up]').first();
    const candleUp = ((await chart.getAttribute('data-candle-up')) ?? '').toLowerCase();
    const candleDown = ((await chart.getAttribute('data-candle-down')) ?? '').toLowerCase();
    await tab(page, 'Board');
    const dots = await page.locator('[data-board-dot]').evaluateAll((els) => Array.from(new Set(els.map((e) => getComputedStyle(e).backgroundColor))));
    return { bars, candleUp, candleDown, dots, vars };
}

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(site.url);
        await page.getByText('💾').first().click(); // CACHE provider
        const ticker = page.locator('input[role=combobox]');
        await ticker.fill('SPY');
        await page.waitForTimeout(300);
        await ticker.press('Escape');
        await ticker.press('Enter');
        await page.waitForTimeout(2500);

        const before = await colorsInUse(page);
        assert.ok(before.bars.includes(GREEN), `default: green bars (${before.bars.join(', ')})`);
        assert.equal(before.candleUp, GREEN, 'default: green bull candles');
        assert.equal(before.candleDown, RED, 'default: red bear candles');
        assert.ok(before.dots.includes(rgb(GREEN)), `default: green Board dots (${before.dots.join(', ')})`);
        assert.deepEqual(before.vars, [GREEN, RED], 'default: the CSS variables');

        // a custom positive colour, set where the user sets it: the Net GEX (+) swatch of the Metrics panel
        await tab(page, 'GEX');
        await page.locator('input[aria-label="Net GEX (+) color"]').fill(CUSTOM);
        await page.waitForTimeout(500);
        const custom = await colorsInUse(page);
        assert.ok(custom.bars.includes(CUSTOM) && !custom.bars.includes(GREEN), `custom: the bars (${custom.bars.join(', ')})`);
        assert.equal(custom.candleUp, CUSTOM, 'custom: the bull candles');
        assert.equal(custom.candleDown, RED, 'custom: the bear candles keep red');
        assert.ok(custom.dots.includes(rgb(CUSTOM)) && !custom.dots.includes(rgb(GREEN)), `custom: the Board dots (${custom.dots.join(', ')})`);
        assert.deepEqual(custom.vars, [CUSTOM, RED], 'custom: the CSS variables');

        // Reset of the Metrics panel: green and red everywhere again
        await tab(page, 'GEX');
        await page.locator('[role=group][aria-label="Metrics"]').getByRole('button', { name: 'Reset', exact: true }).click();
        await page.waitForTimeout(500);
        const reset = await colorsInUse(page);
        assert.ok(reset.bars.includes(GREEN) && !reset.bars.includes(CUSTOM), `reset: the bars (${reset.bars.join(', ')})`);
        assert.equal(reset.candleUp, GREEN, 'reset: the bull candles');
        assert.ok(reset.dots.includes(rgb(GREEN)) && !reset.dots.includes(rgb(CUSTOM)), `reset: the Board dots (${reset.dots.join(', ')})`);
        assert.deepEqual(reset.vars, [GREEN, RED], 'reset: the CSS variables');
        assert.deepEqual(errors, [], 'no page errors');
        console.log('sign colours e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
