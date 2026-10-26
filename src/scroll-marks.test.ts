/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { mergeScrollTicks, SCROLL_TICK_MIN_OPACITY, scrollTicks, stickyPileHeight, tickY, visibleRowWindow, visibleWindow, type ScrollMarkRow } from './scroll-marks';

const COLORS = { pos: 'green', neg: 'red', zero: 'grey', atm: 'spot' };

describe('tickY', () => {
    test('rows fill the track evenly, first at the top, last at the bottom', () => {
        expect(tickY(0, 4, 100)).toBe(12.5);
        expect(tickY(3, 4, 100)).toBe(87.5);
        expect(tickY(0, 1, 100)).toBe(50);
        expect(tickY(0, 0, 100)).toBe(0);
    });
});

describe('scrollTicks', () => {
    const rows: ScrollMarkRow[] = [
        { strike: 90, netGex: -50 },
        { strike: 95, netGex: 100 },
        { strike: 100, netGex: 0, atm: true },
        { strike: 105, netGex: 25 },
        { strike: 110, netGex: 0 },
    ];

    test('one tick per row, positioned by index', () => {
        const ticks = scrollTicks(rows, 500, COLORS);
        expect(ticks.map((t) => t.strike)).toEqual([90, 95, 100, 105, 110]);
        expect(ticks.map((t) => t.y)).toEqual([50, 150, 250, 350, 450]);
    });

    test('plain rows: sign colour, opacity by sqrt(|Net GEX| / max)', () => {
        const ticks = scrollTicks(rows, 500, COLORS);
        expect(ticks[0]).toMatchObject({ color: 'red', kind: 'row' });
        expect(ticks[0].opacity).toBeCloseTo(SCROLL_TICK_MIN_OPACITY + (1 - SCROLL_TICK_MIN_OPACITY) * Math.sqrt(0.5));
        expect(ticks[1]).toMatchObject({ color: 'green', opacity: 1, kind: 'row' });
        expect(ticks[3].opacity).toBeCloseTo(SCROLL_TICK_MIN_OPACITY + (1 - SCROLL_TICK_MIN_OPACITY) * 0.5);
        expect(ticks[4]).toMatchObject({ color: 'grey', opacity: SCROLL_TICK_MIN_OPACITY });
    });

    test('ATM in the spot colour, full strength', () => {
        expect(scrollTicks(rows, 500, COLORS)[2]).toMatchObject({ color: 'spot', opacity: 1, kind: 'atm' });
    });

    test('a level wins over ATM, a peak and a runner-up are full strength in the sign colour', () => {
        const marked: ScrollMarkRow[] = [
            { strike: 1, netGex: -1, peaks: ['netGex'] },
            { strike: 2, netGex: 100, atm: true, levels: [{ text: 'Spot', color: 'amber' }, { text: 'Mine', color: 'pink' }] },
            { strike: 3, netGex: 1, seconds: ['callOi'] },
        ];
        const ticks = scrollTicks(marked, 300, COLORS);
        expect(ticks[0]).toMatchObject({ color: 'red', opacity: 1, kind: 'peak' });
        expect(ticks[1]).toMatchObject({ color: 'amber', opacity: 1, kind: 'level' });
        expect(ticks[2]).toMatchObject({ color: 'green', opacity: 1, kind: 'second' });
    });

    test('all-zero Net GEX: every plain tick at the floor, no NaN', () => {
        const ticks = scrollTicks([{ strike: 1, netGex: 0 }, { strike: 2, netGex: 0 }], 10, COLORS);
        expect(ticks.every((t) => t.opacity === SCROLL_TICK_MIN_OPACITY)).toBe(true);
    });
});

describe('mergeScrollTicks', () => {
    test('ticks far apart stay single', () => {
        const ticks = scrollTicks([{ strike: 1, netGex: 1 }, { strike: 2, netGex: 2 }], 100, COLORS);
        const groups = mergeScrollTicks(ticks);
        expect(groups).toHaveLength(2);
        expect(groups[0]).toMatchObject({ top: 25, bottom: 25 });
    });

    test('ticks closer than 3 px merge, and a dense strip does not chain into one group', () => {
        // 10 rows in 20 px: 2 px apart -> pairs merge (the third is 4 px from the first of the group)
        const rows = Array.from({ length: 10 }, (_, i) => ({ strike: i, netGex: i + 1 }));
        const groups = mergeScrollTicks(scrollTicks(rows, 20, COLORS));
        expect(groups).toHaveLength(5);
        expect(groups.map((g) => g.ticks.map((t) => t.strike))).toEqual([[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]]);
        expect(groups[0]).toMatchObject({ top: 1, bottom: 3 });
    });

    test('a group takes the most important tick for colour and click, the strongest opacity', () => {
        const rows: ScrollMarkRow[] = [
            { strike: 1, netGex: 100 },
            { strike: 2, netGex: -10, atm: true },
            { strike: 3, netGex: 5, levels: [{ text: 'Call Wall', color: 'blue' }] },
        ];
        const [g] = mergeScrollTicks(scrollTicks(rows, 4, COLORS));
        expect(g.ticks).toHaveLength(3);
        expect(g).toMatchObject({ color: 'blue', kind: 'level', opacity: 1 });
        expect(g.lead.strike).toBe(3);
    });

    test('a tie keeps the topmost tick as the lead', () => {
        const rows: ScrollMarkRow[] = [{ strike: 1, netGex: 1, peaks: ['a'] }, { strike: 2, netGex: -1, peaks: ['b'] }];
        const [g] = mergeScrollTicks(scrollTicks(rows, 4, COLORS));
        expect(g.lead.strike).toBe(1);
        expect(g.color).toBe('green');
    });

    test('empty input', () => {
        expect(mergeScrollTicks([])).toEqual([]);
    });
});

