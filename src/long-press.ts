/// <reference lib="esnext" />
// ============================================================================
// LONG PRESS on a touch screen - holding one finger still on a chart opens the custom level editor there (the same editor a
// right click opens with a mouse). Touch events only: a mouse has its own right click. Shared by the GEX and Chart tabs.
// ============================================================================

/** How long one finger must stay down, in ms. */
export const LONG_PRESS_MS = 500;

/** How far the finger may drift, in px, before it is a drag and not a long press. */
export const LONG_PRESS_SLOP_PX = 10;

/** Where the finger is: the same fields of a mouse event the editors read. */
export interface PressPoint { clientX: number; clientY: number }

/**
 * Calls `onLongPress` when one finger stays down on `el` for LONG_PRESS_MS without moving more than LONG_PRESS_SLOP_PX. A second
 * finger, a drag, lifting the finger or a cancelled touch stop the wait. When `onLongPress` returns true it handled the press and
 * lifting the finger does not send the click a browser would make after a touch. Returns the function that removes the listeners.
 */
export function attachLongPress(el: HTMLElement, onLongPress: (p: PressPoint) => boolean): () => void {
    let timer: number | null = null;
    let start: { x: number; y: number } | null = null;
    let fired = false;
    const clear = () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
    };
    const down = (e: TouchEvent) => {
        clear();
        fired = false;
        if (e.touches.length !== 1) { start = null; return; }
        const t = e.touches[0];
        start = { x: t.clientX, y: t.clientY };
        timer = window.setTimeout(() => {
            timer = null;
            if (start) fired = onLongPress({ clientX: start.x, clientY: start.y });
        }, LONG_PRESS_MS);
    };
    const move = (e: TouchEvent) => {
        if (!start) return;
        if (e.touches.length > 1) { clear(); start = null; return; }
        const t = e.touches[0];
        if (t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > LONG_PRESS_SLOP_PX) clear();
    };
    const up = (e: TouchEvent) => {
        clear();
        // no click after the long press: it would land on the editor that just opened
        if (fired && e.cancelable) e.preventDefault();
        fired = false;
        start = null;
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    return () => {
        clear();
        el.removeEventListener('touchstart', down);
        el.removeEventListener('touchmove', move);
        el.removeEventListener('touchend', up);
        el.removeEventListener('touchcancel', up);
    };
}
