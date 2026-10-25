/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the empty ticker search: it hints the main symbols and a
// hint that does not fit on a small screen ends with an ellipsis (the
// placeholder needs its own text-overflow, the one on the input is not enough).
// Run: `bun run test:e2e`.
// ============================================================================

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch();
    try {
        for (const width of [1400, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 800 } });
            await page.goto(site.url);
            const ticker = page.locator('input[role=combobox]');
            await ticker.fill('');
            // the hint is the fetcher's default list from api/options/index.json, shown once the index is loaded
            await page.waitForFunction(() => (document.querySelector('input[role=combobox]')?.getAttribute('placeholder') ?? '').includes(','));
            const hint = (await ticker.getAttribute('placeholder')) ?? '';
            assert.ok(hint.startsWith('SPX, NDX, DJX, RUT'), `hint at ${width}px: ${hint}`);
            assert.ok(!/COMP|DJIA|INDU|NYA/.test(hint), `no index proxies without options in the hint: ${hint}`);
            assert.ok(!/etc|и др/i.test(hint), 'no "etc" in the hint');
            // getComputedStyle(e, '::placeholder') reports `clip` even when the ellipsis renders, so look for the rule itself
            const rule = await page.evaluate(() => {
                const found: string[] = [];
                const walk = (rules: CSSRuleList) => {
                    for (const r of Array.from(rules)) {
                        if (r instanceof CSSStyleRule && r.selectorText.includes('placeholder') && r.style.textOverflow === 'ellipsis') found.push(r.selectorText);
                        else if ('cssRules' in r) walk((r as CSSGroupingRule).cssRules);
                    }
                };
                for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
                return found;
            });
            assert.ok(rule.length > 0, `a ::placeholder rule with text-overflow: ellipsis at ${width}px`);
            await page.close();
        }
        // an index.json older than the `defaults` field (an old cache): a plain label as the hint, the backup preset unavailable
        const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
        await page.route('**/api/options/index.json', async (route) => {
            const res = await route.fetch();
            const json = (await res.json()) as Record<string, unknown>;
            delete json.defaults;
            await route.fulfill({ response: res, json });
        });
        await page.goto(site.url);
        const ticker = page.locator('input[role=combobox]');
        await ticker.fill('');
        await page.waitForTimeout(500);
        const plain = (await ticker.getAttribute('placeholder')) ?? '';
        assert.ok(plain === 'Ticker' || plain === 'Тикер', `hint without defaults: ${plain}`);
        console.log('ticker hint e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
