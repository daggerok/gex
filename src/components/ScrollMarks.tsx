/// <reference lib="esnext" />
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { mergeScrollTicks, scrollTicks, visibleWindow, type ScrollMarkRow, type ScrollTickGroup } from '../scroll-marks';
import { Tip } from './Tip';

// ============================================================================
// SCROLL MARKS STRIP (owner 2026-10-25, "variant B") - a narrow minimap right of a table's vertical scrollbar: one tick
// per row (src/scroll-marks.ts places, colours and merges them), a frame over the rows in view (the ticks under it are
// dimmed, the hidden ones stay bright), a click on a tick glides its row to the middle of the table (center-row.ts),
// hovering shows the strike(s) and what they mark (Tip). It is an absolute overlay in the gutter right of the card, so the
// layout does not change. Used by the Board and the Desk (ChainTable): each says what a click does (`onPick`) and the Desk,
// whose rows differ in height under a sticky pile of expiration bars, measures its own frame (`viewWindow`).
// ============================================================================

/** Width of the strip (px) and its gap to the card's right edge. */
const STRIP_WIDTH = 7;
const STRIP_GAP = 3;
/** A tick's height (px): a plain row, a row that marks something. The clickable area is at least HIT px tall. */
const TICK_PX = 2;
const MARKED_TICK_PX = 3;
const HIT_PX = 7;

export const ScrollMarks: React.FC<{
    /** the scroll container of the table */
    scrollRef: React.RefObject<HTMLElement | null>;
    /** height of the sticky header covering the top of the scroll area (for the default frame) */
    headHeight?: () => number;
    /** the rows in view as fractions of all rows; default: visibleWindow (rows of one height below `headHeight`) */
    viewWindow?: () => { top: number; bottom: number };
    rows: readonly ScrollMarkRow[];
    colors: { pos: string; neg: string; zero: string; atm: string; section?: string };
    /** a click on a tick: bring this row (the tick's most important one) to the middle of the table */
    onPick: (row: ScrollMarkRow) => void;
    /** one tooltip line per row of a tick */
    describe: (row: ScrollMarkRow) => string;
    label: string;
    /** only the rows that mark something get a tick (the Board: ATM, peaks, runner-ups), no plain rows */
    markedOnly?: boolean;
}> = ({ scrollRef, headHeight, viewWindow, rows, colors, onPick, describe, label, markedOnly = false }) => {
    const stripRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(0);
    const [view, setView] = useState({ top: 0, bottom: 1 });

    // the strip's height follows the card; the frame follows the scroll (one update per frame)
    useEffect(() => {
        const box = scrollRef.current;
        const strip = stripRef.current;
        if (!box || !strip) return undefined;
        let frame = 0;
        const measure = () => {
            frame = 0;
            setHeight(strip.clientHeight);
            const w = viewWindow ? viewWindow() : visibleWindow(box, headHeight?.() ?? 0);
            setView((v) => (v.top === w.top && v.bottom === w.bottom ? v : w));
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
        measure();
        box.addEventListener('scroll', schedule, { passive: true });
        const ro = new ResizeObserver(schedule);
        ro.observe(box);
        ro.observe(strip);
        const table = box.firstElementChild;
        if (table) ro.observe(table);
        return () => { box.removeEventListener('scroll', schedule); ro.disconnect(); cancelAnimationFrame(frame); };
    }, [scrollRef, headHeight, viewWindow, rows]);

    const groups = useMemo(() => (height > 0 ? mergeScrollTicks(scrollTicks(rows, height, colors, markedOnly)) : []), [rows, height, colors, markedOnly]);

    // the ticks do not depend on the scroll position, so scrolling re-renders only the frame
    const ticks = useMemo(() => {
        const go = (g: ScrollTickGroup) => onPick(rows[g.lead.index]);
        const centers = groups.map((g) => (g.top + g.bottom) / 2);
        return groups.map((g, i) => {
            const marked = g.kind !== 'row';
            const span = g.bottom - g.top;
            const barH = Math.max(marked ? MARKED_TICK_PX : TICK_PX, span + TICK_PX);
            const center = centers[i];
            // the clickable area: at least HIT_PX tall, but never past half way to a neighbour (no overlaps)
            const reach = Math.max(HIT_PX, barH) / 2;
            const hitTop = i > 0 ? Math.max(center - reach, (centers[i - 1] + center) / 2) : center - reach;
            const hitBottom = i < groups.length - 1 ? Math.min(center + reach, (center + centers[i + 1]) / 2) : center + reach;
            const text = g.ticks.map((t) => describe(rows[t.index])).join('\n');
            return (
                <div key={g.lead.index} className="absolute inset-x-0" style={{ top: hitTop, height: hitBottom - hitTop }}>
                    <Tip text={text} side="left" multiline wrapperClassName="flex h-full w-full">
                        <button
                            type="button"
                            tabIndex={-1}
                            aria-label={text}
                            className="relative block h-full w-full cursor-pointer"
                            onClick={() => go(g)}
                            data-scroll-tick={g.kind}
                            data-scroll-strikes={g.ticks.map((t) => t.strike).join(',')}
                            data-scroll-keys={g.ticks.map((t) => t.key).join(',')}
                        >
                            <span className={'absolute rounded-[1px] ' + (marked ? 'inset-x-0' : 'inset-x-[1px]')} style={{ top: center - hitTop - barH / 2, height: barH, backgroundColor: g.color, opacity: g.opacity }} />
                        </button>
                    </Tip>
                </div>
            );
        });
    }, [groups, rows, describe, onPick]);

    return (
        <div
            ref={stripRef}
            role="group"
            aria-label={label}
            className="absolute inset-y-0"
            style={{ left: `calc(100% + ${STRIP_GAP}px)`, width: STRIP_WIDTH }}
            data-scroll-marks
        >
            {ticks}
            {/* the rows in view: a frame that dims the ticks under it (they are on the screen already) */}
            {height > 0 && (
                <div
                    className="pointer-events-none absolute -inset-x-[2px] rounded-sm border border-slate-400/80 bg-white/60 dark:border-slate-500/80 dark:bg-slate-950/60"
                    style={{ top: view.top * height, height: Math.max(4, (view.bottom - view.top) * height) }}
                    data-scroll-frame
                />
            )}
        </div>
    );
};
