/// <reference lib="esnext" />
import * as React from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { edgeFadeMask, edgeScrollTarget, scrollEdges, type ScrollEdges } from '../edge-scroll';
import { Tip } from './Tip';
import { useI18n } from '../i18n';
import { accentOf } from '../theme';
import type { ColorThemeId } from '../types';
import { oiSharePct } from '../utils';

/**
 * Multi-select expiration chips + "All"/"None" toggle. Rendered ONCE in a
 * shared panel (main.tsx, via TabSwitcher's `endSlot`, in the same row as the
 * tab pills) next to the Reset button, visible on every tab - no longer
 * duplicated per-view (see main.tsx changelog). Renders
 * a fragment (label, chip strip, toggle) so the caller supplies the wrapper.
 *
 * Overflow fix: the chip strip caps itself at `max-w-[70vw]` and scrolls
 * internally (`overflow-x-auto`) - that part was never the bug. The bug was
 * the CALLER's row not wrapping: a plain `flex` row has no upper bound of its
 * own, so at narrow (mobile) widths the fixed-width "All"/"None" toggle AND
 * the Load button of that time (a sibling in the caller's row) got pushed past the right
 * edge of the viewport - genuinely clipped, not just scrolled - because nothing
 * in that row could wrap. Confirmed live via Playwright at 320-414px widths
 * before this fix (Load button's bounding rect exceeded window.innerWidth and
 * document.documentElement.scrollWidth grew past the viewport). Callers now
 * add `flex-wrap` to their own row so the toggle and the Reset button drop to a second
 * line instead of sliding off-screen when space is tight.
 *
 * No scrollbar (owner 2026-10-26): the chip row is clipped, the side(s) with more chips fade out (a CSS mask, so any panel
 * background works) and a < / > button on that side (only while there is more that way) glides the previous / next
 * hidden chip into view (src/edge-scroll.ts). Trackpad and touch swipes scroll natively, a vertical mouse wheel scrolls
 * the row sideways. The buttons are overlays on the faded edges, so the panel keeps its size whether they show or not.
 */

/** Width of the fade on a clipped side (px); a chip under it counts as hidden. */
const FADE_PX = 28;
const NO_EDGES: ScrollEdges = { left: false, right: false };

/** The < / > button on a clipped side of the chip row: an overlay on the fade, app Tip, en + ru label. */
const EdgeButton: React.FC<{ dir: 1 | -1; label: string; onClick: () => void }> = ({ dir, label, onClick }) => (
    <div className={'absolute inset-y-0 z-10 flex items-center ' + (dir === 1 ? 'right-0' : 'left-0')}>
        <Tip text={label} wrapperClassName="inline-flex">
            <button
                type="button"
                tabIndex={-1}
                onClick={onClick}
                aria-label={label}
                data-exp-scroll={dir === 1 ? 'next' : 'prev'}
                className="grid h-5 w-5 place-items-center rounded-full border border-slate-300 bg-white text-slate-500 shadow-sm hover:text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:text-white"
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                    <path d={dir === 1 ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
                </svg>
            </button>
        </Tip>
    </div>
);
export const ExpirationChips: React.FC<{
    expirations: string[];
    selected: string[];
    onToggle: (exp: string) => void;
    /** Called with every expiration ("All") or an empty list ("None"). */
    onSetAll: (exps: string[]) => void;
    colorTheme: ColorThemeId;
    /** Each LOADED expiration's share (0..1) of the open interest of all loaded expirations (gex.ts expirationOiShares). */
    shares?: Readonly<Record<string, number>>;
}> = ({ expirations, selected, onToggle, onSetAll, colorTheme, shares }) => {
    const { t: tr } = useI18n();
    const ax = accentOf(colorTheme);
    const allOn = selected.length === expirations.length;
    const rowRef = useRef<HTMLDivElement>(null);
    const [edges, setEdges] = useState<ScrollEdges>(NO_EDGES);
    // which sides have more chips: on scroll, on a resize of the row or of its chips, on a new list
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
        ro.observe(row);
        Array.from(row.children).forEach((c) => ro.observe(c));
        return () => { row.removeEventListener('scroll', schedule); row.removeEventListener('wheel', wheel); ro.disconnect(); cancelAnimationFrame(frame); };
    }, [expirations]);
    // < / >: glide the previous / next hidden chip into view, clear of the button and its fade
    const step = useCallback((dir: 1 | -1) => {
        const row = rowRef.current;
        if (!row) return;
        const box = row.getBoundingClientRect();
        const chips = Array.from(row.children).map((c) => {
            const r = c.getBoundingClientRect();
            return { left: r.left - box.left + row.scrollLeft, right: r.right - box.left + row.scrollLeft };
        });
        const target = edgeScrollTarget(chips, row.scrollLeft, row.clientWidth, row.scrollWidth, dir, FADE_PX);
        if (target !== null) row.scrollTo({ left: target, behavior: 'smooth' });
    }, []);
    const mask = edgeFadeMask(edges, FADE_PX) ?? undefined;
    return (
        <>
            <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">{tr('controls.expirations')}</span>
            {/* Was max-w-[46vw]: that cap was sized to share a row with Desk's
                ticker-input/provider-dropdown row. Now this strip lives alone
                in the shared panel (main.tsx), so it can afford more room;
                widened to 70vw. Still capped (not unbounded) so the "All"/
                "None" toggle in a wide chain never has to fight for space on
                the same line - the caller's row additionally wraps (flex-wrap)
                as a second line of defense at widths where even 70vw plus the
                toggle and the Reset button don't fit. */}
            <div className="relative flex min-w-0 max-w-[70vw] lg:max-w-none" data-exp-strip>
            <div
                ref={rowRef}
                className="scrollbar-hidden flex min-w-0 items-center gap-1 overflow-x-auto"
                style={{ maskImage: mask, WebkitMaskImage: mask }}
                data-exp-row
            >
                {expirations.map((exp) => {
                    const on = selected.includes(exp);
                    const pct = oiSharePct(shares?.[exp]);
                    return (
                        <button
                            key={exp}
                            type="button"
                            onClick={() => onToggle(exp)}
                            aria-pressed={on}
                            aria-label={pct ? tr('controls.expShare', { exp, pct }) : exp}
                            data-exp-chip={exp}
                            className={
                                'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ' +
                                (on
                                    ? ax.chipActive
                                    : ax.chipIdle)
                            }
                        >
                            {exp}
                            {/* the OI share in a slot of fixed width: nothing moves while the shares load or for an expiration
                                without one (not loaded yet with a lazy provider) */}
                            <span className="ml-1 inline-block w-[2.75rem] text-right tabular-nums opacity-70" data-exp-share>{pct}</span>
                        </button>
                    );
                })}
            </div>
            {edges.left && <EdgeButton dir={-1} label={tr('controls.expPrev')} onClick={() => step(-1)} />}
            {edges.right && <EdgeButton dir={1} label={tr('controls.expNext')} onClick={() => step(1)} />}
            </div>
            <Tip text={tr('controls.all') + ' / ' + tr('controls.none')} wrapperClassName="inline-flex shrink-0">
            <button
                type="button"
                onClick={() => onSetAll(allOn ? [] : [...expirations])}
                className="shrink-0 rounded-md border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
                {allOn ? tr('controls.none') : tr('controls.all')}
            </button>
            </Tip>
        </>
    );
};
