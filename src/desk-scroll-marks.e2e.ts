/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { noProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the Desk's scroll marks strip (the Board's strip, components/ScrollMarks.tsx, inside ChainTable): it sits
// right of the desk card, as tall as it, outside the card (the desk keeps its width, the page does not scroll); its ticks
// are every row on screen in order (each expiration bar, then the strikes of an expanded expiration), a collapsed
// expiration is only its bar's tick; each expanded expiration's ATM row is a marked tick; a click on the tick of a row out
// of view glides that row to the middle of the desk below the pile of bars; hovering a tick shows the app's tooltip.
// Desktop light and phone dark. Run: `bun run test:e2e`; SHOTS_DIR=<dir> also saves screenshots there.
// ============================================================================

interface Tick { kind: string; keys: string[] }

const ticksOf = (page: Page): Promise<Tick[]> =>
    page.locator('.od-scroll-wrap [data-scroll-tick]').evaluateAll((els) => els.map((e) => ({ kind: e.getAttribute('data-scroll-tick') ?? '', keys: (e.getAttribute('data-scroll-keys') ?? '').split(',') })));

/** The rows the desk shows, as the strip's keys: `exp|` for each bar, `exp|strike` for each strike of an expanded expiration. */
const rowKeysOf = (page: Page): Promise<string[]> =>
    page.evaluate(() => Array.from(document.querySelectorAll('.od-sec')).flatMap((sec) => {
        const exp = sec.getAttribute('data-exp') ?? '';
        const open = sec.querySelector('button.od-bar')?.getAttribute('aria-expanded') === 'true';
        const strikes = open ? Array.from(sec.querySelectorAll('[data-desk-row]')).map((r) => `${exp}|${r.getAttribute('data-desk-row')}`) : [];
        return [`${exp}|`, ...strikes];
    }));

