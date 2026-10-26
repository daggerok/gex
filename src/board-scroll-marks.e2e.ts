/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Page } from 'playwright';
import { noProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the Board's scroll marks strip (components/ScrollMarks.tsx, src/scroll-marks.ts): the strip sits right
// of the table card, as tall as it, outside the card (the table keeps its width, the page does not scroll); its ticks
// cover every row exactly once; the frame follows the scroll; a click on a tick of a row out of view glides that row into
// the middle of the table; hovering a tick shows the app's tooltip with the strike. Desktop light and phone dark.
// Run: `bun run test:e2e`.
// ============================================================================

/** Where a row sits in the visible part of the table below its header: 0 = top, 1 = bottom. */
function rowPlace(page: Page, strike: string): Promise<number | null> {
    return page.evaluate((s) => {
        const box = document.querySelector('[data-board-scroll]');
        const head = box?.querySelector('thead');
        const row = box?.querySelector(`[data-board-row="${s}"]`);
        if (!box || !head || !row) return null;
        const b = box.getBoundingClientRect();
        const top = b.top + head.getBoundingClientRect().height;
        const r = row.getBoundingClientRect();
        return (r.top + r.height / 2 - top) / (b.bottom - top);
    }, strike);
}

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
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
            await page.waitForTimeout(2500);
            await page.getByRole('button', { name: 'Board', exact: true }).first().click();
            await page.waitForTimeout(1500);
            const at = `${width}px ${scheme}`;

            // ---- the strip: right of the card, as tall as it, inside the window ----
            const geo = await page.evaluate(() => {
                const card = document.querySelector('[data-board-scroll]')!.getBoundingClientRect();
                const strip = document.querySelector('[data-board] [data-scroll-marks]')!.getBoundingClientRect();
                return { card: { right: card.right, top: card.top, bottom: card.bottom }, strip: { left: strip.left, right: strip.right, top: strip.top, bottom: strip.bottom, width: strip.width }, win: window.innerWidth, pageW: document.documentElement.scrollWidth };
            });
            assert.ok(geo.strip.left >= geo.card.right, `${at}: the strip is right of the card (${geo.strip.left} >= ${geo.card.right})`);
            assert.ok(geo.strip.width >= 6 && geo.strip.width <= 8, `${at}: the strip is 6-8 px wide (${geo.strip.width})`);
            assert.ok(Math.abs(geo.strip.top - geo.card.top) <= 1 && Math.abs(geo.strip.bottom - geo.card.bottom) <= 1, `${at}: the strip is as tall as the card`);
            assert.ok(geo.strip.right <= geo.win, `${at}: the strip is inside the window (${geo.strip.right} <= ${geo.win})`);
            assert.ok(geo.pageW <= geo.win, `${at}: no horizontal page scroll (${geo.pageW} > ${geo.win})`);
            const fit = await page.evaluate(() => ({ page: document.documentElement.scrollHeight, inner: window.innerHeight, footer: Math.round(document.querySelector('footer')!.getBoundingClientRect().bottom) }));
            assert.ok(fit.page <= fit.inner + 1, `${at}: the page does not scroll (${fit.page} in ${fit.inner})`);
            assert.ok(Math.abs(fit.footer - fit.inner) <= 1, `${at}: the footer is at the bottom of the window`);

            // ---- every row is on the strip exactly once (ticks merge, none is lost) ----
            const rows = await page.locator('[data-board-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-board-row') ?? ''));
            const ticks = await page.locator('[data-board] [data-scroll-tick]').evaluateAll((els) => els.map((e) => ({ kind: e.getAttribute('data-scroll-tick') ?? '', strikes: (e.getAttribute('data-scroll-strikes') ?? '').split(',') })));
            assert.ok(ticks.length > 0 && ticks.length <= rows.length, `${at}: ${ticks.length} ticks for ${rows.length} rows`);
            assert.deepEqual(ticks.flatMap((t) => t.strikes), rows, `${at}: the ticks cover every row once, in order`);
            const atm = await page.locator('[data-board-atm]').getAttribute('data-board-row');
            const atmTick = ticks.find((t) => t.strikes.includes(atm ?? ''));
            assert.ok(atmTick && atmTick.kind !== 'row', `${at}: the ATM row's tick is marked (${atmTick?.kind})`);
            console.log(`board scroll marks ${at}: ${ticks.length} ticks for ${rows.length} rows, ${ticks.filter((t) => t.kind !== 'row').length} marked`);

            // ---- the frame shows the rows in view: about the middle on open (the ATM row is centered) ----
            const frame = () => page.evaluate(() => {
                const s = document.querySelector('[data-board] [data-scroll-marks]')!.getBoundingClientRect();
                const f = document.querySelector('[data-board] [data-scroll-frame]')!.getBoundingClientRect();
                return { top: (f.top - s.top) / s.height, bottom: (f.bottom - s.top) / s.height };
            });
            const f0 = await frame();
            assert.ok(f0.top > 0 && f0.bottom < 1, `${at}: the frame is inside the strip on open (${f0.top.toFixed(2)}..${f0.bottom.toFixed(2)})`);

            // ---- a click on the first tick (a row far above the view) glides that row to the middle ----
            const firstStrike = rows[0];
            assert.ok((await rowPlace(page, firstStrike))! < 0, `${at}: the first row is out of view above`);
            // the first tick is the top row; when merged, its lead may be a neighbour - take the tick's lead row from its strikes
            const tick = page.locator('[data-board] [data-scroll-tick]').nth(Math.floor(ticks.length * 0.12));
            const target = (await tick.getAttribute('data-scroll-strikes'))!.split(',')[0];
            const before = await rowPlace(page, target);
            assert.ok(before !== null && (before < 0 || before > 1), `${at}: the target row ${target} is out of view (${before})`);
            await tick.click();
            await page.waitForTimeout(1200);
            // the lead of a merged tick is its most important row, all of a tick's rows are within a few px of each other
            const strikes = (await tick.getAttribute('data-scroll-strikes'))!.split(',');
            const places = await Promise.all(strikes.map((s) => rowPlace(page, s)));
            assert.ok(places.some((p) => p !== null && p > 1 / 3 && p < 2 / 3), `${at}: after the click the row is in the middle third (${places.join(', ')})`);
            const f1 = await frame();
            assert.ok(f1.top < f0.top, `${at}: the frame moved up with the scroll (${f1.top.toFixed(2)} < ${f0.top.toFixed(2)})`);

            // ---- hover: the app's tooltip with the strike ----
            await page.locator('[data-board] [data-scroll-tick]').nth(ticks.length - 1).hover();
            await page.waitForTimeout(500);
            const tip = page.locator('[role=tooltip]').filter({ hasText: 'Net GEX' }).last();
            assert.ok(await tip.isVisible(), `${at}: hovering a tick shows a tooltip`);
            const lastStrikes = ticks[ticks.length - 1].strikes;
            const tipText = await tip.innerText();
            assert.ok(lastStrikes.every((s) => tipText.includes(Number(s).toString().split('.')[0])), `${at}: the tooltip lists the tick's strikes (${tipText})`);

            assert.deepEqual(errors, [], `${at}: no page errors`);
            await page.context().close();
        }
        console.log('board scroll marks e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
