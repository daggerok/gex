/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { noProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the shared Expirations panel's chip row (components/ExpirationChips.tsx, src/edge-scroll.ts, owner
// 2026-10-26): no visible scrollbar; a fade and a < / > button only on the side(s) with hidden chips; clicking > brings
// the first hidden chip on the right fully into view (clear of the button), < the last hidden one on the left; a vertical
// mouse wheel scrolls the row sideways; the panel keeps its height whatever the buttons do; the buttons have the app's
// tooltip; the same panel on every tab. Every wait is on a condition, never a fixed sleep. 1440 light and 390 dark.
// Run: `bun run test:e2e`; SHOTS_DIR=<dir> also saves screenshots there.
// ============================================================================

/** The fade width of ExpirationChips (FADE_PX): the revealed chip ends this far inside the edge. */
const FADE_PX = 28;

interface RowState { scrollLeft: number; max: number; prev: number; next: number; mask: string; scrollbar: number; panelH: number }

const rowState = (page: Page): Promise<RowState> => page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-exp-row]')!;
    const panel = row.closest('.rounded-lg') as HTMLElement;
    return {
        scrollLeft: row.scrollLeft,
        max: row.scrollWidth - row.clientWidth,
        prev: document.querySelectorAll('[data-exp-scroll="prev"]').length,
        next: document.querySelectorAll('[data-exp-scroll="next"]').length,
        mask: getComputedStyle(row).maskImage || getComputedStyle(row).getPropertyValue('-webkit-mask-image'),
        scrollbar: row.offsetHeight - row.clientHeight,
        panelH: panel.getBoundingClientRect().height,
    };
});

/** Waits until the chip row stops scrolling (a smooth glide is done) and the buttons follow its position. */
function rowSettled(page: Page): Promise<unknown> {
    return page.waitForFunction(() => new Promise<boolean>((done) => {
        const row = document.querySelector<HTMLElement>('[data-exp-row]');
        if (!row) { done(false); return; }
        let last = row.scrollLeft;
        let still = 0;
        const step = () => {
            if (row.scrollLeft === last) still++;
            else { still = 0; last = row.scrollLeft; }
            if (still < 10) { requestAnimationFrame(step); return; }
            const max = row.scrollWidth - row.clientWidth;
            const prev = document.querySelectorAll('[data-exp-scroll="prev"]').length === (row.scrollLeft > 1 ? 1 : 0);
            const next = document.querySelectorAll('[data-exp-scroll="next"]').length === (row.scrollLeft < max - 1 ? 1 : 0);
            done(prev && next);
        };
        requestAnimationFrame(step);
    }), undefined, { timeout: 10_000 });
}

/** The chips (by date) cut off or covered by the fade at the right / left edge of the row's view. */
const hiddenChips = (page: Page, side: 'right' | 'left'): Promise<string[]> => page.evaluate(([s, fade]) => {
    const row = document.querySelector<HTMLElement>('[data-exp-row]')!;
    const box = row.getBoundingClientRect();
    return Array.from(row.querySelectorAll<HTMLElement>('[data-exp-chip]')).filter((c) => {
        const r = c.getBoundingClientRect();
        return s === 'right' ? r.right > box.right - (fade as number) + 1 : r.left < box.left + (fade as number) - 1;
    }).map((c) => c.getAttribute('data-exp-chip') ?? '');
}, [side, FADE_PX] as const);

