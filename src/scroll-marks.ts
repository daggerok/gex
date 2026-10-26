/// <reference lib="esnext" />
// ============================================================================
// SCROLL MARKS (owner 2026-10-25, "variant B") - the geometry of the minimap strip next to the Board table's scrollbar:
// one tick per row, placed by the row's index (top = first row, bottom = last row), coloured by the sign of its Net GEX
// with an opacity by |Net GEX| relative to the largest, and the rows that mark something (the ATM strike, a level, a
// column's peak or runner-up) drawn on top in full strength. Ticks closer than a few pixels merge into one, so the strip
// stays readable with hundreds of strikes. View geometry only (no GEX math, R1): the numbers come from computeBoard, the
// colours from the caller (signColor / level colours). Pure and view-agnostic: the Board and the Desk use it. The Desk
// (owner 2026-10-25) has one section per expiration, so a strike repeats (rows carry a `key`), each section's expiration
// bar is a row of its own (`header`), and its rows differ in height (bars, sub-headers, strikes), so its frame comes from
// the rows' real positions (visibleRowWindow) under a sticky pile of bars (stickyPileHeight).
// ============================================================================

/** One row of the table as the strip sees it. */
export interface ScrollMarkRow {
    /** unique id of the row when a strike repeats (the Desk: expiration + strike), else the strike is the id */
    key?: string;
    strike: number;
    /** a section header row (the Desk's expiration bar, its text): a neutral full-strength tick, no Net GEX */
    header?: string;
    netGex: number;
    /** the strike nearest to spot */
    atm?: boolean;
    /** the levels on this strike (level-labels levelMarksByStrike), drawn in their own colours */
    levels?: ReadonlyArray<{ text: string; color: string }>;
    /** the shown columns whose peak / runner-up is on this row (column keys) */
    peaks?: readonly string[];
    seconds?: readonly string[];
}

/** What a tick marks, most important first: it decides the colour and the strength when ticks merge. */
export type ScrollTickKind = 'level' | 'atm' | 'section' | 'peak' | 'second' | 'row';
const KIND_RANK: Record<ScrollTickKind, number> = { level: 0, atm: 1, section: 2, peak: 3, second: 4, row: 5 };

export interface ScrollTick {
    index: number;
    /** the row's key (ScrollMarkRow.key, else its strike as text) */
    key: string;
    strike: number;
    /** center of the tick in px from the top of the track */
    y: number;
    color: string;
    opacity: number;
    kind: ScrollTickKind;
}

export interface ScrollTickGroup {
    /** px from the top of the track: the first and the last tick of the group (equal for a single tick) */
    top: number;
    bottom: number;
    color: string;
    opacity: number;
    kind: ScrollTickKind;
    /** every tick in the group, top to bottom (the tooltip lists them all) */
    ticks: ScrollTick[];
    /** the tick a click scrolls to: the most important one, the topmost on a tie */
    lead: ScrollTick;
}

/** The faintest plain tick (a row with almost no Net GEX), so every row still shows on the strip. */
export const SCROLL_TICK_MIN_OPACITY = 0.15;
/** Ticks whose centers are closer than this (px) merge into one (owner: "closer than ~3 px merge"). */
export const SCROLL_TICK_MERGE_PX = 3;

/** The tick's center for row `index` of `count` in a track `height` px tall: rows fill the track evenly, top to bottom. */
export function tickY(index: number, count: number, height: number): number {
    return count > 0 ? ((index + 0.5) / count) * height : 0;
}

/**
 * One tick per row. A plain row is coloured by the sign of its Net GEX (`colors.pos` / `colors.neg`, `colors.zero` for a
 * zero) with an opacity from SCROLL_TICK_MIN_OPACITY (no Net GEX) to 1 (the largest |Net GEX|), by the square root of
 * |Net GEX| / max (one wall is often 50x the typical strike, so a linear scale left almost every tick at the floor on real
 * SPY data); a row that marks something
 * is fully opaque in the colour of what it marks: its first level, else the ATM colour, else its sign colour for a peak
 * or a runner-up. A section header (the Desk's expiration bar) is fully opaque in `colors.section` (else `colors.zero`).
 */
