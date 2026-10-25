/// <reference lib="esnext" />
import * as React from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePortalHost } from '../use-fullscreen';

/** The look of the button when the caller does not give its own (the same as the zoom buttons of the GEX tab). */
const DEFAULT_BUTTON = 'shrink-0 select-none rounded-md px-1.5 py-0.5 font-medium leading-none hover:bg-slate-200/70 dark:hover:bg-slate-700/70 disabled:cursor-default';

/** Room the panel needs, px: below the button when there is that much space, otherwise above it. */
const PANEL_HEIGHT = 300;

/** "?" button in the chart card corners: hover or keyboard focus shows the chart controls guide, a click pins it open
 *  (a click outside closes it). One paragraph per instruction, in a fixed portal panel next to the button so no
 *  `overflow` ancestor clips it. `align` says which side of the button the panel lines up with. */
export const HelpButton: React.FC<{ label: string; paragraphs: string[]; align: 'left' | 'right'; buttonClass?: string }> = ({ label, paragraphs, align, buttonClass = DEFAULT_BUTTON }) => {
    const host = usePortalHost(); // the full screen element while the chart is full screen, else the body
    const wrapRef = useRef<HTMLSpanElement>(null);
    const panelId = useId();
    const [hover, setHover] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; right: number }>({ bottom: 0, left: 0, right: 0 });
    const open = hover || pinned;
    const place = () => {
        const r = wrapRef.current?.getBoundingClientRect();
        if (!r) return;
        // BELOW the button (the owner's choice: above it the text ran off the top of the window); above only when there is
        // not enough room under it for the panel
        const below = window.innerHeight - r.bottom >= PANEL_HEIGHT || r.top < PANEL_HEIGHT;
        setPos({
            ...(below ? { top: r.bottom + 8 } : { bottom: window.innerHeight - r.top + 8 }),
            left: Math.max(8, r.left),
            right: Math.max(8, window.innerWidth - r.right),
        });
    };
    useEffect(() => {
        if (!pinned) return;
        const onDown = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setPinned(false); };
        window.addEventListener('pointerdown', onDown);
        return () => window.removeEventListener('pointerdown', onDown);
    }, [pinned]);
    return (
        <span ref={wrapRef} className="inline-flex" onMouseEnter={() => { place(); setHover(true); }} onMouseLeave={() => setHover(false)}>
            <button
                type="button"
                aria-label={label}
                aria-expanded={open}
                aria-describedby={panelId}
                onClick={() => { place(); setPinned((v) => !v); }}
                onFocus={() => { place(); setHover(true); }}
                onBlur={() => setHover(false)}
                className={buttonClass + ' text-slate-500 dark:text-slate-400'}
            >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="block">
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" />
                    <path d="M9.2 9.3a2.9 2.9 0 1 1 4.3 2.5c-.9.6-1.5 1.1-1.5 2.2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="12" cy="17.2" r="1.5" fill="currentColor" />
                </svg>
            </button>
            {createPortal(
                <div
                    id={panelId}
                    role="tooltip"
                    style={{ top: pos.top, bottom: pos.bottom, ...(align === 'left' ? { left: pos.left, maxWidth: `calc(100vw - ${pos.left + 8}px)` } : { right: pos.right, maxWidth: `calc(100vw - ${pos.right + 8}px)` }) }}
                    className={
                        'pointer-events-none fixed z-[70] w-96 space-y-1.5 whitespace-normal rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs leading-snug text-slate-100 shadow-lg transition-opacity duration-200 ease-out dark:border-slate-600 ' +
                        (open ? 'opacity-100' : 'opacity-0')
                    }
                >
                    {paragraphs.map((t) => <p key={t}>{t}</p>)}
                </div>,
                host,
            )}
        </span>
    );
};

