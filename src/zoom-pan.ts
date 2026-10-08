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

/** Share of the FULL strike range that one arrow click moves the view by (1%). */
export const STEP_PCT = 0.01;

/** Share of the FULL strike range that one zoom click moves EACH edge by (2%, twice the arrow step). */
export const ZOOM_STEP_PCT = 0.02;

/** The price step of one arrow click for a full data range `base`: 1% of its width. */
export function clickStep(base: [number, number]): number {
    return (base[1] - base[0]) * STEP_PCT;
}

/** The price step of one zoom click for a full data range `base`: 2% of its width per edge. */
export function zoomStep(base: [number, number]): number {
    return (base[1] - base[0]) * ZOOM_STEP_PCT;
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

/** Moves the visible strike range `[a, b]` by `shift` price units (negative = toward lower strikes),
 *  clamped so it never leaves the full data range `base` and keeps its width. Used by the mouse
 *  drag, where the shift is not a whole click step. */
export function panRangeBy(range: [number, number], base: [number, number], shift: number): [number, number] {
    const [a, b] = range;
    let s = shift;
    if (a + s < base[0]) s = base[0] - a;
    if (b + s > base[1]) s = base[1] - b;
    return [a + s, b + s];
}

export type ChartKeyAction = 'panLeft' | 'panRight' | 'zoomIn' | 'zoomOut';

/** What a key press does on the GEX chart. Plain Left / Right move the chart like the arrow buttons.
 *  With Ctrl, Alt (Option) or Shift held, Right and Up zoom in, Left and Down zoom out. The + (or =)
 *  key zooms in and the - (or _) key zooms out, like the plus and minus buttons, unless Cmd, Ctrl or
 *  Alt is held: those are the browser's page zoom. Cmd (Meta) is otherwise left alone too:
 *  Cmd+Left / Right is the browser's back and forward. Anything else is not ours (null). */
export function chartKeyAction(e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): ChartKeyAction | null {
    if (e.metaKey) return null;
    if (!e.ctrlKey && !e.altKey) {
        if (e.key === '+' || e.key === '=') return 'zoomIn';
        if (e.key === '-' || e.key === '_') return 'zoomOut';
    }
    const modified = e.ctrlKey || e.altKey || e.shiftKey;
    if (!modified) return e.key === 'ArrowLeft' ? 'panLeft' : e.key === 'ArrowRight' ? 'panRight' : null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') return 'zoomIn';
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') return 'zoomOut';
    return null;
}

/** Escape presses closer together than this many milliseconds count as one run:
 *  two in a run reset the chart zoom, three reset every reset button on the page. */
export const ESCAPE_RUN_MS = 1000;

/** The Escape run after a press at `now`: the earlier presses that are still within ESCAPE_RUN_MS of
 *  `now`, plus this one. Its length is how many presses are in the current run. */
export function recordEscape(history: readonly number[], now: number): number[] {
    return [...history.filter((t) => now - t <= ESCAPE_RUN_MS), now];
}

/** Name of the app-wide event the triple Escape fires after resetting the expirations: every panel
 *  that has a Reset button listens and resets itself. */
export const RESET_ALL_EVENT = 'app:reset-all';
