/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { chromium, type Page } from 'playwright';
import { noProxy, startTestSite } from './e2e-site';
import { AG_DOT_HOVER_RING } from './gex-colors';

// ============================================================================
// Browser check of the Absolute Gamma rings on the GEX chart (owner 2026-10-25, "AG dots v3" + "AG rings v4"): a hollow
// ring at every strike, stroke in the AG line colour (the computed AG path stroke, so a custom colour is followed), fill
// none, r 3.5, stroke 1.5-2 px; the hovered ring is larger and takes the theme's hover token (gex-colors.ts
// AG_DOT_HOVER_RING). v4: inside a ring only what is behind the AG series shows (background or a Net GEX bar): the pixel
// at a ring centre equals the same pixel with the AG layer hidden, also over bars, while hovered, after a zoom and a
// resize. Both themes. Run: `bun run test:e2e ag-dots`.
// ============================================================================

type Rgb = [number, number, number];
interface Pt { x: number; y: number }

/** Hides (or shows again) everything the AG series draws: area fill and line, the rings, the hovered ring. */
async function setAgHidden(page: Page, hidden: boolean): Promise<void> {
    await page.evaluate((h) => {
        document.querySelectorAll<SVGElement>('.gex-ag-area, .recharts-area-dots, .recharts-active-dot').forEach((e) => { e.style.visibility = h ? 'hidden' : ''; });
    }, hidden);
}

/** Hides (or shows again) the level lines and their labels: a level line drawn over a bar hides the bar's colour. */
async function setLevelsHidden(page: Page, hidden: boolean): Promise<void> {
    await page.evaluate((h) => {
        document.querySelectorAll<SVGElement>('.recharts-reference-line').forEach((e) => { e.style.visibility = h ? 'hidden' : ''; });
    }, hidden);
}

/** Viewport pixels at the given points, read from a screenshot decoded on a blank page (no app code involved). */
async function pixelsAt(page: Page, pts: Pt[]): Promise<Rgb[]> {
    const png = await page.screenshot();
    const decoder = await page.context().newPage();
    try {
        return await decoder.evaluate(async ({ b64, pts }) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('no 2d context');
            ctx.drawImage(img, 0, 0);
            return pts.map((p) => { const d = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data; return [d[0], d[1], d[2]] as [number, number, number]; });
        }, { b64: png.toString('base64'), pts });
    } finally {
        await decoder.close();
    }
}

const same = (a: Rgb, b: Rgb): boolean => a.every((v, i) => Math.abs(v - b[i]) <= 6);
const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
function rgbOf(color: string): Rgb {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
    assert.ok(m, `a hex colour: ${color}`);
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/**
 * Ring centres (viewport px) in strike order; `isolated`: inside the plot (a zoomed chart keeps rings past its edges,
 * clipped away) and far enough from every other ring that only one ring covers it.
 */
async function ringCentres(page: Page, kind: 'ring' | 'active'): Promise<Array<Pt & { isolated: boolean }>> {
    const plot = await page.locator('.recharts-area-dots').first().evaluate((g) => {
        const id = /url\(#(.+)\)/.exec(g.getAttribute('clip-path') ?? '')?.[1];
        const rect = id ? document.getElementById(id)?.querySelector('rect') : null;
        const svg = (g as SVGGElement).ownerSVGElement?.getBoundingClientRect();
        if (!rect || !svg) return null;
        // a clipPath child is never rendered (empty client rect): its attributes are svg user units, 1:1 with css px here
        const n = (k: string): number => Number(rect.getAttribute(k));
        return { left: svg.left + n('x'), right: svg.left + n('x') + n('width'), top: svg.top + n('y'), bottom: svg.top + n('y') + n('height') };
    });
    assert.ok(plot, 'the AG dots are clipped to the plot');
    const all = await page.locator(`[data-ag-dot=${kind}]`).evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }));
    const inside = (p: Pt): boolean => p.x >= plot.left + 8 && p.x <= plot.right - 8 && p.y >= plot.top + 8 && p.y <= plot.bottom + 1;
    return all.map((p, i) => ({ ...p, isolated: inside(p) && all.every((q, j) => i === j || Math.hypot(p.x - q.x, p.y - q.y) >= 8) }));
}

/**
 * The owner's v4 rule: every isolated ring centre shows exactly what is there without the AG layer. A control proves the
 * comparison sees the AG layer at all: points on the AG line between two rings DO change when it is hidden.
 */