describe('visibleWindow', () => {
    test('fractions of the rows in view below the sticky header', () => {
        // header 30, 100 rows of 30 px (3000), viewport 330 -> 300 px of rows in view
        expect(visibleWindow({ scrollTop: 0, clientHeight: 330, scrollHeight: 3030 }, 30)).toEqual({ top: 0, bottom: 0.1 });
        expect(visibleWindow({ scrollTop: 1500, clientHeight: 330, scrollHeight: 3030 }, 30)).toEqual({ top: 0.5, bottom: 0.6 });
    });

    test('clamped, and the whole table when it does not scroll', () => {
        expect(visibleWindow({ scrollTop: 0, clientHeight: 900, scrollHeight: 330 }, 30)).toEqual({ top: 0, bottom: 1 });
        expect(visibleWindow({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 })).toEqual({ top: 0, bottom: 1 });
    });
});

describe('Desk rows (sections, repeated strikes)', () => {
    // two expirations, both with strike 100: the first expanded (header + 2 rows), the second collapsed (header only)
    const rows: ScrollMarkRow[] = [
        { key: 'A|', strike: Number.NaN, netGex: Number.NaN, header: 'A' },
        { key: 'A|100', strike: 100, netGex: 10, atm: true },
        { key: 'A|105', strike: 105, netGex: Number.NaN },
        { key: 'B|', strike: Number.NaN, netGex: Number.NaN, header: 'B' },
    ];

    test('a header is a full-strength section tick in the section colour, keys stay unique', () => {
        const ticks = scrollTicks(rows, 400, { ...COLORS, section: 'slate' });
        expect(ticks.map((t) => t.key)).toEqual(['A|', 'A|100', 'A|105', 'B|']);
        expect(ticks[0]).toMatchObject({ kind: 'section', color: 'slate', opacity: 1 });
        expect(ticks[3]).toMatchObject({ kind: 'section', color: 'slate' });
        expect(scrollTicks(rows, 400, COLORS)[0].color).toBe('grey');
    });

    test('a row without Net GEX (no gamma) is a faint zero tick, not NaN', () => {
        const t = scrollTicks(rows, 400, COLORS)[2];
        expect(t).toMatchObject({ kind: 'row', color: 'grey', opacity: SCROLL_TICK_MIN_OPACITY });
    });

    test('the key defaults to the strike (the Board)', () => {
        expect(scrollTicks([{ strike: 7.5, netGex: 1 }], 10, COLORS)[0].key).toBe('7.5');
    });

    test('ATM outranks a section header in a merged group, a header outranks a peak', () => {
        expect(mergeScrollTicks(scrollTicks(rows.slice(0, 2), 2, COLORS))[0].lead.key).toBe('A|100');
        const [g] = mergeScrollTicks(scrollTicks([{ key: 'x', strike: 1, netGex: 1, peaks: ['a'] }, { key: 'h', strike: Number.NaN, netGex: Number.NaN, header: 'B' }], 2, COLORS));
        expect(g.lead.key).toBe('h');
    });
});

describe('visibleRowWindow', () => {
    // a 30 px bar, a 50 px gap (sub-headers, not on the strip), then 4 rows of 20 px: 0-30 | 80-100 | 100-120 | 120-140 | 140-160
    const edges = [{ top: 0, bottom: 30 }, { top: 80, bottom: 100 }, { top: 100, bottom: 120 }, { top: 120, bottom: 140 }, { top: 140, bottom: 160 }];
    const at = (i: number) => edges[i];

    test('the whole table in view', () => {
        expect(visibleRowWindow(5, at, 0, 200)).toEqual({ top: 0, bottom: 1 });
    });

    test('partial rows count by how far into the row the edge is', () => {
        // top at 15 = half of row 0, bottom at 110 = half of row 2
        expect(visibleRowWindow(5, at, 15, 110)).toEqual({ top: 0.5 / 5, bottom: 2.5 / 5 });
    });

    test('an edge in a gap counts as the start of the next row', () => {
        expect(visibleRowWindow(5, at, 50, 140)).toEqual({ top: 1 / 5, bottom: 4 / 5 });
    });

    test('past the last row, empty, and a zero-height row', () => {
        expect(visibleRowWindow(5, at, 150, 400)).toEqual({ top: 4.5 / 5, bottom: 1 });
        expect(visibleRowWindow(0, at, 0, 10)).toEqual({ top: 0, bottom: 1 });
        expect(visibleRowWindow(2, (i) => [{ top: 0, bottom: 0 }, { top: 0, bottom: 10 }][i], 0, 5)).toEqual({ top: 0.5, bottom: 1.5 / 2 });
    });
});

describe('stickyPileHeight', () => {
    // three bars of 30 px; natural tops 0, 500, 1000; the sections' sub-header rows are 56 px (the second collapsed: 0)
    const bars = [{ top: 0, sub: 56 }, { top: 500, sub: 0 }, { top: 1000, sub: 56 }];

    test('at the top only the first bar is pinned, with its sub-headers', () => {
        expect(stickyPileHeight(bars, 0, 30)).toBe(30 + 56);
    });

    test('a bar is pinned once it reaches its slot (index x bar height)', () => {
        expect(stickyPileHeight(bars, 468, 30)).toBe(86);
        expect(stickyPileHeight(bars, 470, 30)).toBe(60);
        expect(stickyPileHeight(bars, 940, 30)).toBe(90 + 56);
    });

    test('no bars', () => {
        expect(stickyPileHeight([], 100, 30)).toBe(0);
    });
});
