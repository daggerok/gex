/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Page } from 'playwright';
import { noProxy, startTestSite } from './e2e-site';

// ============================================================================
// Layout regression check. On a wide window (from `lg`, 1024 px) the Desk, Board, GEX and Chart tabs all fit the
// window: the page does not scroll (the Desk and Board tables scroll inside themselves, the GEX sidebar and Cursor list
// scroll inside themselves), the footer is pressed to the bottom of the window, nothing is left empty
// between the content and the footer, and the footer is ONE design on the three tabs: same box, same text
// style, same link look (only its text differs on Chart). Each of these broke at some point: the GEX page
// grew taller than the window (the footer was only reached by scrolling), the Chart tab left a gap above
// the footer (a hand-made height formula went stale), and the GEX tab had a taller footer area.
// Run: `bun run test:e2e`.
// ============================================================================

const SIZES: Array<[number, number]> = [[2000, 1140], [1500, 900], [1280, 720]];
const FOOTER_HEIGHT = 24; // min-h-6 at lg

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch();

    interface Look {
        inner: number;
        scrollHeight: number;
        footerTop: number;
        footerHeight: number;
        footerBottomGap: number;
        gapAbove: number;
        font: string[];
        link: string[];
        text: string;
        /** left and right edge of the top bar row (ticker input .. settings button) and of the tab content inside its side padding */
        gutters: { bar: [number, number]; content: [number, number] };
    }

    const look = (page: Page): Promise<Look> => page.evaluate(() => {
        const f = document.querySelector('footer') as HTMLElement;
        const r = f.getBoundingClientRect();
        // how far above the footer the lowest piece of content ends: a big number is an empty gap
        let lowest = 0;
        document.querySelectorAll('main *').forEach((e) => {
            const rr = (e as HTMLElement).getBoundingClientRect();
            if (rr.height > 0 && rr.bottom <= r.top + 1) lowest = Math.max(lowest, rr.bottom);
        });
        const cs = getComputedStyle(f);
        const ls = getComputedStyle(f.querySelector('a') as HTMLElement);
        return {
            inner: window.innerHeight,
            scrollHeight: document.documentElement.scrollHeight,
            footerTop: Math.round(r.top),
            footerHeight: Math.round(r.height),
            footerBottomGap: Math.round(window.innerHeight - r.bottom),
            gapAbove: Math.round(r.top - lowest),
            font: [cs.fontSize, cs.lineHeight, cs.color, cs.textAlign],
            link: [ls.textDecorationLine, ls.color],
            text: (f.textContent ?? '').trim(),
            gutters: (() => {
                const bar = (document.querySelector('input[role=combobox]') as HTMLElement).parentElement!.parentElement!.getBoundingClientRect();
                const m = Array.from(document.querySelectorAll('main')).find((e) => e.getBoundingClientRect().width > 0) as HTMLElement;
                const mr = m.getBoundingClientRect();
                const ms = getComputedStyle(m);
                return {
                    bar: [Math.round(bar.left), Math.round(bar.right)] as [number, number],
                    content: [Math.round(mr.left + parseFloat(ms.paddingLeft)), Math.round(mr.right - parseFloat(ms.paddingRight))] as [number, number],
                };
            })(),
        };
    });

    /** Where to look for each kind of break, per tab (shown in the error so nobody has to guess). */
    const HINTS: Record<string, Record<string, string>> = {
        scroll: {
            Desk: 'src/main.tsx: the Desk wrapper must keep `flex-1 min-h-0` and ChainTable its own `overflow-auto` (the table scrolls, not the page).',
            Board: 'src/main.tsx: the Board wrapper must keep `flex flex-1 min-h-0 flex-col` (and its parent `min-h-0`); src/views/BoardView.tsx: the table box keeps `flex-1 min-h-0 overflow-auto` (the table scrolls, not the page).',
            GEX: 'src/main.tsx: the GEX wrapper needs `lg:min-h-0 lg:shrink` (and its parent `lg:min-h-0`); src/views/GexView.tsx: `lg:min-h-0` on <main>, the grid, the <aside> (which scrolls inside) and the right column, and the chart box must only have a SMALL `lg:min-h-*`. Something with a fixed or large minimum height was probably added to the tab.',
            Chart: 'src/main.tsx: the Chart wrapper needs `lg:min-h-0 lg:shrink` (and its parent `lg:min-h-0`); src/views/ChartView.tsx: the chart must take the REMAINING height (`lg:flex-1 lg:min-h-0`), never a height computed from the window with a hand-made offset.',
        },
        gap: {
            Desk: 'something below the table adds padding or margin above the footer.',
            Board: 'src/views/BoardView.tsx: <main> must not have bottom padding or margin, the table box fills the height.',
            GEX: 'src/views/GexView.tsx: <main> must not have bottom padding or margin (the footer has its own 24 px), and the content must fill the height (`lg:flex-1 lg:min-h-0` down the chain).',
            Chart: 'src/views/ChartView.tsx: <main> must not have bottom padding or margin, and the chart section must fill the height (`lg:flex-1`); a fixed chart height or a height formula leaves empty space.',
        },
        gutter: {
            any: 'src/components/TopBar.tsx: the top bar row must use the same side padding as the tab content (`px-4 lg:px-6`, like <main> in the views, TabSwitcher and the footer).',
        },
        footer: {
            Desk: 'src/components/AttributionFooter.tsx: FOOTER_CLASS is the one footer design of all tabs.',
            Board: 'src/components/AttributionFooter.tsx: FOOTER_CLASS is the one footer design of all tabs.',
            GEX: 'src/components/AttributionFooter.tsx: FOOTER_CLASS is the one footer design of all tabs; and nothing may sit between the content and the footer.',
            Chart: 'src/components/AttributionFooter.tsx: AttributionFooter and RepoFooter must both use FOOTER_CLASS and FOOTER_LINK_CLASS, only their text differs.',
        },
    };

    const problems: string[] = [];
    const report = (size: string, tab: string, what: string, expected: string, got: string, hint: string) =>
        problems.push(`${tab} tab at ${size}: ${what}\n      expected: ${expected}\n      measured: ${got}\n      look at:  ${hint}`);

    try {
        for (const [width, height] of SIZES) {
            const size = `${width}x${height}`;
            const page = await browser.newPage({ viewport: { width, height } });
            const errors: string[] = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            await noProxy(page); // no local proxy: the app uses the CACHE provider by itself
            await page.goto(site.url);
            const ticker = page.locator('input[role=combobox]');
            await ticker.fill('SPY');
            await ticker.press('Enter');
            await page.waitForTimeout(2500);

            const looks: Record<string, Look> = {};
            // the upper part of Board, GEX and Chart is identical (owner 2026-10-25): the tab row, the shared Expirations panel,
            // and the Metrics + Levels row (components/ToolbarRow.tsx) at the same place and size; the Desk has no such row
            const toolbars: Record<string, string | null> = {};
            for (const tab of ['Desk', 'Board', 'GEX', 'Chart']) {
                await page.getByRole('button', { name: tab, exact: true }).first().click();
                await page.waitForTimeout(1800);
                toolbars[tab] = await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('[data-toolbar-row]')).filter((e) => (e as HTMLElement).offsetParent !== null);
                    if (rows.length !== 1) return rows.length ? `${rows.length} rows` : null;
                    const r = rows[0].getBoundingClientRect();
                    const kids = Array.from(rows[0].children).map((c) => `${c.getAttribute('aria-label') ?? c.tagName}:${Math.round(c.getBoundingClientRect().height)}`);
                    return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)} [${kids.join(' ')}]`;
                });
                const l = (looks[tab] = await look(page));
                // the Chart page may be 1 px over because of the chart library's own rounding, nothing more
                if (l.scrollHeight > l.inner + 1) {
                    report(size, tab, `THE PAGE SCROLLS, the footer is out of view (${l.scrollHeight - l.inner} px too tall)`,
                        `the tab fits the window (page height <= ${l.inner} px) on a window this wide, only the Desk and Board tables, the GEX sidebar and the Cursor list scroll inside themselves`,
                        `the page is ${l.scrollHeight} px high in a ${l.inner} px window`, HINTS.scroll[tab]);
                }
                if (Math.abs(l.gutters.bar[0] - l.gutters.content[0]) > 1 || Math.abs(l.gutters.bar[1] - l.gutters.content[1]) > 1) {
                    report(size, tab, 'THE TOP BAR IS NOT ALIGNED WITH THE CONTENT (ticker input on the left, settings button on the right)',
                        `the top bar row spans x ${l.gutters.content[0]}..${l.gutters.content[1]} like the content below it`,
                        `top bar x ${l.gutters.bar[0]}..${l.gutters.bar[1]}, content x ${l.gutters.content[0]}..${l.gutters.content[1]}`, HINTS.gutter.any);
                }
                if (l.footerHeight !== FOOTER_HEIGHT) {
                    report(size, tab, 'THE FOOTER HAS THE WRONG SIZE', `${FOOTER_HEIGHT} px high`, `${l.footerHeight} px high`, HINTS.footer[tab]);
                }
                if (Math.abs(l.footerBottomGap) > 1 && l.scrollHeight <= l.inner + 1) {
                    report(size, tab, 'THE FOOTER IS NOT AT THE BOTTOM OF THE WINDOW', 'the footer touches the bottom edge of the window',
                        `${l.footerBottomGap} px between the footer and the bottom edge`, HINTS.gap[tab]);
                }
                if (l.gapAbove > 1) {
                    report(size, tab, `EMPTY SPACE ABOVE THE FOOTER (${l.gapAbove} px)`, 'the content ends right where the footer starts (at most 1 px between them)',
                        `${l.gapAbove} px of empty space between the last content and the footer`, HINTS.gap[tab]);
                }
            }
            if (toolbars.Desk !== null) {
                report(size, 'Desk', 'THE DESK HAS A METRICS / LEVELS ROW', 'no toolbar row on the Desk (only Board, GEX and Chart have it)', String(toolbars.Desk), 'src/views/DeskView.tsx');
            }
            for (const tab of ['Board', 'Chart']) {
                if (!toolbars.GEX || toolbars[tab] !== toolbars.GEX) {
                    report(size, tab, 'THE METRICS / LEVELS ROW DIFFERS FROM THE GEX TAB', 'the same row (components/ToolbarRow.tsx) at the same position and size as on the GEX tab',
                        `${tab}: ${toolbars[tab]}  GEX: ${toolbars.GEX}`, 'src/components/ToolbarRow.tsx and the <main> wrapper of the tab (px-4 pt-4 lg:px-6)');
                }
            }
            // one footer design on the three tabs, only the text differs
            for (const tab of ['Board', 'GEX', 'Chart']) {
                const mine = { top: looks[tab].footerTop, height: looks[tab].footerHeight, font: looks[tab].font.join(' | '), link: looks[tab].link.join(' | ') };
                const desk = { top: looks.Desk.footerTop, height: looks.Desk.footerHeight, font: looks.Desk.font.join(' | '), link: looks.Desk.link.join(' | ') };
                if (JSON.stringify(mine) !== JSON.stringify(desk)) {
                    report(size, tab, `THE FOOTER LOOKS DIFFERENT FROM THE DESK FOOTER`, 'the same position, height, text style and link look as on the Desk tab (only the text differs)',
                        `${tab}: ${JSON.stringify(mine)}  Desk: ${JSON.stringify(desk)}`, HINTS.footer[tab]);
                }
            }
            if (!looks.Desk.text.includes('daggerok') || !looks.Board.text.includes('daggerok') || !looks.GEX.text.includes('daggerok')) {
                report(size, 'Desk/GEX', 'THE PROJECT FOOTER IS MISSING', 'the text "daggerok (c) <year>"', `Desk: "${looks.Desk.text}", GEX: "${looks.GEX.text}"`, HINTS.footer.GEX);
            }
            if (!looks.Chart.text.includes('TradingView')) {
                report(size, 'Chart', 'THE CHART LIBRARY ATTRIBUTION IS MISSING', 'the TradingView Lightweight Charts notice (a licence requirement)', `"${looks.Chart.text}"`, HINTS.footer.Chart);
            }
            if (errors.length) report(size, 'any', 'THE PAGE THREW AN ERROR', 'no page errors', errors.join('; '), 'the browser console of the failing tab');
            await page.close();
        }
        if (problems.length) {
            throw new Error(`\n\nLAYOUT REGRESSION: ${problems.length} problem(s). The Desk, Board, GEX and Chart tabs must fit the window (no page scroll), keep one footer design pressed to the bottom, and leave no gap above it. Reference: the same measurements on https://daggerok.github.io/gex/.\n\n${problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n\n')}\n`);
        }
        console.log('layout e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
