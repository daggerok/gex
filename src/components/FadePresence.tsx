/// <reference lib="esnext" />
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

// ============================================================================
// FADE PRESENCE - shows a box with a quick fade in when `value` appears (create, edit) and keeps it on screen
// for a quick fade out when `value` goes away (close, cancel, delete, save). Used for the custom level editor
// of the Chart and GEX tabs. While it fades out it ignores the pointer, so a click cannot land on a closing box.
// `prefers-reduced-motion` turns the animation off (the box just appears and goes).
// ============================================================================

export const FADE_MS = 140;

export function FadePresence<T>({ value, children }: { value: T | null; children: (value: T) => React.ReactNode }): React.ReactElement | null {
    const open = value !== null;
    // the last value stays while the box fades out
    const last = useRef<T | null>(value);
    if (value !== null) last.current = value;
    // Everything the first paint needs is worked out DURING the render, not in an effect: the box must be in the page (and
    // take focus) in the same commit as before this component existed, or a click right after a right click can slip in
    // before the editor has focus and then never closes it.
    const wasOpenAtRender = useRef(false);
    const openings = useRef(0);
    if (open && !wasOpenAtRender.current) openings.current++; // a box reopened during a fade out is a NEW box
    wasOpenAtRender.current = open;
    const wasOpen = useRef(open); // as of the last commit
    const boxRef = useRef<HTMLDivElement | null>(null);
    const [fading, setFading] = useState(false);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        wasOpen.current = open;
        if (open) {
            setFading(false);
            // one frame later, so the browser has painted opacity 0 and the transition runs
            const raf = window.requestAnimationFrame(() => setVisible(true));
            return () => window.cancelAnimationFrame(raf);
        }
        // a closing box must not keep the focus: its blur would otherwise arrive later, in the middle of the NEXT right click,
        // and close the box that click opens
        const focused = document.activeElement as HTMLElement | null;
        if (focused && boxRef.current?.contains(focused)) focused.blur();
        setVisible(false);
        setFading(true);
        const timer = window.setTimeout(() => setFading(false), FADE_MS);
        return () => window.clearTimeout(timer);
    }, [open]);
    const closing = !open && (wasOpen.current || fading);
    if ((!open && !closing) || last.current === null) return null;
    return (
        <div
            ref={boxRef}
            inert={!open}
            data-fade={open && visible ? 'in' : 'out'}
            style={{ opacity: open && visible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease-out`, pointerEvents: open ? undefined : 'none' }}
            className="motion-reduce:!transition-none"
        >
            <React.Fragment key={openings.current}>{children(last.current)}</React.Fragment>
        </div>
    );
}
