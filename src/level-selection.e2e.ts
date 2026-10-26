/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Locator, type Page } from 'playwright';
import { noProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check that the Levels selection is remembered (level-prefs.ts, localStorage 'gex.selectedLevels.v1'): turn Max
// Pain off and Sigma on, reload, both keep their state on the GEX tab and on the Chart tab (shared prefs); Reset brings the
// defaults back and that survives a reload too. Every wait is on a condition, never a fixed sleep. Run: `bun run test:e2e`.
// ============================================================================

const KEY = 'gex.selectedLevels.v1';

/** The visible Levels panel of the current tab. */
const levelsPanel = (page: Page): Locator => page.locator('[data-toolbar-row]:visible').getByRole('group', { name: 'Levels' });
const chip = (page: Page, text: string): Locator => levelsPanel(page).locator('[role=button][aria-pressed]', { hasText: text });

async function openGex(page: Page): Promise<void> {
    const ticker = page.locator('input[role=combobox]');
    await ticker.fill('SPY');
    await ticker.press('Enter');
    await page.getByRole('button', { name: 'GEX', exact: true }).first().click();
    await chip(page, 'Max Pain').waitFor({ timeout: 20_000 });
}

/** Waits (on a condition) until the chip's aria-pressed is `want`, then asserts it, so a failure names what was expected. */
async function expectPressed(l: Locator, want: 'true' | 'false', what: string): Promise<void> {
    await l.and(l.page().locator(`[aria-pressed="${want}"]`)).waitFor({ timeout: 5000 }).catch(() => undefined);
    assert.equal(await l.getAttribute('aria-pressed'), want, what);
}

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await noProxy(page); // no local proxy: the app uses the CACHE provider by itself
        await page.goto(site.url);
        await openGex(page);

        // ---- defaults on a first visit ----
        await expectPressed(chip(page, 'Max Pain'), 'true', 'Max Pain is on by default');
        await expectPressed(chip(page, 'Sigma'), 'false', 'Sigma is off by default');

        // ---- toggle, then reload ----
        await chip(page, 'Max Pain').click();
        await expectPressed(chip(page, 'Max Pain'), 'false', 'a click turns Max Pain off');
        await chip(page, 'Sigma').scrollIntoViewIfNeeded();
        await chip(page, 'Sigma').click();
        await expectPressed(chip(page, 'Sigma'), 'true', 'a click turns Sigma on');
        const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null') as Record<string, boolean> | null, KEY);
        assert.ok(stored, `the selection is stored under ${KEY}`);
        assert.deepEqual([stored.maxPain, stored.sigma, stored.zeroGex], [false, true, true], 'every level stored with its state');

        await page.reload();
        await openGex(page);
        await expectPressed(chip(page, 'Max Pain'), 'false', 'Max Pain stays off after a reload');
        await expectPressed(chip(page, 'Sigma'), 'true', 'Sigma stays on after a reload');
        await expectPressed(chip(page, 'Zero GEX'), 'true', 'an untouched level keeps its default');

        // ---- the Chart tab shares the same selection ----
        await page.getByRole('button', { name: 'Chart', exact: true }).first().click();
        await chip(page, 'Max Pain').waitFor({ timeout: 10_000 });
        await expectPressed(chip(page, 'Max Pain'), 'false', 'the Chart tab shows the remembered selection');
        await page.getByRole('button', { name: 'GEX', exact: true }).first().click();
        await chip(page, 'Max Pain').waitFor({ timeout: 10_000 });

        // ---- Reset restores the defaults, also after a reload ----
        await levelsPanel(page).getByRole('button', { name: 'Reset', exact: true }).click();
        await expectPressed(chip(page, 'Max Pain'), 'true', 'Reset turns Max Pain back on');
        await expectPressed(chip(page, 'Sigma'), 'false', 'Reset turns Sigma back off');
        await page.reload();
        await openGex(page);
        await expectPressed(chip(page, 'Max Pain'), 'true', 'the defaults stay after a reload');
        await expectPressed(chip(page, 'Sigma'), 'false', 'Sigma stays off after Reset and a reload');

        assert.deepEqual(errors, [], 'no page errors');
        await page.close();
        console.log('level selection e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
