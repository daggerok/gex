/// <reference lib="esnext" />
import * as React from 'react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePortalHost } from '../use-fullscreen';

/**
 * The app's hover / focus tooltip (moved out of GexView.tsx, 2026-10-25): every explanation in the app uses it, never a
 * native `title` (owner: one style everywhere; the native one pops up at once, unanimated, and doubled the app's own).
 * The text renders through a portal (`position: fixed`, so no `overflow` ancestor clips it) into the full screen element
 * while a chart is full screen, else the body, and fades in and out. The hover handlers live on a wrapping span, because
 * a disabled button gets no mouse events. The portal node is created on the first hover or focus only, so a table with
 * thousands of cells that carry a Tip costs nothing until one is pointed at. Buttons keep their own aria-label.
 */
export const Tip: React.FC<{
    text: string;
    side?: 'below' | 'left';
    wrap?: boolean;
    /** keep the text's line breaks (`\n`), one line each, as wide as the longest */
    multiline?: boolean;
    /** show only when the text inside is cut off (the tooltip repeats it) */
    onlyWhenCut?: boolean;
    wrapperClassName?: string;
    children: React.ReactNode;
}> = ({ text, side = 'below', wrap = false, multiline = false, onlyWhenCut = false, wrapperClassName = 'inline-flex', children }) => {
    const host = usePortalHost();
    const wrapRef = useRef<HTMLSpanElement>(null);
    const tipRef = useRef<HTMLDivElement>(null);
    const tooltipId = useId();
    const [mounted, setMounted] = useState(false);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0, placement: 'bottom' as 'top' | 'bottom' | 'left' });
    const place = () => {
        const el = wrapRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (side === 'left') {
            // a column at the right edge: open to its left, centered on the element
            setPos({ top: r.top + r.height / 2, left: r.left - 8, placement: 'left' });
            return;
        }
        const half = (tipRef.current?.offsetWidth ?? 0) / 2;
        const left = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
        const tipH = tipRef.current?.offsetHeight ?? 0;
        // below the element by default, above when there is no room below
        const placement: 'top' | 'bottom' = r.bottom + 8 + tipH > window.innerHeight ? 'top' : 'bottom';
        setPos({ top: placement === 'bottom' ? r.bottom + 8 : r.top - 8, left, placement });
    };
    const show = () => {
        if (!text) return;
        // `onlyWhenCut`: the tooltip repeats text that is cut off, so skip it when the text fits
        if (onlyWhenCut) {
            const shown = wrapRef.current?.firstElementChild as HTMLElement | null;
            if (!shown || shown.scrollWidth <= shown.clientWidth + 1) return;
        }
        place();
        setMounted(true);
        setOpen(true);
    };
    // the first time, the node is created hidden: measure it, place it again, then fade it in one frame later
    const [visible, setVisible] = useState(false);
    useLayoutEffect(() => {
        if (!open) { setVisible(false); return; }
        place();
        const id = requestAnimationFrame(() => setVisible(true));
        return () => cancelAnimationFrame(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    return (
        <span ref={wrapRef} className={wrapperClassName} onMouseEnter={show} onMouseLeave={() => setOpen(false)} onFocus={show} onBlur={() => setOpen(false)} aria-describedby={mounted ? tooltipId : undefined}>
            {children}
            {mounted && createPortal(
                <div
                    ref={tipRef}
                    id={tooltipId}
                    role="tooltip"
                    style={{ top: pos.top, left: pos.left, transform: pos.placement === 'left' ? 'translate(-100%, -50%)' : `translate(-50%, ${pos.placement === 'top' ? '-100%' : '0%'})` }}
                    className={
                        'pointer-events-none fixed z-[70] max-w-[calc(100vw-16px)] rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-normal normal-case tracking-normal text-slate-100 shadow-lg ' +
                        (wrap ? 'w-80 whitespace-normal ' : multiline ? 'w-max whitespace-pre-line ' : 'w-max whitespace-nowrap ') +
                        'transition-opacity duration-200 ease-out dark:border-slate-600 ' +
                        (visible ? 'opacity-100' : 'opacity-0')
                    }
                >
                    {text}
                </div>,
                host,
            )}
        </span>
    );
};
