/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium } from 'playwright';
import { noProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the tooltips (owner 2026-10-25: two tooltips at once read as a bug). On every tab no element that
// opens the app's own animated tooltip (aria-describedby -> role=tooltip) carries a native `title`, and nothing inside
// it does either (the colour swatches and the mode switches of the chips), and no element anywhere keeps a native
// `title` (owner: the app's tooltip everywhere). Hovering the Zero GEX chip shows exactly
// its own tooltip with the strike rule. Run: `bun run test:e2e`.
// ============================================================================

/**
 * Every element of the page that carries a native `title` attribute, as `<tag> "title"`. The one exception is the
 * TradingView logo link that lightweight-charts itself draws on the Chart tab (`attributionLogo`): library markup, not ours.
 */
const nativeTitles = (): Promise<string[]> => page0!.evaluate(() =>
    Array.from(document.querySelectorAll('[title]'))
        .filter((e) => !(e.tagName === 'A' && (e.getAttribute('href') ?? '').includes('tradingview.com')))
        .map((e) => `<${e.tagName.toLowerCase()}> "${e.getAttribute('title')}"`));
let page0: import('playwright').Page | null = null;

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page0 = page;
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await noProxy(page); // no local proxy: the app uses the CACHE provider by itself
        await page.goto(site.url);
        const ticker = page.locator('input[role=combobox]');
        await ticker.fill('SPY');
        await ticker.press('Enter');
        await page.waitForTimeout(2500);
        for (const tab of ['Desk', 'Board', 'GEX', 'Chart']) {
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
            // owner 2026-10-25: one tooltip style everywhere, so no element at all keeps a native `title`
            assert.deepEqual(await nativeTitles(), [], `${tab}: elements with a native title`);
        }
        // the open settings menu too
        await page.locator('button[aria-label="Settings"]').click();
        await page.waitForTimeout(400);
        assert.deepEqual(await nativeTitles(), [], 'settings menu: elements with a native title');
        await page.keyboard.press('Escape');
        await page.locator('body').click({ position: { x: 5, y: 600 } });
        // a hovered Desk header cell shows its full column name in the app's tooltip
        await page.getByRole('button', { name: 'Desk', exact: true }).first().click();
        await page.waitForTimeout(800);
        const header = page.locator('.od-labels > div').first().locator('span').first();
        await header.hover();
        await page.waitForTimeout(400);
        const headerTip = page.locator(`[id="${(await header.getAttribute('aria-describedby')) ?? ''}"]`);
        assert.equal(await headerTip.getAttribute('role'), 'tooltip', 'the Desk header cell has the app tooltip');
        assert.equal(await headerTip.evaluate((e) => getComputedStyle(e).opacity), '1', 'and it is shown on hover');
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
