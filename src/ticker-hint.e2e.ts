/// <reference types="node" />
/// <reference types="bun" />
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the empty ticker search: it hints the main symbols and a
// hint that does not fit on a small screen ends with an ellipsis (the
// placeholder needs its own text-overflow, the one on the input is not enough).
// Run: `bun run test:e2e`.
// ============================================================================

const site = await startTestSite();
const browser = await chromium.launch();
try {
    for (const width of [1400, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        await page.goto(site.url);
        const ticker = page.locator('input[role=combobox]');
        await ticker.fill('');
        const hint = (await ticker.getAttribute('placeholder')) ?? '';
        assert.ok(hint.startsWith('SPX, NDX, DJX, RUT'), `hint at ${width}px: ${hint}`);
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
    console.log('ticker hint e2e: ok');
} finally {
    await browser.close();
    site.close();
}
