/// <reference lib="esnext" />
import * as React from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { edgeFadeMask, edgeScrollTarget, scrollEdges, type ScrollEdges } from '../edge-scroll';
import { Tip } from './Tip';

// ============================================================================
// EDGE SCROLL ROW (owner 2026-10-26): a horizontal row of chips with no scrollbar. The side(s) with more chips fade out
// (a CSS mask, so any panel background works) and a < / > button on that side (only while there is more that way) glides
// the previous / next hidden chip into view (src/edge-scroll.ts). Trackpad and touch swipes scroll natively, a vertical
// mouse wheel scrolls the row sideways. The buttons are overlays on the faded edges, so the panel keeps its size whether
// they show or not. Used by the shared Expirations panel (ExpirationChips) and the Levels panel (LevelsPanel).
// ============================================================================

/** Width of the fade on a clipped side (px); a chip under it counts as hidden. */
export const EDGE_FADE_PX = 28;
const NO_EDGES: ScrollEdges = { left: false, right: false };

/** The < / > button on a clipped side of the row: an overlay on the fade, app Tip, the caller's en + ru label. */
const EdgeButton: React.FC<{ dir: 1 | -1; label: string; scope: string; onClick: () => void }> = ({ dir, label, scope, onClick }) => (
    <div className={'absolute inset-y-0 z-10 flex items-center ' + (dir === 1 ? 'right-0' : 'left-0')}>
        <Tip text={label} wrapperClassName="inline-flex">
            <button
                type="button"
                tabIndex={-1}
                onClick={onClick}
                aria-label={label}
                {...{ [`data-${scope}-scroll`]: dir === 1 ? 'next' : 'prev' }}
                className="grid h-5 w-5 place-items-center rounded-full border border-slate-300 bg-white text-slate-500 shadow-sm hover:text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:text-white"
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                    <path d={dir === 1 ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
                </svg>
            </button>
        </Tip>
    </div>
);

export const EdgeScrollRow: React.FC<{
    /** names the data attributes: `data-<scope>-strip` (the wrapper), `data-<scope>-row` (the scroller) and
     *  `data-<scope>-scroll="prev|next"` (the buttons) */
    scope: string;
    prevLabel: string;
    nextLabel: string;
    /** extra classes of the wrapper (sizing in the caller's row) */
    className?: string;
    /** extra classes of the scrolling row (the gap between chips) */
    rowClassName?: string;
    children: React.ReactNode;
}> = ({ scope, prevLabel, nextLabel, className = '', rowClassName = '', children }) => {
    const rowRef = useRef<HTMLDivElement>(null);
    const [edges, setEdges] = useState<ScrollEdges>(NO_EDGES);
    // which sides have more chips: on scroll, on a resize of the row or of its chips, when chips come or go
    useLayoutEffect(() => {
        const row = rowRef.current;
        if (!row) return undefined;
        let frame = 0;
        const measure = () => {
            const e = scrollEdges(row.scrollLeft, row.clientWidth, row.scrollWidth);
            setEdges((prev) => (prev.left === e.left && prev.right === e.right ? prev : e));
        };
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
        measure();
        // a vertical mouse wheel scrolls the row sideways (a trackpad's horizontal swipe and touch scroll natively); at an end
        // the wheel is left to the page
        const wheel = (ev: WheelEvent) => {
            if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX) || row.scrollWidth <= row.clientWidth) return;
            const before = row.scrollLeft;
            row.scrollLeft += ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
            if (row.scrollLeft !== before) ev.preventDefault();
        };
        row.addEventListener('scroll', schedule, { passive: true });
        row.addEventListener('wheel', wheel, { passive: false });
        const ro = new ResizeObserver(schedule);
        const observeChips = () => { ro.disconnect(); ro.observe(row); Array.from(row.children).forEach((c) => ro.observe(c)); };
        observeChips();
        // a new list of chips (another ticker's expirations, a level that appears): watch the new chips and measure again
        const mo = new MutationObserver(() => { observeChips(); schedule(); });
        mo.observe(row, { childList: true });
        return () => { row.removeEventListener('scroll', schedule); row.removeEventListener('wheel', wheel); ro.disconnect(); mo.disconnect(); cancelAnimationFrame(frame); };
    }, []);
    // < / >: glide the previous / next hidden chip into view, clear of the button and its fade
    const step = useCallback((dir: 1 | -1) => {
        const row = rowRef.current;
        if (!row) return;
        const box = row.getBoundingClientRect();
        const chips = Array.from(row.children).map((c) => c.getBoundingClientRect())
            // an empty spacer (LevelsPanel's) is not a chip
            .filter((r) => r.width > 0)
            .map((r) => ({ left: r.left - box.left + row.scrollLeft, right: r.right - box.left + row.scrollLeft }));
        const target = edgeScrollTarget(chips, row.scrollLeft, row.clientWidth, row.scrollWidth, dir, EDGE_FADE_PX);
        if (target !== null) row.scrollTo({ left: target, behavior: 'smooth' });
    }, []);
    const mask = edgeFadeMask(edges, EDGE_FADE_PX) ?? undefined;
    return (
        <div className={'relative flex min-w-0 ' + className} {...{ [`data-${scope}-strip`]: '' }}>
            <div
                ref={rowRef}
                className={'scrollbar-hidden flex min-w-0 items-center overflow-x-auto ' + rowClassName}
                style={{ maskImage: mask, WebkitMaskImage: mask }}
                {...{ [`data-${scope}-row`]: '' }}
            >
                {children}
            </div>
            {edges.left && <EdgeButton dir={-1} label={prevLabel} scope={scope} onClick={() => step(-1)} />}
            {edges.right && <EdgeButton dir={1} label={nextLabel} scope={scope} onClick={() => step(1)} />}
        </div>
    );
};
