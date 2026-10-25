/// <reference lib="esnext" />
// ============================================================================
// CENTER A ROW - scrolls a scroll container so one row (the ATM strike of the Desk or the Board) sits in the vertical
// middle of the visible area. Shared by the Desk (ChainTable) and the Board so both land on the money the same way.
//
// The row may not be in the DOM yet (a Desk section that is still expanding mounts its rows a few renders later), and
// rows that fade in can still change heights, so the scroll is retried across animation frames until the row exists
// and sits within a pixel of the middle (at most `maxFrames` frames).
// ============================================================================

/** Frames a centering keeps trying (the row is missing or still moving) before it gives up. */
export const CENTER_ROW_MAX_FRAMES = 30;

/**
 * How far to scroll (positive = down) so the row's center lands on the middle of the visible part of the container
 * (pure). `topInset` is the height covered at the top by sticky content (the pinned expiration bars of the Desk, the
 * table header of the Board), so the row lands in the middle of what is really visible below it.
 */
export function middleScrollDelta(container: { top: number; bottom: number }, row: { top: number; height: number }, topInset = 0): number {
    const usableTop = container.top + topInset;
    const usableCenter = usableTop + (container.bottom - usableTop) / 2;
    return row.top + row.height / 2 - usableCenter;
}

/**
 * Scrolls `container()` so `row()` sits in its vertical middle, retrying across animation frames while the row is not
 * mounted yet or still moves. Returns a function that stops the retries (call it when the view unmounts or a newer
 * centering starts).
 */
export function centerRowInScroll(
    container: () => HTMLElement | null,
    row: () => HTMLElement | null,
    topInset: () => number = () => 0,
    maxFrames = CENTER_ROW_MAX_FRAMES,
): () => void {
    let tries = 0;
    let frame = 0;
    let stopped = false;
    const attempt = () => {
        if (stopped) return;
        const box = container();
        if (!box) return;
        const el = row();
        if (!el) {
            if (tries++ < maxFrames) frame = requestAnimationFrame(attempt);
            return;
        }
        const delta = middleScrollDelta(box.getBoundingClientRect(), el.getBoundingClientRect(), topInset());
        box.scrollTop += delta;
        // far off-screen rows may still be settling (staggered fade-in changes heights): nudge again next frame
        if (Math.abs(delta) > 1 && tries++ < maxFrames) frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => { stopped = true; cancelAnimationFrame(frame); };
}
