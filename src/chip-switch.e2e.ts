/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Locator, type Page } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the mode switches inside the panel chips (src/components/ChipSwitch.tsx). For each switch: a click on it
// changes the mode but NOT whether the metric or level is on, the chip keeps exactly the same width (no layout jump), the
// chart shows the new mode, and the choice comes back after a reload.
//  - Net GEX metric: "Net GEX" <-> "Abs GEX" (call GEX up, put GEX down), legend "Net GEX (+)" <-> "Abs GEX (+)"
//  - Zero GEX level: line <-> area (a band over the two strikes of the zone on the GEX chart)
//  - Sigma level: off by default (no lines, no table rows), % <-> statistical sigma, label "Sigma %" <-> "Sigma σ"
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
            const netLegend = await legend();
            assert.match(netLegend, /Net GEX \(\+\)/, 'legend in the net view');
            const before = await width(chip);
            await sw.click();
            await page.waitForTimeout(400);
            assert.equal(await sw.getAttribute('aria-checked'), 'true', 'the switch is on');
            assert.equal(await chip.getAttribute('aria-pressed'), 'true', 'the switch does not turn the metric off');
            assert.equal(await width(chip), before, `the chip keeps its width at ${vw}px`);
            const text = await legend();
            assert.match(text, /Abs GEX \(\+\)/, 'legend Abs GEX (+)');
            assert.match(await chip.innerText(), /Abs GEX/, 'the chip reads Abs GEX');
            assert.ok(!/Net GEX/.test(text), `no "Net GEX" in the split legend: ${text}`);
            // the same positions in both views (Absolute Gamma, (+), (−)), only the words change
            assert.equal(text, netLegend.replace(/Net GEX/g, 'Abs GEX'), `the split legend keeps the net order:\n${netLegend}\nvs\n${text}`);
            const at = (t: string, s: string) => t.indexOf(s);
            assert.ok(at(text, 'Absolute Gamma') >= 0 && at(text, 'Absolute Gamma') < at(text, 'Abs GEX (+)') && at(text, 'Abs GEX (+)') < at(text, 'Abs GEX (−)'), `legend order: ${text}`);
            await page.reload();
            await loadSpy(page);
            await page.getByRole('button', { name: 'GEX' }).first().click();
            await page.waitForTimeout(1200);
            assert.equal(await page.getByRole('switch', { name: /call GEX and put GEX/ }).first().getAttribute('aria-checked'), 'true', 'the split view is remembered');
            await page.getByRole('switch', { name: /call GEX and put GEX/ }).first().click();

            // ---- Zero GEX line / area (a level chip of the Levels panel) ----
            const zsw = page.getByRole('switch', { name: /Zero GEX/ }).first();
            const zchip = chipOf(zsw);
            assert.equal(await zsw.getAttribute('aria-checked'), 'false', 'Zero GEX is a line by default');
            assert.equal(await zchip.getAttribute('aria-pressed'), 'true', 'Zero GEX is on by default');
            const band = page.locator('.recharts-reference-area [fill="#d946ef"]');
            assert.equal(await band.count(), 0, 'no band while it is a line');
            // the cached SPY chain changes every hour: the band needs a sign change of the per-strike Net GEX
            // the Levels table of the sidebar: a row of a label and a strike ("-" without a value)
            const hasLevel = await page.evaluate(() => {
                const label = Array.from(document.querySelectorAll('aside span')).find((s) => s.textContent?.trim() === 'Zero GEX');
                const value = label?.parentElement?.lastElementChild?.textContent ?? '';
                return /\d/.test(value);
            });
            const zBefore = await width(zchip);
            await zsw.scrollIntoViewIfNeeded();
            await zsw.click();
            await page.waitForTimeout(400);
            assert.equal(await zsw.getAttribute('aria-checked'), 'true', 'the Zero GEX switch is on');
            assert.equal(await zchip.getAttribute('aria-pressed'), 'true', 'the switch does not hide the level');
            assert.equal(await width(zchip), zBefore, `the Zero GEX chip keeps its width at ${vw}px`);
            if (hasLevel) assert.equal(await band.count(), 1, 'the Zero GEX band is drawn on the GEX chart');
            else console.log('chip switch e2e: the cached SPY chain has no Zero GEX right now, band not checked');
            await page.reload();
            await loadSpy(page);
            await page.getByRole('button', { name: 'GEX' }).first().click();
            await page.waitForTimeout(1200);
            assert.equal(await page.getByRole('switch', { name: /Zero GEX/ }).first().getAttribute('aria-checked'), 'true', 'the area display is remembered');

            // ---- Sigma % / statistical (a level chip, OFF by default) ----
            const ssw = page.getByRole('switch', { name: /Statistical sigma/ }).first();
            const schip = chipOf(ssw);
            const sigmaRows = () => page.evaluate(() => Array.from(document.querySelectorAll('aside span')).filter((s) => /^Sigma [+−]\dσ$/.test(s.textContent?.trim() ?? '')).length);
            const sigmaLines = page.locator('.recharts-reference-line line[stroke="#64748b"]');
            assert.equal(await schip.getAttribute('aria-pressed'), 'false', 'Sigma is off by default');
            assert.equal(await sigmaRows(), 0, 'no Sigma rows in the Levels table while it is off');
            assert.equal(await sigmaLines.count(), 0, 'no Sigma lines on the GEX chart while it is off');
            await schip.scrollIntoViewIfNeeded();
            await schip.click();
            await page.waitForTimeout(400);
            assert.equal(await schip.getAttribute('aria-pressed'), 'true', 'a click on the chip turns Sigma on');
            assert.equal(await sigmaRows(), 6, 'six Sigma rows in the Levels table');
            assert.ok((await sigmaLines.count()) >= 1, 'Sigma lines on the GEX chart');
            assert.match(await schip.innerText(), /Sigma %/, 'the % mode first');
            const sBefore = await width(schip);
            await ssw.click();
            await page.waitForTimeout(400);
            assert.equal(await ssw.getAttribute('aria-checked'), 'true', 'statistical mode on');
            assert.equal(await schip.getAttribute('aria-pressed'), 'true', 'the switch does not hide Sigma');
            assert.equal(await width(schip), sBefore, `the Sigma chip keeps its width at ${vw}px`);
            assert.match(await schip.innerText(), /Sigma σ/, 'the label names the statistical mode');
            await page.reload();
            await loadSpy(page);
            await page.getByRole('button', { name: 'GEX' }).first().click();
            await page.waitForTimeout(1200);
            assert.equal(await page.getByRole('switch', { name: /Statistical sigma/ }).first().getAttribute('aria-checked'), 'true', 'the Sigma mode is remembered');
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
