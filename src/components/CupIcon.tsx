/// <reference lib="esnext" />
import * as React from 'react';

/**
 * A small trophy cup (owner 2026-10-26): the Board marks a column's peak with a gold cup and its runner-up with a silver
 * one (the colours come from gex-colors.ts BOARD_CUP through `color`). Own inline SVG, no emoji (they render differently
 * per OS) and no image file. It is 1em square, so it takes the font size of the cell it sits in and the row keeps its
 * height; the bowl, stem and base are filled, the handles stroked, all in `currentColor`.
 */
export const CupIcon: React.FC<{ color: string; label: string; className?: string } & Record<`data-${string}`, string | undefined>> = ({ color, label, className, ...data }) => (
    <svg
        viewBox="0 0 16 16"
        width="1em"
        height="1em"
        className={className}
        style={{ color, display: 'inline-block', verticalAlign: '-0.125em' }}
        role="img"
        aria-label={label}
        {...data}
    >
        <path d="M3.5 1.5h9v3.5a4.5 4.5 0 0 1-9 0z" fill="currentColor" />
        <path d="M3.5 3H1.75v1.25a2.75 2.75 0 0 0 2.6 2.75M12.5 3h1.75v1.25a2.75 2.75 0 0 1-2.6 2.75" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <rect x="7" y="9" width="2" height="3" fill="currentColor" />
        <rect x="4.5" y="12" width="7" height="2.5" rx="0.6" fill="currentColor" />
    </svg>
);
