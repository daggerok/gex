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
const PREMIUM: string[] = ['#fb7185', '#f43f5e', '#fda4af'];
const DISCOUNT: string[] = ['#34d399', '#10b981', '#6ee7b7'];
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
        // the sidebar keeps its size whether or not the pointer is over the plot: the Cursor card is always there
        const cardBox = async () => { const r = (await page.getByRole('heading', { name: 'Levels' }).first().boundingBox())!; return [r.x, r.y, r.width, r.height].map(Math.round); };
        const cursorCard = page.getByRole('heading', { name: 'Cursor' });
        assert.equal(await cursorCard.count(), 1, 'the Cursor card is shown while the pointer is over the plot');
        const withCursor = await cardBox();
        const axis = (await page.locator('.recharts-wrapper').first().boundingBox())!;
        await page.mouse.move(axis.x + axis.width * 0.5, axis.y + axis.height + 30); // below the chart, outside the plot
        await page.waitForTimeout(300);
        assert.equal(await cursorCard.count(), 1, 'the Cursor card stays when the pointer leaves the plot');
        assert.deepEqual(await cardBox(), withCursor, 'the Levels card does not move when the pointer leaves the plot');
        await page.mouse.move(p.x, p.y);
        await page.waitForTimeout(200);

        // the three sidebar tables share one row height, and the Cursor list scrolls when the space is smaller than its rows
        const sidebar = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('aside section')).map((sec) => ({
                title: sec.querySelector('h3')?.textContent ?? '',
                heights: [...new Set(Array.from(sec.querySelectorAll('[class*="h-[26px]"]')).map((r) => Math.round(r.getBoundingClientRect().height)))],
            }));
            const list = Array.from(document.querySelectorAll('aside section')).find((sec) => sec.querySelector('h3')?.textContent === 'Cursor')?.querySelector('.themed-scroll');
            return { rows, overflowY: list ? getComputedStyle(list).overflowY : null };
        });
        assert.deepEqual(sidebar.rows.map((r) => r.title), ['Metrics', 'Cursor', 'Levels']);
        for (const r of sidebar.rows) assert.deepEqual(r.heights, [26], `${r.title} rows are 26 px high`);
        assert.equal(sidebar.overflowY, 'auto', 'the Cursor list scrolls instead of growing');

        // the secondary click must not start the zoom range selection (a blue band that followed the pointer)
        await page.mouse.move(p.x + 150, p.y);
        await page.mouse.move(p.x + 260, p.y + 10, { steps: 6 });
        assert.equal(await page.locator('.recharts-reference-area').count(), 0, 'no range selection after a right click');
        await page.mouse.move(p.x, p.y);
        // the proposed colour follows the price: a strike above the spot (778.57 for SPY) is reddish, below it greenish
        const swatchHex = () => page.locator('button[aria-label="Level colour"]').evaluate((e: HTMLElement) => {
            const m = /(\d+), (\d+), (\d+)/.exec(getComputedStyle(e).backgroundColor)!;
            return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
        });
        assert.ok(PREMIUM.includes(await swatchHex()), 'a level above the price starts reddish');
        await page.keyboard.press('Escape');
        const box = (await page.locator('.recharts-wrapper').first().boundingBox())!;
        const low = { x: box.x + box.width * 0.3, y: p.y };
        await page.mouse.move(low.x - 20, low.y);
        await page.mouse.move(low.x, low.y, { steps: 6 });
        await page.waitForTimeout(250);
        await page.mouse.click(low.x, low.y, { button: 'right' });
        assert.ok(DISCOUNT.includes(await swatchHex()), 'a level below the price starts greenish');
        await page.keyboard.press('Escape');
        await gexPoint(page);
        await page.mouse.click(p.x, p.y, { button: 'right' });

        // the editor stays minimal: the colour is one square left of the name, the choices open on a click
        assert.equal(await page.locator('[role=radiogroup]').count(), 0, 'no colour choices until the square is clicked');
        await page.locator('button[aria-label="Level colour"]').click();
        // a colour is proposed (one circle is selected) and can be changed like the name
        const radios = page.locator('[role=radiogroup] [role=radio]');
        assert.equal(await radios.count(), 10, 'ten palette colours');
        assert.equal(await page.locator('[role=radiogroup] [role=radio][aria-checked=true]').count(), 1, 'one colour is proposed');
        const second = (await radios.nth(1).getAttribute('aria-label'))!;
        await radios.nth(1).click();
        assert.equal(await editor(page).count(), 1, 'picking a colour keeps the editor open');
        assert.equal(await page.locator('[role=radiogroup]').count(), 0, 'the choices close after picking');
        assert.equal(await page.locator('button[aria-label="Level colour"]').evaluate((e: HTMLElement) => e.style.backgroundColor !== ''), true, 'the square shows the colour');
        await page.keyboard.type('Wall');
        await page.keyboard.press('Enter');
        const [level] = await stored(page);
        assert.equal(level.name, 'Wall');
        assert.equal((level as { color?: string }).color, second, 'the chosen colour is saved with the level');
        assert.ok(strikes.has(level.price), `the level sits on a strike, not between two: ${level.price}`);
        // the user's levels are on the charts and in the Levels panel, NOT in the Levels and Values tables
        const sidebarText = await page.evaluate(() => Array.from(document.querySelectorAll('aside section')).map((sec) => sec.textContent ?? '').join(' '));
        assert.ok(!sidebarText.includes('Wall'), 'a custom level is not a row of the Levels table');
        assert.ok(await page.locator('.recharts-wrapper svg text', { hasText: 'Wall' }).first().isVisible(), 'the level is labelled on the GEX chart');
        // ... and as the FIRST chip of the Levels panel above the chart (not hidden at the far end of a scrolling row)
        const panel = page.getByRole('group', { name: 'Levels' }).first();
        const firstChip = panel.getByRole('button').first();
        assert.equal((await firstChip.textContent())?.trim(), 'Wall', 'the custom level is the first chip of the Levels panel');
        assert.equal(await firstChip.getAttribute('aria-pressed'), 'true');
        await firstChip.click(); // hide it
        assert.equal((await stored(page))[0] && ((await stored(page))[0] as { hidden?: boolean }).hidden, true, 'the toggle hides the level');
        await firstChip.click(); // show it again
        assert.equal(((await stored(page))[0] as { hidden?: boolean }).hidden, undefined, 'and shows it again');

        // the same strike again edits the level, cancel keeps it, delete removes it (the pointer went to the panel, move it back first)
        await gexPoint(page);
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

        // Max AG: a chip of the Levels panel and a row of the Levels table while the AG metric is on, gone when it is off
        const maxAgChip = page.getByRole('group', { name: 'Levels' }).first().getByRole('button', { name: /^Max AG/ });
        assert.equal(await maxAgChip.count(), 1, 'Max AG chip while AG is on');
        assert.ok(await page.getByText('Max AG').first().isVisible(), 'Max AG is in the Levels table while AG is on');
        const agMetric = page.getByRole('group', { name: 'Metrics' }).first().getByRole('button', { name: /^AG/ });
        await agMetric.click();
        assert.equal(await maxAgChip.count(), 0, 'no Max AG chip when AG is off');
        assert.equal(await page.getByText('Max AG').count(), 0, 'no Max AG row when AG is off');
        await agMetric.click();
        assert.equal(await maxAgChip.count(), 1, 'Max AG is back when AG is turned on again');

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
        const panelBox = async (name: string) => { const r = (await page.getByRole('group', { name }).first().boundingBox())!; return [r.x, r.y, r.width, r.height].map(Math.round); };
        const gexPanels = { metrics: await panelBox('Metrics'), levels: await panelBox('Levels') };
        const gexTabs = (await page.getByRole('navigation').first().boundingBox())!;
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

        // the Metrics and Levels panels are exactly where they are on the GEX tab, the tab row is the same
        assert.deepEqual({ metrics: await panelBox('Metrics'), levels: await panelBox('Levels') }, gexPanels, 'same panels at the same place as on the GEX tab');
        const chartTabs = (await page.getByRole('navigation').first().boundingBox())!;
        assert.deepEqual([chartTabs.x, chartTabs.y, chartTabs.width, chartTabs.height].map(Math.round), [gexTabs.x, gexTabs.y, gexTabs.width, gexTabs.height].map(Math.round), 'the tab row is unchanged');
        // the symbol, "Daily candles" and the ranges are on the chart itself, top left
        const header = (await page.getByText('Daily candles').first().boundingBox())!;
        const canvasBox = (await page.locator('canvas').first().boundingBox())!;
        assert.ok(header.x >= canvasBox.x && header.x < canvasBox.x + 300 && header.y >= canvasBox.y && header.y < canvasBox.y + 80, 'Daily candles is in the top left corner of the chart');
        assert.ok(await page.getByRole('group', { name: 'Range' }).getByRole('button', { name: '6M' }).isVisible(), 'the range selector is on the chart');
        // the Metrics panel is shared: turning AG off there turns it off on the GEX tab too
        await page.getByRole('group', { name: 'Metrics' }).first().getByRole('button', { name: /^AG/ }).click();
        await page.getByRole('button', { name: 'GEX' }).first().click();
        await page.waitForTimeout(1500);
        assert.equal(await page.getByRole('group', { name: 'Metrics' }).first().getByRole('button', { name: /^AG/ }).getAttribute('aria-pressed'), 'false', 'a metric turned off on the Chart tab is off on the GEX tab');
        await page.getByRole('group', { name: 'Metrics' }).first().getByRole('button', { name: /^AG/ }).click();
        await page.getByRole('button', { name: 'Chart' }).first().click();
        await page.waitForTimeout(1500);

        // the Chart tab has the same Levels panel (with the custom level) and the Expirations panel next to the tabs
        const chartPanel = page.getByRole('group', { name: 'Levels' }).first();
        assert.ok(await chartPanel.isVisible(), 'the Levels panel is on the Chart tab');
        assert.equal(await page.getByText('Expirations').first().isVisible(), true, 'the Expirations panel is on the Chart tab');
        assert.equal((await chartPanel.getByRole('button').first().textContent())?.trim(), chartLevel.name, 'the custom level is a chip of the panel on the Chart tab');

        // Desk: the symbol, its spot and the provider sit in the middle of the toolbar row, between the expirations count and Collapse all
        await page.getByRole('button', { name: 'Desk' }).first().click();
        await page.waitForTimeout(1500);
        const count = (await page.getByText(/^\d+ expirations?$/).first().boundingBox())!;
        const spotLine = (await page.getByText(/^Spot/).first().boundingBox())!;
        const collapse = (await page.getByRole('button', { name: /Collapse all|Expand all/ }).first().boundingBox())!;
        assert.ok(count.x + count.width < spotLine.x && spotLine.x + spotLine.width < collapse.x, 'the spot line is between the expirations count and Collapse all');
        assert.ok(Math.abs(spotLine.y - count.y) < 20 && Math.abs(spotLine.y - collapse.y) < 20, 'all three are on one row');
        await page.getByRole('button', { name: 'Chart' }).first().click();
        await page.waitForTimeout(1500);

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