async function checkHoles(page: Page, label: string, barFills: Rgb[]): Promise<{ rings: number; overBars: number }> {
    const rings = await ringCentres(page, 'ring');
    const centres = rings.filter((r) => r.isolated);
    assert.ok(centres.length >= 5, `${label}: enough isolated rings to check (${centres.length})`);
    // the middle of a steep AG segment between two neighbouring rings (Area type linear: the line passes through it)
    const controls: Pt[] = [];
    for (let i = 0; i + 1 < rings.length; i++) {
        const a = rings[i];
        const b = rings[i + 1];
        if (Math.abs(b.y - a.y) > 20) controls.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    const pts: Pt[] = [...centres, ...controls];
    const withAg = await pixelsAt(page, pts);
    await setAgHidden(page, true);
    const without = await pixelsAt(page, pts);
    await setAgHidden(page, false);
    const bad = centres.map((p, i) => ({ p, got: withAg[i], want: without[i] })).filter((r) => !same(r.got, r.want));
    assert.equal(bad.length, 0, `${label}: inside a ring only what is behind the AG series shows; ${bad.length} of ${centres.length} ring centres differ: ${bad.slice(0, 5).map((r) => `(${r.p.x.toFixed(0)},${r.p.y.toFixed(0)}) ${hex(r.got)} instead of ${hex(r.want)}`).join(', ')}`);
    if (controls.length) {
        const seen = controls.filter((_, i) => !same(withAg[centres.length + i], without[centres.length + i])).length;
        assert.ok(seen >= Math.ceil(controls.length / 2), `${label}: control - the AG line is visible between the rings (${seen} of ${controls.length})`);
    }
    // what sits behind a ring with the AG layer and the level lines hidden: the levels of the day often stand right on the
    // largest bars (Max / Min Net GEX, Zero GEX, Spot), so their lines, not the bar, would be read there
    await setAgHidden(page, true);
    await setLevelsHidden(page, true);
    const behind = await pixelsAt(page, centres);
    await setLevelsHidden(page, false);
    await setAgHidden(page, false);
    const overBars = behind.filter((c) => barFills.some((f) => same(c, f))).length;
    return { rings: centres.length, overBars };
}

async function main(): Promise<void> {
    const site = await startTestSite();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    try {
        for (const scheme of ['light', 'dark'] as const) {
            const hover = AG_DOT_HOVER_RING[scheme];
            const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })).newPage();
            await noProxy(page); // no local proxy: the app uses the CACHE provider by itself
            await page.goto(site.url);
            const ticker = page.locator('input[role=combobox]');
            await ticker.fill('SPY');
            await ticker.press('Enter');
            await page.waitForTimeout(2500);
            await page.getByRole('button', { name: 'GEX' }).first().click();
            await page.waitForTimeout(1200);
            const read = () => page.locator('[data-ag-dot]').evaluateAll((els) => els.map((e) => ({ kind: e.getAttribute('data-ag-dot'), fill: e.getAttribute('fill'), stroke: e.getAttribute('stroke'), width: Number(e.getAttribute('stroke-width')), r: Number(e.getAttribute('r')) })));
            const dots = await read();
            assert.ok(dots.length > 10, `${scheme}: a ring at every strike (${dots.length})`);
            const line = await page.locator('.recharts-area-curve').first().getAttribute('stroke');
            assert.ok(line, `${scheme}: the AG line is on the chart`);
            assert.ok(dots.every((d) => d.kind === 'ring' && d.fill === 'none'), `${scheme}: every dot is a hollow ring: ${Array.from(new Set(dots.map((d) => d.fill))).join(', ')}`);
            assert.ok(dots.every((d) => d.stroke === line), `${scheme}: every ring is the AG line colour ${line}: ${Array.from(new Set(dots.map((d) => d.stroke))).join(', ')}`);
            assert.ok(dots.every((d) => d.r === 3.5 && d.width >= 1.5 && d.width <= 2), `${scheme}: r 3.5, stroke 1.5-2 px`);

            // ---- v4: the AG line and fill are cut out inside every ring ----
            const barFills = Array.from(new Set(await page.locator('.recharts-bar-rectangle path').evaluateAll((els) => els.map((e) => e.getAttribute('fill') ?? '')))).filter((f) => f.startsWith('#')).map(rgbOf);
            const full = await checkHoles(page, `${scheme} full view`, barFills);

            // ---- hover: the active dot has the theme's hover ring (no hard-coded white) and shows only the bar or background ----
            const target = (await ringCentres(page, 'ring')).filter((r) => r.isolated).sort((a, b) => a.y - b.y)[0];
            await page.mouse.move(target.x, target.y);
            await page.waitForTimeout(400);
            const active = (await read()).filter((d) => d.kind === 'active');
            assert.ok(active.length >= 1, `${scheme}: there is a hovered ring`);
            assert.ok(active.every((d) => d.stroke === hover && d.fill === 'none' && d.r === 5.5), `${scheme}: the hovered ring is larger, hollow, stroke ${hover}`);
            const [activeCentre] = await ringCentres(page, 'active');
            // the inner edge of the small ring of the same strike (r 3.5 - 0.875) must be gone too inside the hovered ring
            const hoverPts = [activeCentre, { x: activeCentre.x + 3, y: activeCentre.y }, { x: activeCentre.x - 3, y: activeCentre.y }];
            const hoverWith = await pixelsAt(page, hoverPts);
            await setAgHidden(page, true);
            const hoverWithout = await pixelsAt(page, hoverPts);
            await setAgHidden(page, false);
            hoverPts.forEach((p, i) => assert.ok(same(hoverWith[i], hoverWithout[i]), `${scheme}: inside the hovered ring at (${p.x.toFixed(0)},${p.y.toFixed(0)}) ${hex(hoverWith[i])} instead of ${hex(hoverWithout[i])}`));
            await page.mouse.move(5, 5);
            await page.waitForTimeout(300);

            // ---- the holes follow a zoom and a resize ----
            for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Horizontal Zoom In' }).click();
            await page.mouse.move(5, 5); // off the button: its tooltip must not cover the chart in the screenshots
            await page.waitForTimeout(800);
            const zoomed = await checkHoles(page, `${scheme} zoomed`, barFills);
            await page.setViewportSize({ width: 1100, height: 800 });
            await page.waitForTimeout(800);
            const resized = await checkHoles(page, `${scheme} resized`, barFills);
            // the rule must be seen over a bar too, counted over the three views: the committed cache data changes every day
            const overBars = full.overBars + zoomed.overBars + resized.overBars;
            assert.ok(overBars >= 1, `${scheme}: at least one checked ring sits on a Net GEX bar (full ${full.overBars}, zoomed ${zoomed.overBars}, resized ${resized.overBars})`);
            console.log(`ag-dots e2e ${scheme}: ${dots.length} rings ${line}, hover ring ${hover}; holes ok in ${full.rings} rings, zoomed ${zoomed.rings}, resized ${resized.rings} (${overBars} on bars), hovered`);
            await page.context().close();
        }
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => { console.error(err); process.exitCode = 1; });
