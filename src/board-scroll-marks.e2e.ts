/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Page } from 'playwright';
import { noProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the Board's scroll marks strip (components/ScrollMarks.tsx, src/scroll-marks.ts): the strip sits right
// of the table card, as tall as it, outside the card (the table keeps its width, the page does not scroll); its ticks
// cover exactly what the table highlights (owner 2026-10-26): the ATM row (Spot colour) and the rows with a peak or a
// runner-up dot (their Net GEX sign colour), no plain rows, no level colours; no frame over the rows in view (owner 2026-10-25); a click on a tick of a row out of view glides that row into
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

            // ---- only the highlighted rows are on the strip, each exactly once, in table order ----
            const rows = await page.locator('[data-board-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-board-row') ?? ''));
            const marked = await page.locator('[data-board-row]').evaluateAll((els) => els
                .filter((e) => e.hasAttribute('data-board-atm') || e.querySelector('[data-board-dot]'))
                .map((e) => e.getAttribute('data-board-row') ?? ''));
            const ticks = await page.locator('[data-board] [data-scroll-tick]').evaluateAll((els) => els.map((e) => ({ kind: e.getAttribute('data-scroll-tick') ?? '', strikes: (e.getAttribute('data-scroll-strikes') ?? '').split(','), color: (e.querySelector('span') as HTMLElement | null)?.style.backgroundColor ?? '' })));
            assert.ok(marked.length > 1 && marked.length < rows.length, `${at}: ${marked.length} highlighted of ${rows.length} rows`);
            assert.deepEqual(ticks.flatMap((t) => t.strikes), marked, `${at}: the ticks cover exactly the highlighted rows, in order`);
            assert.ok(ticks.every((t) => t.kind === 'atm' || t.kind === 'peak' || t.kind === 'second'), `${at}: no plain or level ticks (${Array.from(new Set(ticks.map((t) => t.kind))).join(', ')})`);
            const allowed = await page.evaluate(() => {
                const probe = document.createElement('span');
                document.body.appendChild(probe);
                const css = (v: string) => { probe.style.backgroundColor = ''; probe.style.backgroundColor = v; return getComputedStyle(probe).backgroundColor; };
                const root = getComputedStyle(document.documentElement);
                const out = [css(root.getPropertyValue('--gex-pos').trim()), css(root.getPropertyValue('--gex-neg').trim())];
                probe.remove();
                return out;
            });
            const tickColors = await page.locator('[data-board] [data-scroll-tick]').evaluateAll((els) => els.map((e) => ({ kind: e.getAttribute('data-scroll-tick'), color: getComputedStyle(e.querySelector('span') as HTMLElement).backgroundColor })));
            const signTicks = tickColors.filter((t) => t.kind !== 'atm');
            assert.ok(signTicks.length > 0 && signTicks.every((t) => allowed.includes(t.color)), `${at}: peak and runner-up ticks use only the Net GEX sign colours ${allowed.join(' / ')} (${Array.from(new Set(signTicks.map((t) => t.color))).join(', ')})`);
            const atm = await page.locator('[data-board-atm]').getAttribute('data-board-row');
            const atmTick = ticks.find((t) => t.strikes.includes(atm ?? ''));
            assert.ok(atmTick && atmTick.kind !== 'row', `${at}: the ATM row's tick is marked (${atmTick?.kind})`);
            console.log(`board scroll marks ${at}: ${ticks.length} ticks for ${marked.length} highlighted of ${rows.length} rows`);

            // ---- no frame over the rows in view (owner 2026-10-25: less overwhelming) ----
            assert.equal(await page.locator('[data-board] [data-scroll-frame]').count(), 0, `${at}: the strip has no visible window frame`);

            // ---- a click on a tick of a row out of view glides that row to the middle ----
            // the strip holds only the highlighted rows and they are often near the ATM row, so scroll the table to an end
            // first when every one of them is on screen
            const outOfView = async (): Promise<number> => {
                for (let i = 0; i < ticks.length; i++) {
                    const p = await rowPlace(page, ticks[i].strikes[0]);
                    if (p !== null && (p < 0 || p > 1)) return i;
                }
                return -1;
            };
            let pick = await outOfView();
            for (const end of ['bottom', 'top'] as const) {
                if (pick >= 0) break;
                await page.evaluate((e) => { const b = document.querySelector('[data-board-scroll]')!; b.scrollTop = e === 'top' ? 0 : b.scrollHeight; }, end);
                await page.waitForTimeout(300);
                pick = await outOfView();
            }
            assert.ok(pick >= 0, `${at}: a highlighted row out of view to click`);
            const tick = page.locator('[data-board] [data-scroll-tick]').nth(pick);
            await tick.click();
            await page.waitForTimeout(1200);
            // the lead of a merged tick is its most important row, all of a tick's rows are within a few px of each other
            const strikes = (await tick.getAttribute('data-scroll-strikes'))!.split(',');
            const places = await Promise.all(strikes.map((s) => rowPlace(page, s)));
            assert.ok(places.some((p) => p !== null && p > 1 / 3 && p < 2 / 3), `${at}: after the click the row is in the middle third (${places.join(', ')})`);

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
