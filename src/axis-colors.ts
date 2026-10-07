// Pure helpers for the GEX chart's axis tick label colors: every axis is colored like
// the series that plot on it. No React, no DOM, unit-tested in axis-colors.test.ts.

export const AXIS_NEUTRAL = '#94a3b8';

type Colors = Readonly<Record<string, string>>;

/** Left axis (Net GEX bars): positive ticks in the Net GEX (+) color, negative in the (-) color. */
export function netGexAxisColor(v: number, colors: { netGexPos: string; netGexNeg: string }): string {
    return v > 0 ? colors.netGexPos : v < 0 ? colors.netGexNeg : AXIS_NEUTRAL;
}

/** Counts axis (OI and Volume areas): calls draw above zero, puts mirrored below it, so
 *  positive ticks take the color of the first active call metric and negative ticks the
 *  color of the first active put metric (OI before Volume). A side with no active metric
 *  falls back to the other family's color so an axis with only puts or only calls is not gray. */
export function countAxisColor(v: number, active: readonly string[], colors: Colors): string {
    const call = ['callOi', 'callVolume'].find((m) => active.includes(m));
    const put = ['putOi', 'putVolume'].find((m) => active.includes(m));
    if (v < 0) return put ? colors[put] : call ? colors[call] : AXIS_NEUTRAL;
    if (v > 0) return call ? colors[call] : put ? colors[put] : AXIS_NEUTRAL;
    return AXIS_NEUTRAL;
}

/** Ratio axis (P/C lines): the color of the first active ratio metric (OI before Volume). */
export function ratioAxisColor(active: readonly string[], colors: Colors): string {
    const m = ['pcRatioOi', 'pcRatioVolume'].find((k) => active.includes(k));
    return m ? colors[m] : AXIS_NEUTRAL;
}
