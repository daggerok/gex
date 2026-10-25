/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Locator, type Page } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the mode switches inside the panel chips (src/components/ChipSwitch.tsx). For each switch: a click on it
// changes the mode but NOT whether the metric or level is on, the chip keeps exactly the same width (no layout jump), the
// chart shows the new mode, and the choice comes back after a reload.
//  - Net GEX metric: "Net GEX" <-> "GEX" (call GEX up, put GEX down), legend "Net GEX (+)" <-> "GEX (+)"
// Run: `bun run test:e2e`.
// ============================================================================

const chipOf = (switchEl: Locator) => switchEl.locator('xpath=ancestor::*[@role="button"][1]');

async function width(l: Locator): Promise<number> {
    const box = await l.boundingBox();
    assert.ok(box, 'the chip is on screen');
    return Math.round(box.width * 10) / 10;
}

async function loadSpy(page: Page): Promise<void> {
    await page.getByText('💾').first().click(); // CACHE provider
    const ticker = page.locator('input[role=combobox]');
    await ticker.fill('SPY');
    await ticker.press('Enter');
    await page.waitForTimeout(2500);
}

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        for (const vw of [1440, 390]) {
            const page = await browser.newPage({ viewport: { width: vw, height: 900 } });
            await page.goto(site.url);
            await loadSpy(page);
            await page.getByRole('button', { name: 'GEX' }).first().click();
            await page.waitForTimeout(1200);

            // ---- Net GEX / GEX ----
            const sw = page.getByRole('switch', { name: /call GEX and put GEX/ }).first();
            const chip = chipOf(sw);
            assert.equal(await sw.getAttribute('aria-checked'), 'false', 'Net GEX view by default');
            assert.equal(await chip.getAttribute('aria-pressed'), 'true', 'Net GEX metric on by default');
            const legend = () => page.locator('.recharts-legend-wrapper').first().innerText();
            assert.match(await legend(), /Net GEX \(\+\)/, 'legend in the net view');
            const before = await width(chip);
            await sw.click();
            await page.waitForTimeout(400);
            assert.equal(await sw.getAttribute('aria-checked'), 'true', 'the switch is on');
            assert.equal(await chip.getAttribute('aria-pressed'), 'true', 'the switch does not turn the metric off');
            assert.equal(await width(chip), before, `the chip keeps its width at ${vw}px`);
            const text = await legend();
            assert.match(text, /GEX \(\+\)/, 'legend GEX (+)');
            assert.ok(!/Net GEX/.test(text), `no "Net GEX" in the split legend: ${text}`);
            await page.reload();
            await loadSpy(page);
            await page.getByRole('button', { name: 'GEX' }).first().click();
            await page.waitForTimeout(1200);
            assert.equal(await page.getByRole('switch', { name: /call GEX and put GEX/ }).first().getAttribute('aria-checked'), 'true', 'the split view is remembered');
            await page.getByRole('switch', { name: /call GEX and put GEX/ }).first().click();
            await page.close();
        }
        console.log('chip switch e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
