/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the tooltips (owner 2026-10-25: two tooltips at once read as a bug). On every tab no element that
// opens the app's own animated tooltip (aria-describedby -> role=tooltip) carries a native `title`, and nothing inside
// it does either (the colour swatches and the mode switches of the chips). Hovering the Zero GEX chip shows exactly
// its own tooltip with the strike rule. Run: `bun run test:e2e`.
// ============================================================================

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
        await ticker.press('Enter');
        await page.waitForTimeout(2500);
        for (const tab of ['Desk', 'GEX', 'Chart']) {
            await page.getByRole('button', { name: tab, exact: true }).first().click();
            await page.waitForTimeout(1200);
            const doubled = await page.evaluate(() => {
                const out: string[] = [];
                document.querySelectorAll('[aria-describedby]').forEach((el) => {
                    const target = document.getElementById(el.getAttribute('aria-describedby') ?? '');
                    if (target?.getAttribute('role') !== 'tooltip' || (el as HTMLElement).offsetParent === null) return;
                    const withTitle = [el, ...Array.from(el.querySelectorAll('[title]'))].filter((x) => x.hasAttribute('title'));
                    withTitle.forEach((x) => out.push(`${(el.textContent ?? '').trim().slice(0, 30)} -> <${x.tagName.toLowerCase()} title="${x.getAttribute('title')}">`));
                });
                return out;
            });
            assert.deepEqual(doubled, [], `${tab}: native titles under an element with the app's tooltip:\n${doubled.join('\n')}`);
        }
        // the Zero GEX chip: its own tooltip opens on hover and states the strike rule
        await page.getByRole('button', { name: 'GEX', exact: true }).first().click();
        await page.waitForTimeout(800);
        const chip = page.getByRole('button', { name: /Zero GEX/ }).first();
        await chip.scrollIntoViewIfNeeded();
        await chip.hover();
        await page.waitForTimeout(400);
        const tipId = (await chip.getAttribute('aria-describedby')) ?? '';
        const tip = page.locator(`[id="${tipId}"]`);
        assert.equal(await tip.evaluate((e) => getComputedStyle(e).opacity), '1', 'the Zero GEX tooltip is shown on hover');
        const text = await tip.innerText();
        assert.ok(/LEFT \(lower\) strike/.test(text) && /RIGHT \(upper\)/.test(text) && /switch on the left/.test(text) && /highest average Absolute Gamma/.test(text), `Zero GEX tooltip: ${text}`);
        assert.equal(await chip.getAttribute('title'), null, 'no native title on the chip');
        assert.deepEqual(errors, [], 'no page errors');
        console.log('tooltip e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
