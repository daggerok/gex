/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Page } from 'playwright';
import { noProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the Metrics panel's chip row (components/MetricsPanel.tsx in an EdgeScrollRow, owner 2026-10-26: the
// metrics at 1440 were cut off, "Put Volur", and get the same < and > as the Levels and Expirations panels): no visible
// scrollbar; a fade and a < / > button only on the side(s) with hidden chips; > brings the first hidden chip on the right
// fully into view, < the last hidden one on the left; a vertical mouse wheel scrolls the row sideways; the panel keeps its
// height; on the Desk, Chart and Board tabs the panel works the same and the toolbar row keeps the box it has on the GEX
// tab (the Desk row must not jump, PR #227). Every wait is on a condition, never a fixed sleep. 1440 light and 390 dark
// (both too narrow for all metric chips). Run: `bun run test:e2e metrics-scroll`.
// ============================================================================

/** EdgeScrollRow's fade width (EDGE_FADE_PX): the revealed chip ends this far inside the edge. */
const FADE_PX = 28;
const ROW = '[data-metrics-row]';

interface RowState { scrollLeft: number; max: number; prev: number; next: number; mask: string; scrollbar: number; panelH: number }

const rowState = (page: Page): Promise<RowState> => page.evaluate((sel) => {
    const row = document.querySelector<HTMLElement>(sel)!;
    const panel = row.closest('[role=group]') as HTMLElement;
    return {
        scrollLeft: row.scrollLeft,
        max: row.scrollWidth - row.clientWidth,
        prev: document.querySelectorAll('[data-metrics-scroll="prev"]').length,
        next: document.querySelectorAll('[data-metrics-scroll="next"]').length,
        mask: getComputedStyle(row).maskImage || getComputedStyle(row).getPropertyValue('-webkit-mask-image'),
        scrollbar: row.offsetHeight - row.clientHeight,
        panelH: panel.getBoundingClientRect().height,
    };
}, ROW);

/** Waits until the row stops scrolling (a smooth glide is done) and the buttons follow its position. */
function rowSettled(page: Page): Promise<unknown> {
    return page.waitForFunction((sel) => new Promise<boolean>((done) => {
        const row = document.querySelector<HTMLElement>(sel);
        if (!row) { done(false); return; }
        let last = row.scrollLeft;
        let still = 0;
        const step = () => {
            if (row.scrollLeft === last) still++;
            else { still = 0; last = row.scrollLeft; }
            if (still < 10) { requestAnimationFrame(step); return; }
            const max = row.scrollWidth - row.clientWidth;
            const prev = document.querySelectorAll('[data-metrics-scroll="prev"]').length === (row.scrollLeft > 1 ? 1 : 0);
            const next = document.querySelectorAll('[data-metrics-scroll="next"]').length === (row.scrollLeft < max - 1 ? 1 : 0);
            done(prev && next);
        };
        requestAnimationFrame(step);
    }), ROW, { timeout: 10_000 });
}

/** Indexes of the chips (the row's children with a width) cut off or under the fade on a side. */
const hiddenChips = (page: Page, side: 'right' | 'left'): Promise<number[]> => page.evaluate(([sel, s, fade]) => {
    const row = document.querySelector<HTMLElement>(sel as string)!;
    const box = row.getBoundingClientRect();
    return Array.from(row.children).map((c, i) => ({ r: c.getBoundingClientRect(), i })).filter(({ r }) => r.width > 0)
        .filter(({ r }) => (s === 'right' ? r.right > box.right - (fade as number) + 1 : r.left < box.left + (fade as number) - 1))
        .map(({ i }) => i);
}, [ROW, side, FADE_PX] as const);

/** A chip (by child index) relative to the row's view: its left and right edge minus the row's left edge, the row's width. */
const chipPlace = (page: Page, index: number): Promise<{ left: number; right: number; width: number }> => page.evaluate(([sel, i]) => {
    const row = document.querySelector<HTMLElement>(sel as string)!;
    const box = row.getBoundingClientRect();
    const r = row.children[i as number].getBoundingClientRect();
    return { left: r.left - box.left, right: r.right - box.left, width: box.width };
}, [ROW, index] as const);

const toolbarBox = (page: Page) => page.locator('[data-toolbar-row]').boundingBox();

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        for (const [width, height, scheme] of [[1440, 900, 'light'], [390, 844, 'dark']] as const) {
            const page = await (await browser.newContext({ viewport: { width, height }, colorScheme: scheme })).newPage();
            const errors: string[] = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await noProxy(page);
            await page.goto(site.url);
            const ticker = page.locator('input[role=combobox]');
            await ticker.fill('SPY');
            await ticker.press('Enter');
            await page.locator('[data-exp-chip]').nth(5).waitFor({ state: 'attached', timeout: 20_000 });
            await page.getByRole('button', { name: 'GEX', exact: true }).first().click();
            await page.locator(`${ROW} [role=button]`).nth(3).waitFor({ state: 'visible', timeout: 20_000 });
            const at = `${width}px ${scheme}`;

            // ---- start: scrolled to the left end; no scrollbar, a fade and > on the right only ----
            await page.evaluate((sel) => { document.querySelector<HTMLElement>(sel)!.scrollLeft = 0; }, ROW);
            await rowSettled(page);
            const s0 = await rowState(page);
            assert.ok(s0.max > 0, `${at}: more level chips than fit (${s0.max} px hidden)`);
            assert.equal(s0.scrollbar, 0, `${at}: no horizontal scrollbar under the chips`);
            assert.deepEqual([s0.prev, s0.next], [0, 1], `${at}: at the left end only > shows`);
            assert.ok(/transparent|rgba\(0, 0, 0, 0\)/.test(s0.mask) && !/^linear-gradient\(to right, (transparent|rgba\(0, 0, 0, 0\))/.test(s0.mask), `${at}: only the right side fades (${s0.mask})`);

            // ---- the > button has the app's tooltip ----
            const next = page.locator('[data-metrics-scroll="next"]');
            await next.hover();
            await page.locator('[role=tooltip]').filter({ hasText: 'Show the next metrics' }).last().waitFor({ state: 'visible', timeout: 5000 });

            // ---- > reveals the first hidden chip on the right, fully and clear of the button ----
            const hiddenRight = await hiddenChips(page, 'right');
            assert.ok(hiddenRight.length > 0, `${at}: chips hidden on the right`);
            await next.click();
            await rowSettled(page);
            const p1 = await chipPlace(page, hiddenRight[0]);
            // at 390 the row is narrower than the Net GEX chip: a chip wider than the view clear of the fade cannot fit, > then
            // ends it at the fade (its right end in view, the start cut off) and the next press moves on to the next chip
            const wide1 = p1.right - p1.left > p1.width - FADE_PX;
            assert.ok(p1.right <= p1.width - FADE_PX + 1 && (wide1 ? p1.right >= p1.width - FADE_PX - 1 : p1.left >= 0), `${at}: > brought chip ${hiddenRight[0]} into view (${p1.left.toFixed(1)}..${p1.right.toFixed(1)} of ${p1.width})`);
            const s1 = await rowState(page);
            assert.ok(s1.scrollLeft > 0, `${at}: the row scrolled (${s1.scrollLeft})`);
            assert.equal(s1.prev, 1, `${at}: < shows once there are chips on the left`);
            assert.ok(/^linear-gradient\(to right, (transparent|rgba\(0, 0, 0, 0\))/.test(s1.mask), `${at}: the left side fades too (${s1.mask})`);
            assert.equal(s1.panelH, s0.panelH, `${at}: the panel keeps its height (${s0.panelH} -> ${s1.panelH})`);

            // ---- at the right end: > is gone ----
            await page.mouse.move(0, 0);
            await page.evaluate((sel) => { const r = document.querySelector<HTMLElement>(sel)!; r.scrollLeft = r.scrollWidth; }, ROW);
            await rowSettled(page);
            const s2 = await rowState(page);
            assert.deepEqual([s2.prev, s2.next], [1, 0], `${at}: at the right end only < shows`);
            assert.ok(!/(transparent|rgba\(0, 0, 0, 0\)) 100%\)$/.test(s2.mask), `${at}: the right side no longer fades (${s2.mask})`);
            assert.equal(s2.panelH, s0.panelH, `${at}: the panel keeps its height at the end`);

            // ---- < reveals the last hidden chip on the left ----
            const hiddenLeft = await hiddenChips(page, 'left');
            assert.ok(hiddenLeft.length > 0, `${at}: chips hidden on the left`);
            await page.locator('[data-metrics-scroll="prev"]').click();
            await rowSettled(page);
            const last = hiddenLeft[hiddenLeft.length - 1];
            const p3 = await chipPlace(page, last);
            const wide3 = p3.right - p3.left > p3.width - FADE_PX;
            assert.ok(p3.left >= FADE_PX - 1 && (wide3 ? p3.left <= FADE_PX + 1 : p3.right <= p3.width), `${at}: < brought chip ${last} into view (${p3.left.toFixed(1)}..${p3.right.toFixed(1)})`);

            // ---- a vertical mouse wheel over the row scrolls it sideways ----
            const before = (await rowState(page)).scrollLeft;
            const rowBox = (await page.locator(ROW).boundingBox())!;
            await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
            await page.mouse.wheel(0, -150);
            await page.waitForFunction(([sel, b]) => document.querySelector<HTMLElement>(sel as string)!.scrollLeft < (b as number), [ROW, before] as const, { timeout: 5000 });
            await rowSettled(page);
            await page.mouse.move(0, 0);

            // ---- the Desk, Chart and Board tabs: the same row, the same box, the buttons work there too ----
            const gexBox = await toolbarBox(page);
            for (const tab of ['Desk', 'Chart', 'Board'] as const) {
                await page.getByRole('button', { name: tab, exact: true }).first().click();
                await page.locator(`${ROW} [role=button]`).nth(3).waitFor({ state: 'visible', timeout: 20_000 });
                await page.evaluate((sel) => { document.querySelector<HTMLElement>(sel)!.scrollLeft = 0; }, ROW);
                await rowSettled(page);
                const t0 = await rowState(page);
                assert.equal(t0.scrollbar, 0, `${at} ${tab}: no scrollbar`);
                assert.equal(t0.panelH, s0.panelH, `${at} ${tab}: the same panel height`);
                assert.deepEqual([t0.prev, t0.next], [0, 1], `${at} ${tab}: at the left end only > shows`);
                assert.deepEqual(await toolbarBox(page), gexBox, `${at} ${tab}: the toolbar row does not move or resize`);
                await page.locator('[data-metrics-scroll="next"]').click();
                await rowSettled(page);
                const t1 = await rowState(page);
                assert.ok(t1.scrollLeft > 0 && t1.prev === 1, `${at} ${tab}: > scrolls the row (${t1.scrollLeft})`);
                assert.deepEqual(await toolbarBox(page), gexBox, `${at} ${tab}: the toolbar row keeps its box after scrolling`);
                await page.mouse.move(0, 0);
            }

            assert.deepEqual(errors, [], `${at}: no page errors`);
            console.log(`metrics arrows ${at}: ${s0.max} px of chips hidden, > revealed chip ${hiddenRight[0]}, < revealed chip ${last}`);
            await page.context().close();
        }
        console.log('metrics arrows e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
