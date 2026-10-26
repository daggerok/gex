/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { noProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the Metrics + Levels row on the Desk (owner 2026-10-26: the upper part of all four tabs is identical).
// The row is the shared one (components/ToolbarRow.tsx): the Metrics chips are active and choose which Board columns give
// the peaks and runner-ups of the Desk scroll marks; the Levels panel is shown disabled (greyed, inert: a click changes
// nothing) with the app's tooltip saying why; the row has the same box as on the GEX tab. Every wait is on a condition,
// never a fixed sleep. Desktop light and phone dark. Run: `bun run test:e2e`; SHOTS_DIR=<dir> also saves screenshots there.
// ============================================================================

/** The visible toolbar row (the Desk stays mounted, hidden, on other tabs). */
const ROW = '[data-toolbar-row]:visible';

/** The marked rows of the Desk scroll marks strip, as `kind:key` (one entry per row), sorted. */
const marksOf = (page: Page): Promise<string> =>
    page.locator('.od-scroll-wrap [data-scroll-tick]').evaluateAll((els) => els
        .flatMap((e) => (e.getAttribute('data-scroll-keys') ?? '').split(',').map((k) => `${e.getAttribute('data-scroll-tick')}:${k}`))
        .sort().join(' '));

const boxOf = (page: Page): Promise<string> => page.locator(ROW).evaluate((e) => {
    const r = e.getBoundingClientRect();
    return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}`;
});

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    const shots = process.env.SHOTS_DIR;
    try {
        for (const [width, height, scheme] of [[1440, 900, 'light'], [390, 844, 'dark']] as const) {
            const page = await (await browser.newContext({ viewport: { width, height }, colorScheme: scheme })).newPage();
            const errors: string[] = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await noProxy(page); // no local proxy: the app uses the CACHE provider by itself
            await page.goto(site.url);
            const ticker = page.locator('input[role=combobox]');
            await ticker.fill('SPY');
            await ticker.press('Enter');
            await page.getByRole('button', { name: 'Desk', exact: true }).first().click();
            const chips = page.locator('[data-exp-chip]');
            await chips.nth(3).waitFor({ state: 'attached', timeout: 20_000 });
            await page.locator('.od-sec').first().waitFor({ timeout: 20_000 });
            for (let i = 1; i < 4; i++) await chips.nth(i).click();
            await page.waitForFunction(() => document.querySelectorAll('.od-sec').length >= 4 && document.querySelectorAll('.od-scroll-wrap [data-scroll-tick="atm"]').length >= 4, undefined, { timeout: 20_000 });
            const at = `${width}px ${scheme}`;

            // ---- the row is there, the same box as on the GEX tab ----
            const row = page.locator(ROW);
            assert.equal(await row.count(), 1, `${at}: one Metrics + Levels row on the Desk`);
            const metricsPanel = row.getByRole('group', { name: 'Metrics' });
            const levelsPanel = row.getByRole('group', { name: 'Levels' });
            await metricsPanel.waitFor();
            await levelsPanel.waitFor();
            const deskBox = await boxOf(page);
            await page.getByRole('button', { name: 'GEX', exact: true }).first().click();
            await page.locator('main:not([data-desk]) [data-toolbar-row]').waitFor();
            const gexBox = await boxOf(page);
            assert.equal(deskBox, gexBox, `${at}: the row has the same box on the Desk and the GEX tab`);
            await page.getByRole('button', { name: 'Desk', exact: true }).first().click();
            await page.locator('main[data-desk] [data-toolbar-row]').waitFor();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${at}: no horizontal page scroll`);

            // ---- Levels: greyed and inert, a click changes nothing, the tooltip says why ----
            const lv = await levelsPanel.evaluate((e) => ({ inert: (e as HTMLElement).inert, disabled: e.getAttribute('aria-disabled'), opacity: getComputedStyle(e).opacity }));
            assert.deepEqual([lv.inert, lv.disabled], [true, 'true'], `${at}: the Levels panel is inert and aria-disabled`);
            assert.ok(Number(lv.opacity) < 1, `${at}: the Levels panel is greyed (opacity ${lv.opacity})`);
            const levelChip = levelsPanel.locator('[aria-pressed]').first();
            const pressed = await levelChip.getAttribute('aria-pressed');
            await levelChip.click({ force: true }); // a real pointer click at the chip: the inert panel ignores it
            assert.equal(await levelChip.getAttribute('aria-pressed'), pressed, `${at}: a click on a disabled level changes nothing`);
            await levelsPanel.hover({ force: true });
            await page.getByRole('tooltip', { name: /^Levels are not shown on the Desk/ }).waitFor({ state: 'visible', timeout: 5000 });
            await page.mouse.move(0, 0);

            // ---- Metrics: active, they choose the peaks and runner-ups of the Desk scroll marks ----
            const before = await marksOf(page);
            const extra = ['Call OI', 'Put OI', 'Call Volume', 'Put Volume', 'P/C OI', 'P/C Volume'];
            for (const name of extra) {
                const chip = metricsPanel.locator('[aria-pressed]').filter({ hasText: name }).first();
                assert.equal(await chip.getAttribute('aria-pressed'), 'false', `${at}: ${name} starts off`);
                await chip.click();
                await page.waitForFunction((n) => {
                    const c = Array.from(document.querySelectorAll('main[data-desk] [role=group] [aria-pressed]')).find((e) => e.textContent?.includes(n));
                    return c?.getAttribute('aria-pressed') === 'true';
                }, name, { timeout: 5000 });
            }
            await page.waitForFunction((b) => {
                const now = Array.from(document.querySelectorAll('.od-scroll-wrap [data-scroll-tick]'))
                    .flatMap((e) => (e.getAttribute('data-scroll-keys') ?? '').split(',').map((k) => `${e.getAttribute('data-scroll-tick')}:${k}`))
                    .sort().join(' ');
                return now !== b;
            }, before, { timeout: 10_000 });
            const more = await marksOf(page);
            assert.ok(more.split(' ').length > before.split(' ').length, `${at}: more metrics mark more peak and runner-up rows (${before.split(' ').length} -> ${more.split(' ').length})`);
            if (shots) await page.screenshot({ path: join(shots, `desk-toolbar-${width}-${scheme}-metrics.png`) });
            // Reset brings the default metrics and the same marks back
            await metricsPanel.getByRole('button', { name: 'Reset' }).click();
            await page.waitForFunction((b) => Array.from(document.querySelectorAll('.od-scroll-wrap [data-scroll-tick]'))
                .flatMap((e) => (e.getAttribute('data-scroll-keys') ?? '').split(',').map((k) => `${e.getAttribute('data-scroll-tick')}:${k}`))
                .sort().join(' ') === b, before, { timeout: 10_000 });

            assert.deepEqual(errors, [], `${at}: no page errors`);
            await page.context().close();
        }
        console.log('desk toolbar e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
