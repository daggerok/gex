/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { scrollSettled, slowCpu, startFakeProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the TradingView live mode (src/futures-live.ts, README "Local proxy and TradingView live mode"): with
// the proxy found, a futures ticker (/YM) subscribes to the proxy's live stream; before the first snapshot it shows its
// file (CACHE <file time>); a snapshot and then deltas update the Desk IN PLACE (no reload, same tab, same scroll
// position) and the label becomes LIVE TV hh:mm:ss; an engine status "expired" turns it into TV LOGIN. The futures file
// is the cached SPY chain under the YM name (current dates, so the check does not age). Fast start (2026-10-26): the page
// names its selected expirations (/api/futures/focus) and the label carries the websocket progress until it is done. A
// fake proxy stands in for scripts/options-local-proxy.ts + scripts/tv/live.ts. Run: `bun run test:e2e futures-live`.
// ============================================================================

const SETTINGS_KEY = 'gex.settings.v5';
const ROOT = join(__dirname, '..');

type Q = { symbol: string; expiration: string; bid: number | null; ask: number | null; last: number | null; volume: number | null; openInterest: number | null };

async function main(): Promise<void> {
    const file = JSON.parse(readFileSync(join(ROOT, 'api', 'options', 'SPY.json'), 'utf8')) as { symbol: string; updated: string; quotes: Q[]; expirations: string[] };
    file.symbol = 'YM';
    file.updated = '2026-10-25T21:40:00-04:00';
    // TradingView OI days: every third quote carries an older one -> its Desk OI cell names the day in a tooltip (G10)
    file.quotes.forEach((q, i) => { (q as Q & { oiDate: string }).oiDate = i % 3 === 0 ? '2026-10-15' : '2026-10-23'; });
    const site = await startTestSite({ futures: { YM: JSON.stringify(file) } });
    const proxy = startFakeProxy();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
        await slowCpu(page);
        await page.addInitScript(([key, value]) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); }, [SETTINGS_KEY, JSON.stringify({ proxyBase: proxy.base, lastTicker: '/YM' })] as const);
        // The user scrolls the Desk WHILE it centers its ATM row: on the first scroll event of the desk (the centering's first
        // step; its next retry is due in the coming animation frame) a wheel scrolls 37 px. Before the fix that retry put the
        // view back on the ATM row (1827 -> 1790, the 2026-10-26 flake when the check's own scroll landed in that frame);
        // done here on purpose, the race is the same on every run instead of now and then.
        await page.addInitScript(() => {
            const w = window as unknown as { __userScroll?: number };
            document.addEventListener('scroll', (e) => {
                const box = e.target as HTMLElement;
                if (w.__userScroll !== undefined || !box.hasAttribute?.('data-desk-scroll')) return;
                box.dispatchEvent(new WheelEvent('wheel', { deltaY: 37, bubbles: true }));
                box.scrollTop += 37;
                w.__userScroll = box.scrollTop;
            }, true);
        });
        await page.goto(site.url);
        const label = page.locator('[data-source-label]');
        const waitLabel = (re: RegExp, what: string) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-source-label]')?.textContent ?? ''), re.source, { timeout: 10000 })
            .catch(async () => assert.fail(`${what}: the label is "${await label.textContent()}", expected ${re}`));
        await waitLabel(/^CACHE 2026-10-25 21:40$/, 'before the stream: the file\'s own time');
        await page.waitForFunction(() => document.querySelectorAll('.od-atm').length > 0, null, { timeout: 10000 });
        const since = await page.evaluate(() => document.querySelectorAll('[data-oi-since]').length);
        assert.ok(since > 0, 'OI cells dated before the newest OI day carry their date (tooltip) on the Desk');
        for (let i = 0; i < 50 && proxy.liveClients() === 0; i++) await page.waitForTimeout(100);
        assert.equal(proxy.liveClients(), 1, 'the app subscribed to the live stream of the proxy');

        await page.waitForFunction(() => (window as unknown as { __userScroll?: number }).__userScroll !== undefined, null, { timeout: 10000 });
        const userScroll = await page.evaluate(() => (window as unknown as { __userScroll: number }).__userScroll);
        const scrollBefore = await scrollSettled(page, '[data-desk-scroll]');
        assert.ok(Math.abs(scrollBefore - userScroll) <= 2, `a wheel while the Desk centers its ATM row wins (${userScroll} -> ${scrollBefore})`);
        await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });
        const atmBefore = await page.locator('.od-atm').first().textContent();

        // the engine is still subscribing: the label says so (owner acceptance finding 2026-10-26), then goes live by itself
        proxy.sendLive('status', { state: 'starting', message: 'subscribing YM 3/4', until: null, since: Date.now(), progress: 'YM 3/4' });
        await waitLabel(/^TV starting… YM 3\/4$/, 'while the engine subscribes');
        // fast start: the page told the proxy which expirations it shows (they join the websocket first)
        for (let i = 0; i < 50 && !proxy.hits.some((h) => h.path === '/api/futures/focus'); i++) await page.waitForTimeout(100);
        const focus = proxy.hits.find((h) => h.path === '/api/futures/focus');
        assert.ok(focus, 'the page called /api/futures/focus');
        const focusParams = new URLSearchParams(focus!.query ?? '');
        assert.equal(focusParams.get('root'), 'YM', 'focus names the root');
        assert.ok((focusParams.get('exps') ?? '').split(',').every((e) => file.expirations.includes(e)) && !!focusParams.get('exps'), `focus names the selected expirations: ${focus!.query}`);
        // the scanner snapshot makes the page live while the websocket subscription runs; the tooltip names the progress
        proxy.sendLive('status', { state: 'live', message: 'streaming YM (websocket 3,200 of 5,560 options, the rest from the scanner)', until: null, since: Date.now(), subscribed: { YM: [3200, 5560] } });
        proxy.sendLive('snapshot', { root: 'YM', payload: file });
        await waitLabel(/^LIVE TV \d\d:\d\d:\d\d$/, 'after the snapshot');
        await page.waitForFunction(() => document.querySelector('[data-source-label]')?.getAttribute('data-source-progress') === 'YM 3,200/5,560', null, { timeout: 5000 })
            .catch(async () => assert.fail(`the label carries the subscription progress: "${await label.getAttribute('data-source-progress')}"`));
        proxy.sendLive('status', { state: 'live', message: 'streaming YM', until: null, since: Date.now(), subscribed: { YM: [5560, 5560] } });
        await page.waitForFunction(() => !document.querySelector('[data-source-label]')?.hasAttribute('data-source-progress'), null, { timeout: 5000 })
            .catch(() => assert.fail('the progress goes away once every option streams'));
        // a delta: every option of the first expiration twice as expensive, OI x3
        const first = file.expirations[0];
        const rows = file.quotes.filter((q) => q.expiration === first && q.bid != null && q.ask != null)
            .map((q) => [q.symbol, q.bid! * 2, q.ask! * 2, q.last, q.volume, (q.openInterest ?? 0) * 3]);
        proxy.sendLive('delta', { root: 'YM', updated: '2026-10-26T14:05:07.000Z', rows });
        await waitLabel(/^LIVE TV 10:05:07$/, 'after the delta: its New York time');
        await page.waitForFunction(() => /^CME open interest of 2026-10-22/.test(document.querySelector('[data-source-label]')?.getAttribute('data-source-note') ?? ''), null, { timeout: 5000 })
            .catch(async () => assert.fail(`the source tooltip has the CME cross-check line: "${await page.locator('[data-source-label]').getAttribute('data-source-note')}"`));
        await page.waitForFunction(() => /as of \d{4}-\d{2}-\d{2} 10:05:07 ET · LIVE TV/.test(document.body.textContent ?? ''), null, { timeout: 5000 })
            .catch(() => assert.fail('the Desk header says LIVE TV with the time of the last update, like the top label'));
        await page.waitForFunction((before) => document.querySelector('.od-atm')?.textContent !== before, atmBefore, { timeout: 8000 })
            .catch(() => assert.fail('the Desk ATM row did not change after the delta (bid and ask x2, OI x3)'));
        assert.equal(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload), true, 'no page reload');
        const scrollAfter = await page.evaluate(() => document.querySelector<HTMLElement>('[data-desk-scroll]')?.scrollTop ?? -1);
        assert.ok(Math.abs(scrollAfter - scrollBefore) <= 2, `the Desk keeps its scroll position (${scrollBefore} -> ${scrollAfter})`);
        const ms = await page.evaluate(() => performance.getEntriesByName('futures-live-reload').map((e) => Math.round(e.duration)));
        assert.ok(ms.length >= 1, 'a live update was measured');

        proxy.sendLive('status', { state: 'expired', message: 'log in to tradingview.com in Chrome', until: null, since: Date.now() });
        await waitLabel(/^TV LOGIN$/, 'the engine lost the session');
        await page.close();

        // TradingView hybrid: a stock loaded live through CBOE follows /api/tv/live once it delivers (15 min delayed label);
        // a status without data keeps LIVE CBOE
        const spy = JSON.parse(readFileSync(join(ROOT, 'api', 'options', 'SPY.json'), 'utf8')) as typeof file;
        const page2 = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
        await page2.addInitScript(([key, value]) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); }, [SETTINGS_KEY, JSON.stringify({ proxyBase: proxy.base, lastTicker: 'SPY' })] as const);
        await page2.goto(site.url);
        const label2 = () => page2.locator('[data-source-label]').textContent();
        const wait2 = (re: RegExp, what: string) => page2.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-source-label]')?.textContent ?? ''), re.source, { timeout: 10000 })
            .catch(async () => assert.fail(`${what}: the label is "${await label2()}", expected ${re}`));
        await wait2(/^LIVE CBOE$/, 'SPY through the proxy');
        for (let i = 0; i < 50 && proxy.liveClients() === 0; i++) await page2.waitForTimeout(100);
        assert.equal(proxy.liveClients(), 1, 'the app subscribed to the TradingView hybrid stream');
        assert.ok(proxy.hits.some((h) => h.path === '/api/tv/live'), 'the hybrid stream is /api/tv/live');
        proxy.sendLive('status', { state: 'starting', message: 'starting', until: null, since: Date.now() });
        await page2.waitForTimeout(1500);
        assert.equal(await label2(), 'LIVE CBOE', 'no data from TradingView yet: the provider keeps its label');
        await page2.waitForFunction(() => document.querySelectorAll('.od-atm').length > 0, null, { timeout: 10000 });
        const atm2 = await page2.locator('.od-atm').first().textContent();
        proxy.sendLive('status', { state: 'live', message: 'streaming SPY', until: null, since: Date.now() });
        proxy.sendLive('snapshot', { root: 'SPY', payload: spy });
        const first2 = spy.expirations[0];
        proxy.sendLive('delta', { root: 'SPY', updated: '2026-10-26T14:05:07.000Z', rows: spy.quotes.filter((q) => q.expiration === first2 && q.bid != null && q.ask != null).map((q) => [q.symbol, q.bid! * 2, q.ask! * 2, q.last, q.volume, q.openInterest]) });
        await wait2(/^TV 15m delayed 10:05:07$/, 'SPY from the TradingView hybrid');
        await page2.waitForFunction((before) => document.querySelector('.od-atm')?.textContent !== before, atm2, { timeout: 8000 })
            .catch(() => assert.fail('the Desk ATM row of SPY did not change after the hybrid delta'));
        console.log(`futures live e2e: ok (live update, event to committed chain: ${ms.join(', ')} ms; hybrid SPY ok)`);
    } finally {
        await browser.close();
        proxy.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
