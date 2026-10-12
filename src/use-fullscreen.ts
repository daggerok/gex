// @ts-ignore -- resolved by the Parcel/Bun build toolchain
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

export function useFullscreen(): Fullscreen {
    const [full, setFull] = useState(false);
    const ref = useRef<HTMLElement | null>(null);
    const fullRef = useRef(false);
    fullRef.current = full;
    const toggleRef = useRef<() => void>(() => {});

    const toggle = useCallback(() => {
        if (!fullRef.current) {
            setFull(true);
            // the native full screen is a bonus: a refusal (no support, no permission) leaves the CSS one in place
            try { void ref.current?.requestFullscreen?.()?.catch(() => undefined); } catch { /* not supported */ }
        } else {
            setFull(false);
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        }
    }, []);

    toggleRef.current = toggle;

    useEffect(() => {
        // the browser left its own full screen (Esc): the card goes back too
        const onChange = () => { if (!document.fullscreenElement && fullRef.current && nativeUsed.current) setFull(false); nativeUsed.current = !!document.fullscreenElement; };
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
                setFull(false);
                if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
            }
        };
        const nativeUsed = { current: false };
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
