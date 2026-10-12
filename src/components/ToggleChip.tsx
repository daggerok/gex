// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useId, useRef, useState } from 'react';
// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import { createPortal } from 'react-dom';

/**
 * One toggleable chip combining a show/hide toggle AND its color swatch(es)
 * into a single visual unit (Metrics panel + Key Levels panel): clicking the
 * chip's body (label) toggles the metric/level on/off, clicking the nested
 * color swatch opens the native color picker instead, without also
 * triggering the toggle.
 *
 * A real `<button>` can't contain an `<input type="color">` - interactive
 * content isn't allowed inside `<button>` per the HTML spec, and support for
 * it is inconsistent across browsers even though some render it anyway - so
 * the toggle itself is a `<div role="button">` with equivalent keyboard
 * semantics (`tabIndex`, `aria-pressed`, Enter/Space via onKeyDown) instead
 * of a literal `<button>`. `swatches` (the actual `<input type="color">`(s) -
 * one for most metrics/levels, two for Net GEX's signed pos/neg halves) is
 * wrapped in its own span that stops click/mousedown propagation, so
 * interacting with the swatch never bubbles up to the outer toggle handler.
 *
 * CUSTOM HOVER/FOCUS TOOLTIP (replaces the native `title` popup as the
 * visible-on-desktop affordance; `title` itself is KEPT on the chip - see
 * below). `title`'s explanatory text is often a full sentence or two (see
 * LEVEL_TOOLTIP_KEY's i18n strings), and the OS-rendered native `title`
 * tooltip can't be animated - there is no CSS hook into it at all - so a
 * small custom tooltip renders the same text with a fade-in/fade-out transition
 * instead.
 *
 * PORTAL, NOT A PLAIN `group-hover` SIBLING: both the Metrics row and the Key
 * Levels row this chip lives in are `overflow-x-auto` (`themed-scroll flex
 * items-center gap-2 overflow-x-auto`). Per the CSS2.1 overflow computation
 * rules, setting `overflow-x: auto` with no explicit `overflow-y` forces
 * `overflow-y` to `auto` too (only one axis staying `visible` while the other
 * is non-visible isn't a legal combination) - so the row clips in BOTH axes,
 * not just the one it scrolls. Verified live (Playwright): a plain
 * `absolute bottom-full ... group-hover:opacity-100` tooltip, as a normal
 * in-DOM child of the chip, was silently cut off at the row's own top edge
 * exactly as that rule predicts - invisible, not just mispositioned. Fixed by
 * rendering the tooltip through `createPortal` to `document.body`, positioned
 * with `position: fixed` + `getBoundingClientRect()` (viewport coordinates,
 * independent of any ancestor's overflow/stacking context) instead of
 * `position: absolute` inside the clipped row. One consequence of the
 * portal: Tailwind's `group-hover`/`group-focus-within` selectors need real
 * DOM ancestry and can't reach across a portal boundary, so visibility here
 * is plain React state (`open`, set on mouse/focus enter+leave) rather than
 * a CSS pseudo-class - the fade is still pure CSS (`transition-*`
 * classes reacting to that state), just driven by a class toggle instead of
 * `:hover`.
 *
 * The tooltip DOM node is always mounted (even while hidden, at `opacity-0
 * pointer-events-none`) rather than conditionally rendered on `open` - an
 * element that's created already AT its final "visible" style never
 * transitions (there's no prior frame to animate from); staying mounted and
 * only toggling the opacity/transform classes is what lets the transition
 * play on every open, including the very first hover.
 *
 * Horizontal placement is clamped to the viewport (`show()` below) so a chip
 * near either edge of the scrollable row doesn't push the tooltip off
 * screen; vertical placement flips from above to below the chip if there
 * isn't enough room above (e.g. a chip very close to the top of the
 * viewport) - checked against the tooltip's own measured height via `tipRef`.
 *
 * `title` is kept on the chip IN ADDITION to the custom tooltip (not
 * replaced) - touch devices with no hover state, and any assistive tech that
 * specifically keys off the native `title` attribute rather than (or
 * alongside) `aria-describedby`, still get it; it's a cheap, harmless safety
 * net under the custom one, not redundant effort. `aria-describedby` links
 * the chip to the custom tooltip node by id (via `useId`) so screen readers
 * announce the same explanatory text the visible tooltip shows.
 */
export const ToggleChip: React.FC<{
    on: boolean;
    onToggle: () => void;
    title: string;
    activeClass: string;
    idleClass: string;
    swatches: React.ReactNode;
    children: React.ReactNode;
}> = ({ on, onToggle, title, activeClass, idleClass, swatches, children }) => {
    const chipRef = useRef<HTMLDivElement>(null);
    const tipRef = useRef<HTMLDivElement>(null);
    const tooltipId = useId();
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0, placement: 'top' as 'top' | 'bottom' });

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
        }
    };
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    const GAP = 8; // px between the chip and the tooltip
    const EDGE_MARGIN = 8; // px kept clear of either viewport edge

    const show = () => {
        const chip = chipRef.current;
        if (chip) {
            const r = chip.getBoundingClientRect();
            const tipW = tipRef.current?.offsetWidth ?? 0;
            const tipH = tipRef.current?.offsetHeight ?? 0;
            const halfTip = tipW / 2;
            let left = r.left + r.width / 2;
            left = Math.min(Math.max(left, halfTip + EDGE_MARGIN), window.innerWidth - halfTip - EDGE_MARGIN);
            // Default above the chip; flip below it if there isn't room
            // above (e.g. a chip docked near the top of the viewport).
            const placement: 'top' | 'bottom' = r.top - tipH - GAP < 0 ? 'bottom' : 'top';
            const top = placement === 'top' ? r.top - GAP : r.bottom + GAP;
            setPos({ top, left, placement });
        }
        setOpen(true);
    };
    const hide = () => setOpen(false);

    return (
        <div
            ref={chipRef}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-describedby={tooltipId}
            title={title}
            onClick={onToggle}
            onKeyDown={onKeyDown}
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocus={show}
            onBlur={hide}
            className={
                'relative flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ' +
                (on ? activeClass : idleClass)
            }
        >
            {/* Every chip (including Net GEX's two signed +/- swatches) reads
                "label, then swatch(es)" inline in one row - the user tried
                stacking Net GEX's two swatches above its label in a separate
                layout and reverted after seeing it live, wanting every chip
                to look the same regardless of how many swatches it has. */}
            <span>{children}</span>
            <span className="flex shrink-0 items-center gap-1" onClick={stop} onMouseDown={stop}>
                {swatches}
            </span>
            {createPortal(
                <div
                    ref={tipRef}
                    id={tooltipId}
                    role="tooltip"
                    style={{
                        top: pos.top,
                        left: pos.left,
                        // Placement only (above vs below the chip). The tooltip no longer
                        // slides: it just fades in and out (opacity transition below).
                        transform: `translate(-50%, ${pos.placement === 'top' ? '-100%' : '0%'})`,
                    }}
                    className={
                        'pointer-events-none fixed z-50 w-64 max-w-[calc(100vw-16px)] rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] leading-snug text-slate-100 shadow-lg ' +
                        'transition-opacity duration-200 ease-out dark:border-slate-600 ' +
                        (open ? 'opacity-100' : 'opacity-0')
                    }
                >
                    {title}
                </div>,
                document.body,
            )}
        </div>
    );
};
