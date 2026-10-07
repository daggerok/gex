// Pure helpers for panning the GEX chart while it is zoomed. No React, no DOM,
// unit-tested in zoom-pan.test.ts.

/** Moves the visible strike range `[a, b]` by `step` price units in `dir`, clamped
 *  so it never leaves the full data range `base`. Returns the same range when it cannot move. */
export function panRange(range: [number, number], base: [number, number], dir: -1 | 1, step: number): [number, number] {
    const [a, b] = range;
    let shift = dir * step;
    if (a + shift < base[0]) shift = base[0] - a;
    if (b + shift > base[1]) shift = base[1] - b;
    return [a + shift, b + shift];
}

/** Share of the FULL strike range that one arrow or zoom click moves each edge by (1%). */
export const STEP_PCT = 0.01;

/** The price step of one click for a full data range `base`: 1% of its width. */
export function clickStep(base: [number, number]): number {
    return (base[1] - base[0]) * STEP_PCT;
}

/** One zoom click: "in" moves BOTH edges of the visible strike range `[a, b]` toward the middle by
 *  `step`, "out" moves both away from it. The range never leaves the full data range `base`,
 *  zooming in stops once the range would be narrower than `minWidth` (a few strikes), and zooming
 *  out to the whole range returns null (the default view). */
export function zoomRange(range: [number, number], base: [number, number], dir: 'in' | 'out', step: number, minWidth: number): [number, number] | null {
    const [a, b] = range;
    if (dir === 'in') {
        if (b - a - 2 * step < minWidth) return range;
        return [a + step, b - step];
    }
    const na = Math.max(base[0], a - step);
    const nb = Math.min(base[1], b + step);
    return na <= base[0] && nb >= base[1] ? null : [na, nb];
}

/** True when the view `[a, b]` can still move in `dir` (not already at that edge of `base`). */
export function canPanRange(range: [number, number], base: [number, number], dir: -1 | 1): boolean {
    return dir < 0 ? range[0] > base[0] + 1e-9 : range[1] < base[1] - 1e-9;
}
