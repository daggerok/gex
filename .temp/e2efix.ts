import { readFileSync, writeFileSync } from 'node:fs';
const edit = (f: string, a: string, b: string) => { const s = readFileSync(f, 'utf8'); if (!s.includes(a)) throw new Error(f + ' missing ' + a.slice(0, 80)); writeFileSync(f, s.replace(a, b)); };
edit('src/custom-levels-gex.e2e.ts', `        // the proposed colour follows the price: a strike above the spot (778.57 for SPY) is greenish, below it reddish
        const swatchHex = () => page.locator('button[aria-label="Level colour"]').evaluate((e: HTMLElement) => {
            const m = /(\\d+), (\\d+), (\\d+)/.exec(getComputedStyle(e).backgroundColor)!;
            return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
        });
        assert.ok(ABOVE.includes(await swatchHex()), 'a level above the price starts greenish');
        await page.keyboard.press('Escape');
        const box = (await page.locator('.recharts-wrapper').first().boundingBox())!;
        const low = { x: box.x + box.width * 0.3, y: p.y };
        await page.mouse.move(low.x - 20, low.y);
        await page.mouse.move(low.x, low.y, { steps: 6 });
        await page.waitForTimeout(250);
        await page.mouse.click(low.x, low.y, { button: 'right' });
        assert.ok(BELOW.includes(await swatchHex()), 'a level below the price starts reddish');`, `        // the proposed colour follows the price: a strike above the spot is greenish, below it reddish. Which side the
        // middle of the plot is on depends on the cached SPY file, so the side is read from the default name (checked
        // against SPOT above), and the second click goes to the other edge of the plot so both colours are covered
        const swatchHex = () => page.locator('button[aria-label="Level colour"]').evaluate((e: HTMLElement) => {
            const m = /(\\d+), (\\d+), (\\d+)/.exec(getComputedStyle(e).backgroundColor)!;
            return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
        });
        const sideColours = async () => ((await editor(page).inputValue()) === NAMES.above ? { palette: ABOVE, what: 'a level above the price starts greenish' } : { palette: BELOW, what: 'a level below the price starts reddish' });
        const first = await sideColours();
        assert.ok(first.palette.includes(await swatchHex()), first.what);
        await page.keyboard.press('Escape');
        const box = (await page.locator('.recharts-wrapper').first().boundingBox())!;
        const other = { x: box.x + box.width * (first.palette === ABOVE ? 0.15 : 0.85), y: p.y };
        await page.mouse.move(other.x - 20, other.y);
        await page.mouse.move(other.x, other.y, { steps: 6 });
        await page.waitForTimeout(250);
        await page.mouse.click(other.x, other.y, { button: 'right' });
        const second = await sideColours();
        assert.notEqual(second.palette, first.palette, 'the other edge of the plot is on the other side of the price');
        assert.ok(second.palette.includes(await swatchHex()), second.what);`);
edit('src/chart-zoom.e2e.ts', `const zoomIn = (page: Page, times: number) => (async () => {
    for (let i = 0; i < times; i++) { await page.getByRole('button', { name: 'Horizontal Zoom In' }).click(); await page.waitForTimeout(150); }
})();`, `/** Zooms in step by step until the strike labels change (how many steps that takes depends on the cached chain), at most 6 steps. */
const zoomInUntilTicksChange = async (page: Page, full: string[]) => {
    for (let i = 0; i < 6; i++) {
        await page.getByRole('button', { name: 'Horizontal Zoom In' }).click();
        await page.waitForTimeout(250);
        const now = await ticks(page);
        if (JSON.stringify(now) !== JSON.stringify(full)) return now;
    }
    return ticks(page);
};`);
edit('src/chart-zoom.e2e.ts', `    await zoomIn(page, 3);
    const spyZoomed = await ticks(page);`, `    const spyZoomed = await zoomInUntilTicksChange(page, spyFull);`);
edit('src/chart-zoom.e2e.ts', `    await zoomIn(page, 1);
    const qqqZoomed = await ticks(page);`, `    const qqqZoomed = await zoomInUntilTicksChange(page, qqqFull);`);
