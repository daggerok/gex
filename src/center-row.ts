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

/** User input that scrolls a container (mouse wheel, touchpad, a finger, a press on its scroll bar): a centering yields to it. */
export const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'pointerdown'] as const;

/**
 * Scrolls `container()` so `row()` sits in its vertical middle, retrying across animation frames while the row is not
 * mounted yet or still moves. Returns a function that stops the retries (call it when the view unmounts or a newer
 * centering starts).
 *
 * The user wins: a wheel, touch or pointer press inside the container stops the retries. Each retry re-reads the row and
 * scrolls by the whole distance to the middle, so a retry still pending after the user scrolled (the frame after the first
 * scroll, or longer while rows settle) put the view back on the ATM row: the futures-live e2e flake (2026-10-26) scrolled
 * the Desk by 37 px in that frame and saw it undone (1827 -> 1790).
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
    const stop = () => {
        stopped = true;
        cancelAnimationFrame(frame);
        for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, onUser, true);
    };
    // on the window (capture): the container may not exist yet when the centering starts
    function onUser(e: Event): void {
        const box = container();
        if (box && box.contains(e.target as Node | null)) stop();
    }
    for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, onUser, { capture: true, passive: true });
    const attempt = () => {
        if (stopped) return;
        const box = container();
        if (!box) { stop(); return; }
        const el = row();
        if (!el) {
            if (tries++ < maxFrames) frame = requestAnimationFrame(attempt);
            else stop();
            return;
        }
        const delta = middleScrollDelta(box.getBoundingClientRect(), el.getBoundingClientRect(), topInset());
        box.scrollTop += delta;
        // far off-screen rows may still be settling (staggered fade-in changes heights): nudge again next frame
        if (Math.abs(delta) > 1 && tries++ < maxFrames) frame = requestAnimationFrame(attempt);
        else stop();
    };
    frame = requestAnimationFrame(attempt);
    return stop;
}

/**
 * Scrolls `container` once so `row` sits in its vertical middle below `topInset` px of sticky content, smoothly by
 * default (the Board's scroll marks: a click on a tick glides to its row). For a row that is already mounted and laid
 * out; the browser clamps the target at the top and bottom of the table.
 */
export function scrollRowToMiddle(container: HTMLElement, row: HTMLElement, topInset = 0, behavior: ScrollBehavior = 'smooth'): void {
    const delta = middleScrollDelta(container.getBoundingClientRect(), row.getBoundingClientRect(), topInset);
    container.scrollTo({ top: container.scrollTop + delta, behavior });
}
