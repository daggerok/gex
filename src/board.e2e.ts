/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Page } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the Board tab (src/views/BoardView.tsx): it opens with the ATM row (strike nearest to spot) in the
// middle of the table and keeps it there when the expiration selection changes; it has no expirations panel of its own,
// the shared one shows each expiration's OI share in a slot of fixed width; the table has the Desk's look and the very
// same ATM tint (both themes); Net GEX has one or two peak dots, every other column
// at most one; the page never scrolls (desktop and phone), only the table does; switching to the Board with every
// expiration selected stays fast. Run: `bun run test:e2e`.
// ============================================================================

/** Where the ATM row sits in the visible part of the table below its header: 0 = top, 1 = bottom, null = no row. */
function atmPlace(page: Page): Promise<number | null> {
    return page.evaluate(() => {
        const box = document.querySelector('[data-board-scroll]');
        const head = box?.querySelector('thead');
        const row = box?.querySelector('[data-board-atm]');
        if (!box || !head || !row) return null;
        const b = box.getBoundingClientRect();
        const top = b.top + head.getBoundingClientRect().height;
        const r = row.getBoundingClientRect();
        return (r.top + r.height / 2 - top) / (b.bottom - top);
    });
}

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        for (const [width, height, scheme] of [[1440, 900, 'light'], [390, 844, 'dark']] as const) {
            const page = await (await browser.newContext({ viewport: { width, height }, colorScheme: scheme })).newPage();
            const errors: string[] = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(site.url);
            await page.getByText('💾').first().click(); // CACHE provider
            const ticker = page.locator('input[role=combobox]');
            await ticker.fill('SPY');
            await ticker.press('Enter');
            await page.waitForTimeout(2500);
            await page.getByRole('button', { name: 'Board', exact: true }).first().click();
            await page.waitForTimeout(1500);
            const at = `${width}px ${scheme}`;

            // ---- opens on the money ----
            const first = await atmPlace(page);
            assert.ok(first !== null && first > 1 / 3 && first < 2 / 3, `${at}: the ATM row is in the middle third on open (at ${first})`);

            // ---- no second expirations panel: the shared one shows each loaded expiration's OI share ----
            assert.equal(await page.locator('[data-board-expirations], [data-board-exp]').count(), 0, `${at}: the Board has no expirations panel of its own`);
            const chips = page.locator('[data-exp-chip]');
            assert.ok((await chips.count()) >= 3, `${at}: expiration chips`);
            assert.match(await chips.first().innerText(), /\d+\.\d%|100%/, `${at}: a loaded expiration shows its OI share in the shared panel`);
            // the share sits in a slot of one width on every chip, loaded or not (no width jump while the shares load)
            const slots = await page.locator('[data-exp-share]').evaluateAll((els) => Array.from(new Set(els.map((e) => Math.round(e.getBoundingClientRect().width)))));
            assert.equal(slots.length, 1, `${at}: one width for every share slot (${slots.join(', ')})`);

            // ---- a chip of the shared panel changes the selection, the ATM row is centered again ----
            const second = chips.nth(1);
            await page.locator('[data-board-scroll]').evaluate((e) => { e.scrollTop = 0; });
            await second.click();
            await page.waitForTimeout(2000);
            assert.equal(await second.getAttribute('aria-pressed'), 'true', `${at}: the chip is selected`);
            const again = await atmPlace(page);
            assert.ok(again !== null && again > 1 / 3 && again < 2 / 3, `${at}: after a selection change the ATM row is in the middle third (at ${again})`);

            // ---- the Desk's look: font size, row height, cell padding, header style, and the very same ATM tint ----
            const look = await page.evaluate(() => {
                const desk = (sel: string) => document.querySelector(sel) as HTMLElement | null;
                const st = (e: HTMLElement | null) => {
                    if (!e) return null;
                    const c = getComputedStyle(e);
                    return { size: c.fontSize, lh: c.lineHeight, num: c.fontVariantNumeric, pad: c.padding, h: Math.round(e.getBoundingClientRect().height) };
                };
                return {
                    boardCell: st(desk('[data-board-row]:not([data-board-atm]) td')),
                    boardRow: Math.round((desk('[data-board-row]:not([data-board-atm])')?.getBoundingClientRect().height) ?? 0),
                    boardHead: st(desk('[data-board-scroll] thead th:nth-child(2)')),
                    boardAtm: getComputedStyle(desk('[data-board-atm]') as HTMLElement).backgroundColor,
                };
            });
            assert.equal(look.boardCell?.size, '16px', `${at}: Board cells use the Desk font size`);
            assert.equal(look.boardCell?.lh, '24px', `${at}: and its line height`);
            assert.equal(look.boardCell?.pad, '3px 8px', `${at}: and its cell padding`);
            assert.equal(look.boardRow, 30, `${at}: a Board row is 30 px like a Desk row`);
            assert.equal(look.boardHead?.size, '11px', `${at}: the header is 11 px like the Desk's`);
            await page.getByRole('button', { name: 'Desk', exact: true }).first().click();
            await page.waitForTimeout(1500);
            const deskAtm = await page.locator('.od-drow.od-atm').first().evaluate((e) => getComputedStyle(e).backgroundColor);
            assert.equal(look.boardAtm, deskAtm, `${at}: the Board ATM row has the Desk ATM tint`);
            await page.getByRole('button', { name: 'Board', exact: true }).first().click();
            await page.waitForTimeout(1000);

            // ---- peaks: Net GEX one or two (its walls), the others at most one ----
            const peaks = await page.locator('[data-board-peak]').evaluateAll((els) => els.map((e) => e.getAttribute('data-board-peak') ?? ''));
            const count = (k: string) => peaks.filter((p) => p === k).length;
            assert.ok(count('netGex') >= 1 && count('netGex') <= 2, `${at}: Net GEX peaks ${count('netGex')}`);
            for (const k of ['absGex', 'notionalDelta', 'totalOi', 'callOi', 'putOi', 'totalVolume', 'callVolume', 'putVolume', 'absGexShare']) assert.ok(count(k) <= 1, `${at}: ${k} peaks ${count(k)}`);

            // ---- only the table scrolls, the footer stays in view ----
            const fit = await page.evaluate(() => ({ page: document.documentElement.scrollHeight, inner: window.innerHeight, footer: Math.round(document.querySelector('footer')!.getBoundingClientRect().bottom) }));
            assert.ok(fit.page <= fit.inner + 1, `${at}: the page does not scroll (${fit.page} in ${fit.inner})`);
            assert.ok(Math.abs(fit.footer - fit.inner) <= 1, `${at}: the footer is at the bottom of the window (${fit.footer} vs ${fit.inner})`);
            const scrolls = await page.locator('[data-board-scroll]').evaluate((e) => e.scrollHeight > e.clientHeight);
            assert.ok(scrolls, `${at}: the table scrolls inside its card`);

            // ---- every expiration selected: the Board still opens quickly ----
            if (width > 1000) {
                await page.getByRole('button', { name: 'GEX', exact: true }).first().click();
                await page.getByRole('button', { name: 'All', exact: true }).first().click();
                await page.waitForTimeout(3000);
                const t0 = Date.now();
                await page.getByRole('button', { name: 'Board', exact: true }).first().click();
                await page.locator('[data-board-atm]').waitFor();
                const ms = Date.now() - t0;
                const rows = await page.locator('[data-board-row]').count();
                assert.ok(ms < 2000, `the Board with every expiration (${rows} strikes) opens in ${ms} ms (< 2000)`);
                console.log(`board e2e: ${rows} strikes with every expiration rendered in ${ms} ms`);
            }
            assert.deepEqual(errors, [], `${at}: no page errors`);
            await page.context().close();
        }
        console.log('board e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
