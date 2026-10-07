// Pure helpers for panning the GEX chart while it is zoomed. No React, no DOM,
// unit-tested in zoom-pan.test.ts.

/** Moves the visible strike range `[a, b]` by `step` price units (one strike) in `dir`, clamped
 *  so it never leaves the full data range `base`. Returns the same range when it cannot move. */
export function panRange(range: [number, number], base: [number, number], dir: -1 | 1, step: number): [number, number] {
    const [a, b] = range;
    let shift = dir * step;
    if (a + shift < base[0]) shift = base[0] - a;
    if (b + shift > base[1]) shift = base[1] - b;
    return [a + shift, b + shift];
}

/** True when the view `[a, b]` can still move in `dir` (not already at that edge of `base`). */
export function canPanRange(range: [number, number], base: [number, number], dir: -1 | 1): boolean {
    return dir < 0 ? range[0] > base[0] + 1e-9 : range[1] < base[1] - 1e-9;
}

/** Value-axis view: the full axis `[lo, hi]` scaled around zero by `factor` (the zoom), then
 *  moved by `pan` in [-1, 1]. pan 1 puts the top of the view on the top of the full axis, pan -1
 *  puts the bottom on the bottom of the full axis, 0 is the centered zoom. Zooming out
 *  (`factor >= 1`) leaves nothing to move, so pan is ignored. */
export function viewDomain([lo, hi]: [number, number], factor: number, pan: number): [number, number] {
    const zoomed: [number, number] = [lo * factor, hi * factor];
    if (factor >= 1 || pan === 0) return zoomed;
    const shift = pan > 0 ? pan * (hi - hi * factor) : -pan * (lo - lo * factor);
    return [zoomed[0] + shift, zoomed[1] + shift];
}

/** Moves the value-axis pan by one step, clamped to [-1, 1]. */
export function stepPan(pan: number, dir: -1 | 1): number {
    return Math.max(-1, Math.min(1, pan + dir * 0.5));
}
