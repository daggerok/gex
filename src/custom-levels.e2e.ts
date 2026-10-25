/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Locator, type Page } from 'playwright';
import { defaultLevelName } from './custom-levels';
import { startTestSite } from './e2e-site';

// The default name of a new level is Buyside above the current price and Sellside below it (then Buyside 2...): the same function
// the app uses decides what to expect, the price comes from the label of the editor, the spot from the cache file
const SPOT = JSON.parse(readFileSync(join(__dirname, '..', 'api', 'options', 'SPY.json'), 'utf8')).underlyingPrice as number;
const NAMES = { above: 'Buyside', below: 'Sellside', plain: 'Level' };
const priceOfEditor = async (input: Locator) => Number(((await input.getAttribute('aria-label')) ?? '').match(/at ([\d.,]+)/)![1].replace(/,/g, ''));
const expectedName = async (input: Locator, used: Array<{ name: string }>) => defaultLevelName(used, await priceOfEditor(input), SPOT, NAMES);


// ============================================================================
// Browser check of the Chart tab custom levels (headless Chromium, CACHE
// provider, SPY): add, default names, cancel, drag, edit, delete, GEX tab.
// Run: `bun run test:e2e` (needs `bunx playwright install chromium` once).
// Exits non-zero on the first failed assertion.
// ============================================================================

const KEY = 'gex.customLevels.v1.SPY';
async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(site.url);
        await page.getByText('💾').first().click(); // CACHE provider
        const ticker = page.locator('input[role=combobox]');
        await ticker.fill('SPY');
        await ticker.press('Enter');
        await page.waitForTimeout(2500);
        await page.getByRole('button', { name: 'Chart' }).first().click();
        await page.waitForTimeout(1500);

        const box = (await page.locator('canvas').first().boundingBox())!;
        const at = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.5 };
        const name = page.locator('input[aria-label^="Level name"]');
        const stored = async (): Promise<Array<{ name: string; price: number }>> =>
            JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY)) ?? '[]');
        const rightClick = (x: number, y: number) => page.mouse.click(x, y, { button: 'right' });
        const button = (label: string) => page.locator(`button[aria-label^="${label}"]`);

        // add: default name is selected, Enter saves
        await rightClick(at.x, at.y);
        const first = await name.inputValue();
        assert.match(first, /^(Buyside|Sellside)$/, 'a new level is named after its side of the price');
        assert.equal(first, await expectedName(name, await stored()));
        assert.ok(await name.evaluate((e: HTMLInputElement) => e.selectionStart === 0 && e.selectionEnd === e.value.length), 'default name selected');
        assert.equal(await button('Delete level').count(), 0, 'no delete button while adding');
        await page.keyboard.type('Support');
        await page.keyboard.press('Enter');
        assert.deepEqual((await stored()).map((l) => l.name), ['Support']);

        // a custom name does not use up the default name, it is still free
        await rightClick(at.x - 100, at.y - 80);
        const second = await name.inputValue();
        assert.equal(second, await expectedName(name, await stored()));
        await page.keyboard.press('Enter');
        assert.deepEqual((await stored()).map((l) => l.name), ['Support', second]);
        await rightClick(at.x - 100, at.y - 160);
        assert.equal(await name.inputValue(), await expectedName(name, await stored()), 'the next free name');
        assert.match(await name.inputValue(), /^(Buyside|Sellside)( \d+)?$/);
        await page.keyboard.press('Escape');

        // cancelling while adding creates nothing: Esc, the cancel button, a click away
        const count = (await stored()).length;
        await rightClick(at.x + 300, at.y);
        await page.keyboard.press('Escape');
        await rightClick(at.x + 300, at.y);
        await button('Cancel').click();
        await rightClick(at.x + 300, at.y);
        await page.mouse.click(at.x + 200, at.y + 150);
        await name.waitFor({ state: 'detached', timeout: 2000 }); // it fades out first
        assert.equal(await name.count(), 0, 'editor closed');
        assert.equal((await stored()).length, count, 'nothing created');

        // fade: the editor fades in when it opens, fades out (still on screen for a moment, ignoring the pointer) when it closes
        await rightClick(at.x + 300, at.y);
        const fade = page.locator('[data-fade]');
        await page.waitForFunction(() => document.querySelector('[data-fade]')?.getAttribute('data-fade') === 'in');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-fade]')!).opacity === '1'); // the fade takes a moment
        assert.equal(await fade.evaluate((e) => getComputedStyle(e).opacity), '1', 'faded in');
        await page.keyboard.press('Escape');
        assert.equal(await fade.getAttribute('data-fade'), 'out', 'starts fading out right after Esc');
        assert.equal(await fade.evaluate((e) => getComputedStyle(e).pointerEvents), 'none', 'a closing editor ignores the pointer');
        await fade.waitFor({ state: 'detached', timeout: 2000 });

        // drag Support down, the price changes and is saved on drop
        const before = (await stored())[0].price;
        await page.mouse.move(at.x + 60, at.y);
        await page.mouse.down();
        await page.mouse.move(at.x + 60, at.y + 30, { steps: 5 });
        await page.mouse.move(at.x + 60, at.y + 60, { steps: 5 });
        await page.mouse.up();
        const moved = (await stored())[0].price;
        assert.ok(moved < before, `dragged down: ${before} -> ${moved}`);

        // edit: right click on the line, rename with the check button
        await rightClick(at.x + 60, at.y + 60);
        assert.equal(await name.inputValue(), 'Support');
        await page.keyboard.type('Renamed');
        await button('Save').click();
        assert.deepEqual((await stored()).map((l) => l.name), ['Renamed', second]);

        // edit cancel keeps the level, delete removes it
        await rightClick(at.x + 60, at.y + 60);
        await button('Cancel').click();
        assert.equal((await stored()).length, 2);
        await rightClick(at.x - 100, at.y - 80);
        await button('Delete level').click();
        assert.deepEqual((await stored()).map((l) => l.name), ['Renamed']);

        // the GEX tab shows the level
        await page.getByRole('button', { name: 'GEX' }).first().click();
        await page.waitForTimeout(1500);
        assert.ok(await page.getByText('Renamed').first().isVisible(), 'custom level on the GEX tab');
        assert.deepEqual(errors, [], 'no page errors');
        console.log('custom levels e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