/** Where a strike row sits in the visible part of the desk below the pile of bars above its section: 0 = top, 1 = bottom. */
function rowPlace(page: Page, key: string): Promise<number | null> {
    return page.evaluate((k) => {
        const cut = k.lastIndexOf('|');
        const exp = k.slice(0, cut);
        const box = document.querySelector('[data-desk-scroll]');
        const secs = Array.from(document.querySelectorAll('.od-sec'));
        const idx = secs.findIndex((s) => s.getAttribute('data-exp') === exp);
        const row = secs[idx]?.querySelector(`[data-desk-row="${k.slice(cut + 1)}"]`);
        const bar = secs[idx]?.querySelector('button.od-bar');
        if (!box || !row || !bar) return null;
        const b = box.getBoundingClientRect();
        const top = b.top + (idx + 1) * bar.getBoundingClientRect().height;
        const r = row.getBoundingClientRect();
        return (r.top + r.height / 2 - top) / (b.bottom - top);
    }, key);
}

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
            await page.waitForTimeout(2500);
            await page.getByRole('button', { name: 'Desk', exact: true }).first().click();
            // the Desk shows the nearest expiration; select a few more so there are several sections
            const chips = page.locator('[data-exp-chip]');
            if (await chips.count()) for (let i = 1; i < 4; i++) await chips.nth(i).click().catch(() => {});
            await page.waitForTimeout(2500);
            const at = `${width}px ${scheme}`;
            const exps = await page.locator('.od-sec').evaluateAll((els) => els.map((e) => e.getAttribute('data-exp') ?? ''));
            assert.ok(exps.length >= 2, `${at}: several expirations on the desk (${exps.join(', ')})`);

            // ---- the strip: right of the card, as tall as it, inside the window; the page does not scroll ----
            const geo = await page.evaluate(() => {
                const card = document.querySelector('[data-desk-scroll]')!.getBoundingClientRect();
                const strip = document.querySelector('.od-scroll-wrap [data-scroll-marks]')!.getBoundingClientRect();
                const main = document.querySelector('.table-container')!.closest('main')!.getBoundingClientRect();
                return { card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom }, strip: { left: strip.left, right: strip.right, top: strip.top, bottom: strip.bottom, width: strip.width }, main: { left: main.left, right: main.right }, win: window.innerWidth, pageW: document.documentElement.scrollWidth };
            });
            assert.ok(geo.strip.left >= geo.card.right, `${at}: the strip is right of the card (${geo.strip.left} >= ${geo.card.right})`);
            assert.ok(geo.strip.width >= 6 && geo.strip.width <= 8, `${at}: the strip is 6-8 px wide (${geo.strip.width})`);
            assert.ok(Math.abs(geo.strip.top - geo.card.top) <= 1 && Math.abs(geo.strip.bottom - geo.card.bottom) <= 1, `${at}: the strip is as tall as the card`);
            assert.ok(geo.strip.right <= geo.win, `${at}: the strip is inside the window (${geo.strip.right} <= ${geo.win})`);
            assert.ok(geo.pageW <= geo.win, `${at}: no horizontal page scroll (${geo.pageW} > ${geo.win})`);
            // layout unchanged: the card still spans the Desk's content box (its padding is the gutter the strip lives in)
            const pad = width >= 1024 ? 24 : 16;
            assert.ok(Math.abs(geo.card.left - geo.main.left - pad) <= 1 && Math.abs(geo.main.right - geo.card.right - pad) <= 1, `${at}: the card keeps its width (${geo.card.left}..${geo.card.right} in ${geo.main.left}..${geo.main.right})`);
            const fit = await page.evaluate(() => ({ page: document.documentElement.scrollHeight, inner: window.innerHeight, footer: Math.round(document.querySelector('footer')!.getBoundingClientRect().bottom) }));
            assert.ok(fit.page <= fit.inner + 1, `${at}: the page does not scroll (${fit.page} in ${fit.inner})`);
            assert.ok(Math.abs(fit.footer - fit.inner) <= 1, `${at}: the footer is at the bottom of the window`);

            // ---- every row on screen is on the strip once, in order, across the expanded sections ----
            let rows = await rowKeysOf(page);
            let ticks = await ticksOf(page);
            assert.ok(ticks.length > 0 && ticks.length <= rows.length, `${at}: ${ticks.length} ticks for ${rows.length} rows`);
            assert.deepEqual(ticks.flatMap((t) => t.keys), rows, `${at}: the ticks cover every row once, in order`);
            assert.ok(rows.length > exps.length * 2, `${at}: the sections are expanded (${rows.length} rows)`);
            const atmKeys = await page.evaluate(() => Array.from(document.querySelectorAll('.od-sec')).flatMap((sec) => {
                const atm = sec.querySelector('.od-drow.od-atm');
                return atm ? [`${sec.getAttribute('data-exp')}|${atm.getAttribute('data-desk-row')}`] : [];
            }));
            assert.equal(atmKeys.length, exps.length, `${at}: an ATM row in every section`);
            for (const k of atmKeys) {
                const tick = ticks.find((t) => t.keys.includes(k));
                assert.ok(tick && tick.kind !== 'row', `${at}: the ATM row ${k} has a marked tick (${tick?.kind})`);
            }
            const signed = await page.locator('.od-scroll-wrap [data-scroll-tick="row"]').count();
            assert.ok(signed > 0, `${at}: plain strike ticks in their Net GEX colour`);
            console.log(`desk scroll marks ${at}: ${ticks.length} ticks for ${rows.length} rows in ${exps.length} expirations`);
            if (shots) await page.screenshot({ path: join(shots, `desk-scroll-marks-${width}-${scheme}.png`) });

            // ---- no frame over the rows in view (owner 2026-10-25: less overwhelming) ----
            assert.equal(await page.locator('.od-scroll-wrap [data-scroll-frame]').count(), 0, `${at}: the strip has no visible window frame`);

            // ---- a click on a tick of a strike far below the view glides that row to the middle ----
            const plainIdx = ticks.map((t, i) => (t.keys.every((k) => !k.endsWith('|')) ? i : -1)).filter((i) => i >= 0);
            const pick = plainIdx[Math.floor(plainIdx.length * 0.6)];
            const tick = page.locator('.od-scroll-wrap [data-scroll-tick]').nth(pick);
            const keys = ticks[pick].keys;
            const before = await Promise.all(keys.map((k) => rowPlace(page, k)));
            assert.ok(before.every((p) => p !== null && p > 1), `${at}: the target rows ${keys.join(',')} are out of view below (${before.join(', ')})`);
            await tick.click();
            await page.waitForTimeout(1200);
            const after = await Promise.all(keys.map((k) => rowPlace(page, k)));
            assert.ok(after.some((p) => p !== null && p > 1 / 3 && p < 2 / 3), `${at}: after the click the row is in the middle third (${after.join(', ')})`);
            if (shots) await page.screenshot({ path: join(shots, `desk-scroll-marks-${width}-${scheme}-clicked.png`) });

            // ---- hover: the app's tooltip with the expiration and strike ----
            await tick.hover();
            await page.waitForTimeout(500);
            const tip = page.locator('[role=tooltip]').filter({ hasText: 'Net GEX' }).last();
            assert.ok(await tip.isVisible(), `${at}: hovering a tick shows a tooltip`);
            const tipText = await tip.innerText();
            assert.ok(tipText.includes(keys[0].split('|')[0]), `${at}: the tooltip names the expiration (${tipText})`);

            // ---- collapsed sections: one tick each (their bar), the expanded ones keep every row ----
            await page.mouse.move(0, 0);
            await page.getByRole('button', { name: 'Collapse all' }).click();
            await page.waitForTimeout(800);
            ticks = await ticksOf(page);
            assert.deepEqual(ticks.flatMap((t) => t.keys), exps.map((e) => `${e}|`), `${at}: all collapsed: one tick per expiration bar`);
            assert.ok(ticks.every((t) => t.kind === 'section'), `${at}: the bar ticks are section ticks`);
            await page.locator(`.od-sec[data-exp="${exps[1]}"] > button.od-bar`).click();
            await page.waitForTimeout(1500);
            rows = await rowKeysOf(page);
            ticks = await ticksOf(page);
            assert.deepEqual(ticks.flatMap((t) => t.keys), rows, `${at}: one expanded among collapsed: the ticks follow the rows`);
            assert.ok(rows.filter((k) => k.startsWith(`${exps[1]}|`)).length > 1 && rows.filter((k) => !k.startsWith(`${exps[1]}|`)).every((k) => k.endsWith('|')), `${at}: only ${exps[1]} has strike ticks`);
            if (shots) await page.screenshot({ path: join(shots, `desk-scroll-marks-${width}-${scheme}-one-expanded.png`) });

            assert.deepEqual(errors, [], `${at}: no page errors`);
            await page.context().close();
        }
        console.log('desk scroll marks e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