/** Where a chip is relative to the row's view: its left and right edge minus the row's left edge, and the row's width. */
const chipPlace = (page: Page, exp: string): Promise<{ left: number; right: number; width: number }> => page.evaluate((e) => {
    const row = document.querySelector<HTMLElement>('[data-exp-row]')!;
    const box = row.getBoundingClientRect();
    const r = row.querySelector(`[data-exp-chip="${e}"]`)!.getBoundingClientRect();
    return { left: r.left - box.left, right: r.right - box.left, width: box.width };
}, exp);

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    const shots = process.env.SHOTS_DIR;
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
            const at = `${width}px ${scheme}`;

            // ---- start: scrolled to the left end; no scrollbar, a fade and > on the right only ----
            await page.evaluate(() => { document.querySelector<HTMLElement>('[data-exp-row]')!.scrollLeft = 0; });
            await rowSettled(page);
            const s0 = await rowState(page);
            assert.ok(s0.max > 0, `${at}: SPY has more expirations than fit (${s0.max} px hidden)`);
            assert.equal(s0.scrollbar, 0, `${at}: no horizontal scrollbar under the chips`);
            assert.deepEqual([s0.prev, s0.next], [0, 1], `${at}: at the left end only > shows`);
            assert.ok(/transparent|rgba\(0, 0, 0, 0\)/.test(s0.mask) && !/^linear-gradient\(to right, (transparent|rgba\(0, 0, 0, 0\))/.test(s0.mask), `${at}: only the right side fades (${s0.mask})`);
            if (shots) await page.screenshot({ path: join(shots, `exp-arrows-${width}-${scheme}-start.png`) });

            // ---- the > button has the app's tooltip ----
            const next = page.locator('[data-exp-scroll="next"]');
            await next.hover();
            await page.locator('[role=tooltip]').filter({ hasText: 'Show the next expiration' }).last().waitFor({ state: 'visible', timeout: 5000 });

            // ---- > reveals the first hidden chip on the right, fully and clear of the button ----
            const hiddenRight = await hiddenChips(page, 'right');
            assert.ok(hiddenRight.length > 0, `${at}: chips hidden on the right`);
            await next.click();
            await rowSettled(page);
            const p1 = await chipPlace(page, hiddenRight[0]);
            assert.ok(p1.left >= 0 && p1.right <= p1.width - FADE_PX + 1, `${at}: > brought ${hiddenRight[0]} into view (${p1.left.toFixed(1)}..${p1.right.toFixed(1)} of ${p1.width})`);
            const s1 = await rowState(page);
            assert.ok(s1.scrollLeft > 0, `${at}: the row scrolled (${s1.scrollLeft})`);
            assert.equal(s1.prev, 1, `${at}: < shows once there are chips on the left`);
            assert.ok(/^linear-gradient\(to right, (transparent|rgba\(0, 0, 0, 0\))/.test(s1.mask), `${at}: the left side fades too (${s1.mask})`);
            assert.equal(s1.panelH, s0.panelH, `${at}: the panel keeps its height (${s0.panelH} -> ${s1.panelH})`);
            if (shots) await page.screenshot({ path: join(shots, `exp-arrows-${width}-${scheme}-middle.png`) });

            // ---- at the right end: > is gone, only the left side fades ----
            await page.mouse.move(0, 0);
            await page.evaluate(() => { const r = document.querySelector<HTMLElement>('[data-exp-row]')!; r.scrollLeft = r.scrollWidth; });
            await rowSettled(page);
            const s2 = await rowState(page);
            assert.deepEqual([s2.prev, s2.next], [1, 0], `${at}: at the right end only < shows`);
            assert.ok(!/(transparent|rgba\(0, 0, 0, 0\)) 100%\)$/.test(s2.mask), `${at}: the right side no longer fades (${s2.mask})`);
            assert.equal(s2.panelH, s0.panelH, `${at}: the panel keeps its height at the end`);
            if (shots) await page.screenshot({ path: join(shots, `exp-arrows-${width}-${scheme}-end.png`) });

            // ---- < reveals the last hidden chip on the left ----
            const hiddenLeft = await hiddenChips(page, 'left');
            assert.ok(hiddenLeft.length > 0, `${at}: chips hidden on the left`);
            await page.locator('[data-exp-scroll="prev"]').click();
            await rowSettled(page);
            const p3 = await chipPlace(page, hiddenLeft[hiddenLeft.length - 1]);
            assert.ok(p3.left >= FADE_PX - 1 && p3.right <= p3.width, `${at}: < brought ${hiddenLeft[hiddenLeft.length - 1]} into view (${p3.left.toFixed(1)}..${p3.right.toFixed(1)})`);

            // ---- a vertical mouse wheel over the row scrolls it sideways ----
            const before = (await rowState(page)).scrollLeft;
            const rowBox = (await page.locator('[data-exp-row]').boundingBox())!;
            await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
            await page.mouse.wheel(0, -150);
            await page.waitForFunction((b) => document.querySelector<HTMLElement>('[data-exp-row]')!.scrollLeft < b, before, { timeout: 5000 });
            await rowSettled(page);

            // ---- the same panel on the other tabs: the buttons follow the row there too ----
            for (const tab of ['Board', 'GEX', 'Chart']) {
                await page.getByRole('button', { name: tab, exact: true }).first().click();
                await rowSettled(page);
                const s = await rowState(page);
                assert.equal(s.scrollbar, 0, `${at} ${tab}: no scrollbar`);
                assert.equal(s.panelH, s0.panelH, `${at} ${tab}: the same panel height`);
            }

            assert.deepEqual(errors, [], `${at}: no page errors`);
            console.log(`expirations arrows ${at}: ${s0.max} px of chips hidden, > revealed ${hiddenRight[0]}, < revealed ${hiddenLeft[hiddenLeft.length - 1]}`);
            await page.context().close();
        }
        console.log('expirations arrows e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
