/// <reference types="node" />
/// <reference types="bun" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of custom levels on the GEX tab and the strike snapping: a right click
// (the same event a two-finger click on a trackpad sends) picks the nearest strike,
// Ctrl+click does it on macOS (checked with an emulated Mac, the result of Ctrl+click on a real
// non-Mac host differs by platform and is not asserted), the same strike again edits or deletes the level,
// the Chart tab also puts a level on a strike. Run: `bun run test:e2e`.
// ============================================================================

const KEY = 'gex.customLevels.v1.SPY';
const strikes = new Set<number>((JSON.parse(readFileSync(join(import.meta.dir, '..', 'api', 'options', 'SPY.json'), 'utf8')).quotes as Array<{ strike: number }>).map((q) => q.strike));
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const site = await startTestSite();
const browser: Browser = await chromium.launch();

async function open(mac: boolean): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, ...(mac ? { userAgent: MAC_UA } : {}) });
    if (mac) {
        // what a Mac reports: the app reads navigator.userAgentData first, then navigator.platform
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
            Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
        });
    }
    const page = await context.newPage();
    await page.goto(site.url);
    await page.getByText('💾').first().click(); // CACHE provider
    const ticker = page.locator('input[role=combobox]');
    await ticker.fill('SPY');
    await ticker.press('Enter');
    await page.waitForTimeout(2500);
    return page;
}

const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]') as Array<{ name: string; price: number }>, KEY);
const editor = (page: Page) => page.locator('input[aria-label^="Level name"]');
const button = (page: Page, label: string) => page.locator(`button[aria-label^="${label}"]`);

/** A point inside the plot of the GEX chart; the pointer is moved there first, like a user's hand before the click. */
async function gexPoint(page: Page) {
    const box = (await page.locator('.recharts-wrapper').first().boundingBox())!;
    const p = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.45 };
    await page.mouse.move(p.x - 20, p.y);
    await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.waitForTimeout(250);
    return p;
}

try {
    // ---- GEX tab: right click picks the strike under the pointer ----
    {
        const page = await open(false);
        await page.getByRole('button', { name: 'GEX' }).first().click();
        await page.waitForTimeout(2000);
        const p = await gexPoint(page);
        await page.mouse.click(p.x, p.y, { button: 'right' });
        assert.equal(await editor(page).inputValue(), 'Level 1', 'the editor opens on the GEX tab');
        await page.keyboard.type('Wall');
        await page.keyboard.press('Enter');
        const [level] = await stored(page);
        assert.equal(level.name, 'Wall');
        assert.ok(strikes.has(level.price), `the level sits on a strike, not between two: ${level.price}`);
        assert.ok(await page.getByText('Wall').first().isVisible(), 'the level shows in the Levels table');

        // the same strike again edits the level, cancel keeps it, delete removes it
        await page.mouse.click(p.x, p.y, { button: 'right' });
        assert.equal(await editor(page).inputValue(), 'Wall');
        await button(page, 'Cancel').click();
        assert.equal((await stored(page)).length, 1, 'cancel keeps the level');
        await page.mouse.click(p.x, p.y, { button: 'right' });
        await button(page, 'Delete level').click();
        assert.equal((await stored(page)).length, 0, 'delete removes it');

        // a right click outside the plot leaves the browser menu alone (no editor)
        const wrapper = (await page.locator('.recharts-wrapper').first().boundingBox())!;
        await page.mouse.move(wrapper.x + 2, wrapper.y + 2);
        await page.mouse.click(wrapper.x + 2, wrapper.y + 2, { button: 'right' });
        assert.equal(await editor(page).count(), 0, 'no editor outside the plot');

        // the help (?) of the GEX chart mentions the custom levels
        await page.locator('button[aria-label="Chart controls"]').first().hover();
        assert.ok(await page.getByText('Add your own level: right click a strike').first().isVisible(), 'the ? help explains the custom level');
        await page.context().close();
    }

    // ---- macOS: Ctrl+click works on both tabs, and the Chart tab snaps to a strike ----
    {
        const page = await open(true);
        await page.getByRole('button', { name: 'GEX' }).first().click();
        await page.waitForTimeout(2000);
        const p = await gexPoint(page);
        await page.keyboard.down('Control');
        await page.mouse.click(p.x, p.y);
        await page.keyboard.up('Control');
        assert.equal(await editor(page).inputValue(), 'Level 1', 'Ctrl+click opens the editor on macOS (GEX tab)');
        await page.keyboard.press('Escape');
        assert.equal((await stored(page)).length, 0, 'Esc creates nothing');

        await page.getByRole('button', { name: 'Chart' }).first().click();
        await page.waitForTimeout(1500);
        const box = (await page.locator('canvas').first().boundingBox())!;
        const at = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.5 };
        await page.mouse.move(at.x, at.y);
        await page.keyboard.down('Control');
        await page.mouse.click(at.x, at.y);
        await page.keyboard.up('Control');
        assert.equal(await editor(page).inputValue(), 'Level 1', 'Ctrl+click opens the editor on macOS (Chart tab)');
        await page.keyboard.press('Enter');
        const [chartLevel] = await stored(page);
        assert.ok(strikes.has(chartLevel.price), `a click on the chart picks the nearest strike: ${chartLevel.price}`);

        // the help (?) of the Chart tab explains it
        await page.locator('button[aria-label="Chart help"]').first().hover();
        assert.ok(await page.getByText('Add your own level: right click the chart').first().isVisible(), 'the ? help of the Chart tab explains the custom level');
        await page.context().close();
    }
    console.log('custom levels on the GEX tab e2e: ok');
} finally {
    await browser.close();
    site.close();
}
