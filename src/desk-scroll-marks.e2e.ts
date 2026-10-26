/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { noProxy, scrollSettled, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the Desk's scroll marks strip (the Board's strip, components/ScrollMarks.tsx, inside ChainTable): it sits
// right of the desk card, as tall as it, outside the card (the desk keeps its width, the page does not scroll); simplified
// like the Board (owner 2026-10-26, #219) its ticks are, in row order, each expiration bar (grey) and, of an expanded
// expiration, only its ATM row (Spot colour) and its peak and runner-up rows (Net GEX sign colours): no plain rows, no
// levels; a collapsed expiration is only its bar's tick; a click on the tick of a row out of view glides that row to the
// middle of the desk below the pile of bars; hovering a tick shows the app's tooltip. Every wait is on a condition, never
// a fixed sleep. Desktop light and phone dark. Run: `bun run test:e2e`; SHOTS_DIR=<dir> also saves screenshots there.
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
            await page.getByRole('button', { name: 'Desk', exact: true }).first().click();
            // the Desk shows the nearest expiration; select a few more so there are several sections
            const chips = page.locator('[data-exp-chip]');
            await chips.nth(3).waitFor({ state: 'attached', timeout: 20_000 });
            await page.locator('.od-sec').first().waitFor({ timeout: 20_000 });
            for (let i = 1; i < 4; i++) await chips.nth(i).click();
            await page.waitForFunction(() => document.querySelectorAll('.od-sec').length >= 4 && document.querySelectorAll('.od-scroll-wrap [data-scroll-tick="atm"]').length >= 4, undefined, { timeout: 20_000 });
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

            // ---- only the bars, the ATM rows and the peak and runner-up rows are on the strip, once each, in row order ----
            let rows = await rowKeysOf(page);
            let ticks = await ticksOf(page);
            const tickKeys = ticks.flatMap((t) => t.keys);
            assert.ok(rows.length > exps.length * 2, `${at}: the sections are expanded (${rows.length} rows)`);
            assert.ok(tickKeys.length > exps.length * 2 && tickKeys.length < rows.length / 2, `${at}: ${tickKeys.length} marked of ${rows.length} rows`);
            assert.deepEqual(tickKeys, rows.filter((k) => tickKeys.includes(k)), `${at}: the ticks are rows of the desk, once each, in order`);
            for (const e of exps) assert.ok(tickKeys.includes(`${e}|`), `${at}: the bar of ${e} has a tick`);
            assert.ok(ticks.every((t) => ['section', 'atm', 'peak', 'second'].includes(t.kind)), `${at}: no plain or level ticks (${Array.from(new Set(ticks.map((t) => t.kind))).join(', ')})`);
            const atmKeys = await page.evaluate(() => Array.from(document.querySelectorAll('.od-sec')).flatMap((sec) => {
                const atm = sec.querySelector('.od-drow.od-atm');
                return atm ? [`${sec.getAttribute('data-exp')}|${atm.getAttribute('data-desk-row')}`] : [];
            }));
            assert.equal(atmKeys.length, exps.length, `${at}: an ATM row in every section`);
            for (const k of atmKeys) {
                const tick = ticks.find((t) => t.keys.includes(k));
                assert.ok(tick && tick.kind === 'atm', `${at}: the ATM row ${k} has an ATM tick (${tick?.kind})`);
            }
            // every expanded expiration has at least its Net GEX walls (peaks) besides the ATM row
            for (const e of exps) assert.ok(ticks.some((t) => t.kind === 'peak' && t.keys.some((k) => k.startsWith(`${e}|`) && !k.endsWith('|'))), `${at}: ${e} has peak ticks`);
            // peak and runner-up ticks use only the Net GEX sign colours (a zero Net GEX: the neutral grey)
            const allowed = await page.evaluate(() => {
                const probe = document.createElement('span');
                document.body.appendChild(probe);
                const css = (v: string) => { probe.style.backgroundColor = ''; probe.style.backgroundColor = v; return getComputedStyle(probe).backgroundColor; };
                const root = getComputedStyle(document.documentElement);
                const out = [css(root.getPropertyValue('--gex-pos').trim()), css(root.getPropertyValue('--gex-neg').trim()), css('#94a3b8')];
                probe.remove();
                return out;
            });
            const signColors = await page.locator('.od-scroll-wrap [data-scroll-tick="peak"], .od-scroll-wrap [data-scroll-tick="second"]').evaluateAll((els) => els.map((e) => getComputedStyle(e.querySelector('span') as HTMLElement).backgroundColor));
            assert.ok(signColors.length > 0 && signColors.every((c) => allowed.includes(c)), `${at}: peak and runner-up ticks in the Net GEX sign colours ${allowed.join(' / ')} (${Array.from(new Set(signColors)).join(', ')})`);
            console.log(`desk scroll marks ${at}: ${ticks.length} ticks (${tickKeys.length} rows) of ${rows.length} rows in ${exps.length} expirations`);
            if (shots) await page.screenshot({ path: join(shots, `desk-scroll-marks-${width}-${scheme}.png`) });

            // ---- no frame over the rows in view (owner 2026-10-25: less overwhelming) ----
            assert.equal(await page.locator('.od-scroll-wrap [data-scroll-frame]').count(), 0, `${at}: the strip has no visible window frame`);

            // ---- a click on a tick of a strike far below the view (in the last expiration) glides that row to the middle ----
            const lastExp = exps[exps.length - 1];
            const pick = ticks.findIndex((t) => t.keys.every((k) => k.startsWith(`${lastExp}|`) && !k.endsWith('|')));
            assert.ok(pick >= 0, `${at}: a strike tick in the last expiration ${lastExp}`);
            const tick = page.locator('.od-scroll-wrap [data-scroll-tick]').nth(pick);
            const keys = ticks[pick].keys;
            const before = await Promise.all(keys.map((k) => rowPlace(page, k)));
            assert.ok(before.every((p) => p !== null && p > 1), `${at}: the target rows ${keys.join(',')} are out of view below (${before.join(', ')})`);
            await tick.click();
            // the glide takes ~1.5 s on a long table (longer on a slow runner): wait until it stops, not a fixed time
            await scrollSettled(page, '[data-desk-scroll]');
            const after = await Promise.all(keys.map((k) => rowPlace(page, k)));
            assert.ok(after.some((p) => p !== null && p > 1 / 3 && p < 2 / 3), `${at}: after the click the row is in the middle third (${after.join(', ')})`);
            if (shots) await page.screenshot({ path: join(shots, `desk-scroll-marks-${width}-${scheme}-clicked.png`) });

            // ---- hover: the app's tooltip with the expiration and strike ----
            await tick.hover();
            const tip = page.locator('[role=tooltip]').filter({ hasText: 'Net GEX' }).last();
            await tip.waitFor({ state: 'visible', timeout: 5000 });
            const tipText = await tip.innerText();
            assert.ok(tipText.includes(keys[0].split('|')[0]), `${at}: the tooltip names the expiration (${tipText})`);

            // ---- collapsed sections: one tick each (their bar), the expanded ones keep every row ----
            await page.mouse.move(0, 0);
            await page.getByRole('button', { name: 'Collapse all' }).click();
            await page.waitForFunction((n) => document.querySelectorAll('.od-scroll-wrap [data-scroll-tick]').length === n && document.querySelectorAll('.od-scroll-wrap [data-scroll-tick="section"]').length === n, exps.length, { timeout: 10_000 });
            ticks = await ticksOf(page);
            assert.deepEqual(ticks.flatMap((t) => t.keys), exps.map((e) => `${e}|`), `${at}: all collapsed: one tick per expiration bar`);
            assert.ok(ticks.every((t) => t.kind === 'section'), `${at}: the bar ticks are section ticks`);
            await page.locator(`.od-sec[data-exp="${exps[1]}"] > button.od-bar`).click();
            await page.waitForFunction((n) => document.querySelectorAll('.od-scroll-wrap [data-scroll-tick]').length > n && document.querySelectorAll('.od-scroll-wrap [data-scroll-tick="atm"]').length === 1, exps.length, { timeout: 10_000 });
            rows = await rowKeysOf(page);
            ticks = await ticksOf(page);
            const oneKeys = ticks.flatMap((t) => t.keys);
            assert.deepEqual(oneKeys, rows.filter((k) => oneKeys.includes(k)), `${at}: one expanded among collapsed: the ticks follow the rows`);
            assert.ok(oneKeys.filter((k) => !k.endsWith('|')).length > 1 && oneKeys.filter((k) => !k.startsWith(`${exps[1]}|`)).every((k) => k.endsWith('|')), `${at}: only ${exps[1]} has strike ticks`);
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
