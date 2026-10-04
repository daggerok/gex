// ---------------------------------------------------------------------------
// GEX level colors - shared by the GEX tab (Key Levels card + recharts
// reference lines) and the Chart tab's lightweight-charts price lines (plan sections
// 8.1 / 8.2) so both tabs use the exact same color per level.
//
// `hex` is for chart libraries that take raw colors (recharts and
// lightweight-charts). `dot` is the matching Tailwind class for
// HTML swatches; class names are spelled out literally so Tailwind's source
// scanner picks them up. Values follow the Tab 2 wireframe.
// ---------------------------------------------------------------------------

export type GexLevelKey = 'callWall' | 'callWall2' | 'gammaFlip' | 'putWall' | 'putWall2' | 'maxPain' | 'spot';

export interface GexLevelColor {
    hex: string;
    dot: string;
}

export const GEX_LEVEL_COLORS: Record<GexLevelKey, GexLevelColor> = {
    callWall: { hex: '#22c55e', dot: 'bg-green-500' },   // green-500
    callWall2: { hex: '#86efac', dot: 'bg-green-300' },  // green-300 (Resistance 2)
    gammaFlip: { hex: '#a78bfa', dot: 'bg-violet-400' }, // violet-400
    putWall: { hex: '#ef4444', dot: 'bg-red-500' },      // red-500
    putWall2: { hex: '#fca5a5', dot: 'bg-red-300' },     // red-300 (Support 2)
    maxPain: { hex: '#facc15', dot: 'bg-yellow-400' },   // yellow-400
    spot: { hex: '#f59e0b', dot: 'bg-amber-500' },       // amber-500
};

/** Bar fills for the GEX tab: call-side (positive) vs put-side (negative). */
export const GEX_BAR_COLORS = {
    call: '#22c55e', // green-500
    put: '#ef4444',  // red-500
} as const;