export function scrollTicks(rows: readonly ScrollMarkRow[], height: number, colors: { pos: string; neg: string; zero: string; atm: string; section?: string }): ScrollTick[] {
    let max = 0;
    for (const r of rows) if (Number.isFinite(r.netGex)) max = Math.max(max, Math.abs(r.netGex));
    return rows.map((r, index) => {
        const sign = r.netGex > 0 ? colors.pos : r.netGex < 0 ? colors.neg : colors.zero;
        const kind: ScrollTickKind = r.header != null ? 'section' : r.levels?.length ? 'level' : r.atm ? 'atm' : r.peaks?.length ? 'peak' : r.seconds?.length ? 'second' : 'row';
        const color = kind === 'section' ? colors.section ?? colors.zero : kind === 'level' ? r.levels![0].color : kind === 'atm' ? colors.atm : sign;
        const strength = max > 0 && Number.isFinite(r.netGex) ? Math.sqrt(Math.abs(r.netGex) / max) : 0;
        const opacity = kind === 'row' ? SCROLL_TICK_MIN_OPACITY + (1 - SCROLL_TICK_MIN_OPACITY) * strength : 1;
        return { index, key: r.key ?? String(r.strike), strike: r.strike, y: tickY(index, rows.length, height), color, opacity, kind };
    });
}

/**
 * Merges ticks (sorted top to bottom) whose centers lie within `gap` px of the FIRST tick of their group, so a dense strip
 * never chains into one long group. A group takes the colour of its most important tick (level > ATM > section header >
 * peak > runner-up > plain row; the topmost on a tie) and the strongest opacity of its ticks.
 */
export function mergeScrollTicks(ticks: readonly ScrollTick[], gap = SCROLL_TICK_MERGE_PX): ScrollTickGroup[] {
    const groups: ScrollTickGroup[] = [];
    let cur: ScrollTickGroup | null = null;
    for (const t of ticks) {
        if (cur && t.y - cur.top < gap) {
            cur.ticks.push(t);
            cur.bottom = t.y;
            cur.opacity = Math.max(cur.opacity, t.opacity);
            if (KIND_RANK[t.kind] < KIND_RANK[cur.lead.kind]) {
                cur.lead = t;
                cur.kind = t.kind;
                cur.color = t.color;
            }
            continue;
        }
        cur = { top: t.y, bottom: t.y, color: t.color, opacity: t.opacity, kind: t.kind, ticks: [t], lead: t };
        groups.push(cur);
    }
    return groups;
}

/**
 * The part of the rows in view, as fractions of all rows (0 = top of the first row, 1 = bottom of the last), for the
 * minimap frame. `head` is the height of the sticky table header (it covers the top of the visible area). Rows have one
 * height, so a fraction of the rows' pixels is a fraction of the rows.
 */
export function visibleWindow(scroll: { scrollTop: number; clientHeight: number; scrollHeight: number }, head = 0): { top: number; bottom: number } {
    const body = scroll.scrollHeight - head;
    if (body <= 0) return { top: 0, bottom: 1 };
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return { top: clamp(scroll.scrollTop / body), bottom: clamp((scroll.scrollTop + scroll.clientHeight - head) / body) };
}

/**
 * The part of the rows in view, as fractions of the row count (0 = top of the first row, 1 = bottom of the last), for a
 * table whose rows differ in height or have gaps between them (the Desk: expiration bars, sub-header rows that are not
 * on the strip, strike rows). `edges(i)` is row i's top and bottom in the scroll content's px, ascending; the view is
 * [viewTop, viewBottom] in the same px. A point inside a row counts by how far into the row it is, a point in a gap
 * counts as the start of the next row. Binary search, so one scroll frame stays cheap with thousands of rows.
 */
export function visibleRowWindow(count: number, edges: (i: number) => { top: number; bottom: number }, viewTop: number, viewBottom: number): { top: number; bottom: number } {
    if (count <= 0) return { top: 0, bottom: 1 };
    const at = (y: number): number => {
        // the first row whose bottom is below y
        let lo = 0;
        let hi = count;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (edges(mid).bottom <= y) lo = mid + 1; else hi = mid;
        }
        if (lo >= count) return count;
        const { top, bottom } = edges(lo);
        return lo + (bottom > top ? Math.min(1, Math.max(0, (y - top) / (bottom - top))) : 0);
    };
    return { top: at(viewTop) / count, bottom: Math.max(at(viewTop), at(viewBottom)) / count };
}

/**
 * Height (px) of the Desk's sticky pile at the top of the scroll area: the expiration bars pile up (bar i sticks at
 * i x `barPx`), so every bar that has reached its slot is in the pile, plus the sticky sub-header rows (`sub` px) of the
 * last pinned section (its group and column-label rows stick below the pile while it is the active one). `bars` are the
 * bars' natural tops in the scroll content (ascending) and their sections' sub-header height (0 when collapsed).
 */
export function stickyPileHeight(bars: readonly { top: number; sub: number }[], scrollTop: number, barPx: number): number {
    let last = -1;
    for (let i = 0; i < bars.length; i++) if (bars[i].top - scrollTop <= i * barPx + 1) last = i;
    return last < 0 ? 0 : (last + 1) * barPx + bars[last].sub;
}
