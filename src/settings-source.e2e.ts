/// <reference types="node" />
/// <reference types="bun" />
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the data source controls: the header has no provider dropdown, the settings menu has the
// Online data / Cached data buttons with the provider dropdown at its bottom. Run: `bun run test:e2e`.
// ============================================================================

const site = await startTestSite();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
try {
    await page.goto(site.url);
    await page.getByText('💾').first().click(); // cached data from the header pill
    assert.equal(await page.locator('select').count(), 0, 'no dropdown in the header or anywhere while the menu is closed');

    await page.locator('button[aria-label="Settings"]').click();
    const cached = page.locator('[data-data-source="cache"]');
    const online = page.locator('[data-data-source="live"]');
    const select = page.locator('[data-provider-select]');
    assert.equal(await cached.getAttribute('aria-pressed'), 'true');
    assert.equal(await select.isDisabled(), true, 'cached data: the provider dropdown is locked to CACHE');
    assert.deepEqual(await select.locator('option').allInnerTexts(), ['CACHE']);

    // at the bottom of the menu: below the other settings
    const menu = page.locator('div.absolute.right-0:has([data-data-source])');
    const box = (await menu.boundingBox())!;
    const sourceBox = (await cached.boundingBox())!;
    assert.ok(sourceBox.y > box.y + box.height / 2, 'the data source buttons are in the lower half of the menu');

    await online.click();
    assert.equal(await online.getAttribute('aria-pressed'), 'true');
    assert.equal(await select.isEnabled(), true, 'online data: the dropdown works');
    assert.deepEqual(await select.locator('option').allInnerTexts(), ['CBOE', 'NASDAQ', 'YAHOO']);
    await select.selectOption('yahoo');
    assert.equal(await select.inputValue(), 'yahoo');

    await cached.click();
    assert.equal(await select.isDisabled(), true);
    assert.equal(await select.inputValue(), 'static');
    console.log('settings data source e2e: ok');
} finally {
    await browser.close();
    site.close();
}
