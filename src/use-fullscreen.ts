/// <reference lib="esnext" />
import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================================
// FULL SCREEN for the chart cards of the GEX and Chart tabs. The card is shown over the whole window with CSS (it works
// everywhere, also where the browser has no element full screen, like iPhone Safari) and, where the browser has it, the real
// Fullscreen API is asked for too, so the browser chrome goes away as well. Esc leaves it either way, F toggles it (not while
// a field is being edited).
// ============================================================================

export interface Fullscreen {
    full: boolean;
    toggle: () => void;
    /** goes on the card element */
    ref: React.RefObject<HTMLElement | null>;
}

/** How often (frames) and how long (frames) a late granted full screen is asked to end (useFullscreen leaveIfLate). */
const LATE_EXIT_EVERY = 10;
const LATE_EXIT_FRAMES = 180;

export function useFullscreen(): Fullscreen {
    const [full, setFull] = useState(false);
    const ref = useRef<HTMLElement | null>(null);
    const fullRef = useRef(false);
    fullRef.current = full;
    // the card is in the browser's own full screen because of us; cleared when we leave it ourselves, so the change event of
    // our own (async) exit is not taken for the user's Esc: F, F, F quickly closed the third one when the second's exit landed
    const nativeUsed = useRef(false);
    const toggleRef = useRef<() => void>(() => {});

    /**
     * A full screen granted after the card already left it (the user toggled back while the request was pending) is left.
     * Chrome ignores an exit asked for while it is still entering (the exit promise never settles, no fullscreenchange), so
     * the exit is asked again every LATE_EXIT_EVERY frames until the card is out, for at most LATE_EXIT_FRAMES frames.
     */
    const leaveIfLate = useCallback(() => {
        let frame = 0;
        const step = () => {
            if (fullRef.current || !ref.current || document.fullscreenElement !== ref.current) return;
            nativeUsed.current = false;
            if (frame % LATE_EXIT_EVERY === 0) void document.exitFullscreen().catch(() => undefined);
            if (++frame < LATE_EXIT_FRAMES) requestAnimationFrame(step);
        };
        step();
    }, []);

    const toggle = useCallback(() => {
        if (!fullRef.current) {
            fullRef.current = true;
            setFull(true);
            // the native full screen is a bonus: a refusal (no support, no permission) leaves the CSS one in place
            // the request is async: when the user left again before it was granted (F, F quickly), leave the granted one at once
            // (Chrome does not always fire fullscreenchange for it then, so onChange below is not enough; the flaky fullscreen
            // e2e, 2026-10-26)
            const el = ref.current;
            try { void el?.requestFullscreen?.()?.then(leaveIfLate, () => undefined); } catch { /* not supported */ }
        } else {
            fullRef.current = false;
            nativeUsed.current = false;
            setFull(false);
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        }
    }, [leaveIfLate]);

    toggleRef.current = toggle;

    useEffect(() => {
        // the browser left its own full screen (Esc): the card goes back too
        const onChange = () => {
            // granted for a card that already left it (see leaveIfLate)
            if (document.fullscreenElement && document.fullscreenElement === ref.current && !fullRef.current) {
                leaveIfLate();
                return;
            }
            if (!document.fullscreenElement && fullRef.current && nativeUsed.current) setFull(false);
            nativeUsed.current = !!document.fullscreenElement && document.fullscreenElement === ref.current;
        };
        // Esc leaves it, before the chart's own Esc handling (a double Esc resets the zoom)
        const onKey = (e: KeyboardEvent) => {
            // F toggles it, unless a field is being edited or a modifier is held (Cmd+F, Ctrl+F are the browser's find); the key
            // is read by its place on the keyboard too, so it works with a Russian layout
            if ((e.code === 'KeyF' || e.key.toLowerCase() === 'f') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !e.defaultPrevented) {
                const el = e.target as HTMLElement | null;
                if (!(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) { e.preventDefault(); toggleRef.current(); return; }
            }
            // (a browser consumes Esc itself while it is in its own full screen; if the key still arrives, leave that one too)
            if (e.key === 'Escape' && fullRef.current) {
                e.preventDefault();
                e.stopImmediatePropagation();
                fullRef.current = false;
                nativeUsed.current = false;
                setFull(false);
                if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
            }
        };
        document.addEventListener('fullscreenchange', onChange);
        window.addEventListener('keydown', onKey, true);
        return () => { document.removeEventListener('fullscreenchange', onChange); window.removeEventListener('keydown', onKey, true); };
    }, []);

    // leaving the page or the tab (the card unmounts) must not leave the browser in full screen
    useEffect(() => () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); }, []);

    return { full, toggle, ref };
}

/**
 * Where a portal (a tooltip, a help panel) must be rendered: `document.body`, or the element that is in the browser's own full
 * screen, because only the full screen element and what is inside it is visible then. Follows `fullscreenchange`.
 */
export function usePortalHost(): Element {
    const get = () => (typeof document === 'undefined' ? (null as never) : document.fullscreenElement ?? document.body);
    const [host, setHost] = useState<Element>(get);
    useEffect(() => {
        const onChange = () => setHost(get());
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);
    return host;
}
