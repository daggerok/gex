/// <reference lib="esnext" />
import * as React from 'react';
import { AG_DOT_STROKE_WIDTH } from '../gex-colors';

// ============================================================================
// Absolute Gamma rings on the GEX chart (owner 2026-10-25, "AG rings v4"; v3 = hollow rings, #211). Every strike on the
// AG line gets a hollow ring, and the inside of a ring shows ONLY what is behind the AG series (the chart background or a
// Net GEX (+)/(-) bar): the AG line and its area fill are cut out inside every ring, and inside the hovered ring the small
// ring of that strike is cut out too.
//
// How (recharts 3.10, checked in the DOM): the Area draws its fill and line in `g.recharts-area` (zIndex layer 350, it
// carries the Area's className), the dots in a separate `g.recharts-area-dots` (layer 600) and the hovered dot in
// `g.recharts-active-dot` (layer 1200). The dot renderer gets every point (`points`), so the FIRST dot also renders two
// SVG masks (definitions only, nothing visible):
// - holes: white everywhere, a black disc of the ring radius at every point, plus the hover hole. CSS puts it on the AG
//   area layer (`.gex-ag-area { mask: var(--gex-ag-holes) }`, the id comes through the chart's style), so line and fill
//   disappear inside the rings. The disc edge lies under the opaque ring stroke, so no fringe of the line shows
// - hover: white everywhere plus the hover hole, on the layer of the small rings (`.recharts-area-dots:has([data-ag-dot])
//   { mask: var(--gex-ag-hover) }`), so the small ring of the hovered strike vanishes inside the big one
// Only these two masked layers: a mask per ring (108 offscreen buffers) slowed the whole page on CI's software renderer.
// The hovered ring renders its own hole as a `<defs>` disc that both masks `<use>`: it exists only while a dot is hovered
// and moves with it. Positions come from recharts on every render, so they follow zoom, pan and resize.
// ============================================================================

/** Radius of the AG ring at every strike and of the hovered one (owner 2026-10-25: bolder than the 2 / 3.5 of v1). */
export const AG_DOT_RADIUS = 3.5;
export const AG_DOT_ACTIVE_RADIUS = 5.5;
/** className of the AG <Area>: index.css masks that layer with the holes mask. */
export const AG_AREA_CLASS = 'gex-ag-area';
/** Masks cover the chart svg's viewport, nothing more (a bigger region costs offscreen pixels). */
const MASK_VIEWPORT = { x: 0, y: 0, width: '100%', height: '100%' } as const;

export interface AgRingIds { holes: string; hover: string; hoverHole: string }

/** Element ids of one chart's masks, from a React useId value (unique per chart). */
export function agRingIds(base: string): AgRingIds {
    const id = base.replace(/[^A-Za-z0-9_-]/g, '_');
    return { holes: `${id}-ag-holes`, hover: `${id}-ag-hover`, hoverHole: `${id}-ag-hover-hole` };
}

/** Style of the chart that hands the masks to the AG area and rings layers (index.css reads the variables). */
export function agHolesStyle(ids: AgRingIds): React.CSSProperties {
    return { ['--gex-ag-holes' as string]: `url(#${ids.holes})`, ['--gex-ag-hover' as string]: `url(#${ids.hover})` } as React.CSSProperties;
}

/** What recharts passes to a custom Area dot (the fields used here). */
export interface AgDotProps {
    cx?: number;
    cy?: number;
    index?: number;
    points?: ReadonlyArray<{ x?: number | null; y?: number | null }>;
}

function maskArea(): React.ReactElement {
    return <rect {...MASK_VIEWPORT} fill="white" />;
}

function agMasks(ids: AgRingIds, points: AgDotProps['points']): React.ReactElement {
    const extent = { maskUnits: 'userSpaceOnUse', ...MASK_VIEWPORT } as const;
    return (
        <defs>
            <mask id={ids.holes} {...extent} data-ag-mask="holes">
                {maskArea()}
                {(points ?? []).map((p, i) => (p.x == null || p.y == null ? null : <circle key={i} cx={p.x} cy={p.y} r={AG_DOT_RADIUS} fill="black" />))}
                <use href={`#${ids.hoverHole}`} />
            </mask>
            <mask id={ids.hover} {...extent} data-ag-mask="hover">
                {maskArea()}
                <use href={`#${ids.hoverHole}`} />
            </mask>
        </defs>
    );
}

/** What recharts passes to the custom active (hovered) dot: its `points` is the SVG attribute, not the point list. */
export interface AgActiveDotProps { cx?: number; cy?: number; index?: number }

function ring(cx: number, cy: number, r: number, stroke: string, active: boolean): React.ReactElement {
    return <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={AG_DOT_STROKE_WIDTH} data-ag-dot={active ? 'active' : 'ring'} />;
}

/** The `dot` renderer of the AG <Area>: a hollow ring in `stroke`; the first dot also renders the masks (see the header). */
export function agDotRenderer(ids: AgRingIds, stroke: string) {
    return (props: AgDotProps): React.ReactElement => (
        <g key={`ag-dot-${props.index}`}>
            {props.index === 0 && agMasks(ids, props.points)}
            {props.cx != null && props.cy != null && ring(props.cx, props.cy, AG_DOT_RADIUS, stroke, false)}
        </g>
    );
}

/** The `activeDot` renderer: the larger hovered ring in `stroke` plus its hole, which both masks use (see the header). */
export function agActiveDotRenderer(ids: AgRingIds, stroke: string) {
    return (props: AgActiveDotProps): React.ReactElement => {
        const key = `ag-active-dot-${props.index}`;
        if (props.cx == null || props.cy == null) return <g key={key} />;
        return (
            <g key={key}>
                <defs><circle id={ids.hoverHole} cx={props.cx} cy={props.cy} r={AG_DOT_ACTIVE_RADIUS} fill="black" /></defs>
                {ring(props.cx, props.cy, AG_DOT_ACTIVE_RADIUS, stroke, true)}
            </g>
        );
    };
}
