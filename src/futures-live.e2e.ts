/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startFakeProxy, startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the TradingView live mode (src/futures-live.ts, README "Local proxy and TradingView live mode"): with
// the proxy found, a futures ticker (/YM) subscribes to the proxy's live stream; before the first snapshot it shows its
// file (CACHE <file time>); a snapshot and then deltas update the Desk IN PLACE (no reload, same tab, same scroll
// position) and the label becomes LIVE TV hh:mm:ss; an engine status "expired" turns it into TV LOGIN. The futures file
// is the cached SPY chain under the YM name (current dates, so the check does not age). A fake proxy stands in for
// scripts/options-local-proxy.ts + scripts/tv/live.ts. Run: `bun run test:e2e futures-live`.
// ============================================================================

const SETTINGS_KEY = 'gex.settings.v5';
const ROOT = join(__dirname, '..');

type Q = { symbol: string; expiration: string; bid: number | null; ask: number | null; last: number | null; volume: number | null; openInterest: number | null };

async function main(): Promise<void> {
    const file = JSON.parse(readFileSync(join(ROOT, 'api', 'options', 'SPY.json'), 'utf8')) as { symbol: string; updated: string; quotes: Q[]; expirations: string[] };
    file.symbol = 'YM';
    file.updated = '2026-10-25T21:40:00-04:00';
    // TradingView OI days (owner decision G10): every third quote carries an older one -> its Desk OI cell is pale
    file.quotes.forEach((q, i) => { (q as Q & { oiDate: string }).oiDate = i % 3 === 0 ? '2026-10-15' : '2026-10-23'; });
    const site = await startTestSite({ futures: { YM: JSON.stringify(file) } });
    const proxy = startFakeProxy();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
        await page.addInitScript(([key, value]) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); }, [SETTINGS_KEY, JSON.stringify({ proxyBase: proxy.base, lastTicker: '/YM' })] as const);
        await page.goto(site.url);
        const label = page.locator('[data-source-label]');
        const waitLabel = (re: RegExp, what: string) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-source-label]')?.textContent ?? ''), re.source, { timeout: 10000 })
            .catch(async () => assert.fail(`${what}: the label is "${await label.textContent()}", expected ${re}`));
        await waitLabel(/^CACHE 2026-10-25 21:40$/, 'before the stream: the file\'s own time');
        await page.waitForFunction(() => document.querySelectorAll('.od-atm').length > 0, null, { timeout: 10000 });
        const pale = await page.evaluate(() => document.querySelectorAll('[data-oi-stale]').length);
        assert.ok(pale > 0, 'OI cells older than the newest OI day are marked pale on the Desk');
        for (let i = 0; i < 50 && proxy.liveClients() === 0; i++) await page.waitForTimeout(100);
        assert.equal(proxy.liveClients(), 1, 'the app subscribed to the live stream of the proxy');

        await page.evaluate(() => {
            (window as unknown as { __noReload: boolean }).__noReload = true;
            const box = document.querySelector<HTMLElement>('[data-desk-scroll]');
            if (box) box.scrollTop += 37;
        });
        const scrollBefore = await page.evaluate(() => document.querySelector<HTMLElement>('[data-desk-scroll]')?.scrollTop ?? -1);
        const atmBefore = await page.locator('.od-atm').first().textContent();

        // the engine is still subscribing: the label says so (owner acceptance finding 2026-10-26), then goes live by itself
        proxy.sendLive('status', { state: 'starting', message: 'subscribing YM 3/4', until: null, since: Date.now(), progress: 'YM 3/4' });
        await waitLabel(/^TV starting… YM 3\/4$/, 'while the engine subscribes');
        proxy.sendLive('status', { state: 'live', message: 'streaming YM', until: null, since: Date.now() });
        proxy.sendLive('snapshot', { root: 'YM', payload: file });
        await waitLabel(/^LIVE TV \d\d:\d\d:\d\d$/, 'after the snapshot');
        // a delta: every option of the first expiration twice as expensive, OI x3
        const first = file.expirations[0];
        const rows = file.quotes.filter((q) => q.expiration === first && q.bid != null && q.ask != null)
            .map((q) => [q.symbol, q.bid! * 2, q.ask! * 2, q.last, q.volume, (q.openInterest ?? 0) * 3]);
        proxy.sendLive('delta', { root: 'YM', updated: '2026-10-26T14:05:07.000Z', rows });
        await waitLabel(/^LIVE TV 10:05:07$/, 'after the delta: its New York time');
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
