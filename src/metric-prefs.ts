/// <reference lib="esnext" />
import { useSyncExternalStore } from 'react';
import type { NetGexView } from './gex';
import { DEFAULT_METRIC_COLORS, loadMetricColors, saveMetricColors, type MetricColorSet } from './gex-colors';
import { persistedChoice } from './persisted-choice';

// ============================================================================
// METRIC PREFERENCES - the GEX metrics (what the bars plot) and the colours of
// their bars. The Metrics panel is on the GEX tab and on the Chart tab, so the
// colours live here, shared, and persisted in the browser (the same key as
// before, 'gex.metricColors.v1'). Which metrics are on stays in main.tsx
// (`gexMetrics`, saved in the settings). Moved here from GexView.tsx.
// ============================================================================

/** GexPoint field plotted by the bars (metric toggle, section 8.1). */
export type GexMetric = 'netGex' | 'absoluteGamma' | 'callOi' | 'putOi' | 'callVolume' | 'putVolume' | 'pcRatioOi' | 'pcRatioVolume';

/** 'absoluteGamma' (AG) sits right after 'netGex' - the user's own placement request from when they first asked for a
 *  gamma-related metric - so the Metrics panel's toggle order reads Net GEX, AG, Call OI, Put OI, Call Volume, Put Volume. */
export const GEX_METRICS: GexMetric[] = ['netGex', 'absoluteGamma', 'callOi', 'putOi', 'callVolume', 'putVolume', 'pcRatioOi', 'pcRatioVolume'];

/** What the Metrics panel's Reset goes back to: Net GEX and AG. */
export const DEFAULT_GEX_METRICS: GexMetric[] = ['netGex', 'absoluteGamma'];

// ---- ONE source of truth for the sign colours (owner, 2026-10-25) --------------------------------------------------------
// `netGexPos` / `netGexNeg` (the Net GEX bar colours, user-customizable, back to green / red on Reset) colour everything
// that is coloured by sign: the Net GEX and Abs GEX bars and legend, the Chart tab candles (bull / bear), the Board peak
// dots and row tints, the sign-coloured values of the side panels. React code reads them with useMetricColors /
// signColor; class-based styles read the CSS variables below, which follow every change and every reset at once.

/** CSS variables of the sign colours on <html>: `text-[var(--gex-pos)]`, `bg-[var(--gex-neg)]`, `color-mix(...)`. */
export const SIGN_COLOR_VARS = { pos: '--gex-pos', neg: '--gex-neg' } as const;

/** Writes the sign colour variables (no document: nothing to do). */
export function applySignColorVars(set: Pick<MetricColorSet, 'netGexPos' | 'netGexNeg'>, root: { style: { setProperty(name: string, value: string): void } } | null = typeof document === 'undefined' ? null : document.documentElement): void {
    if (!root) return;
    root.style.setProperty(SIGN_COLOR_VARS.pos, set.netGexPos);
    root.style.setProperty(SIGN_COLOR_VARS.neg, set.netGexNeg);
}

/** The sign colour of a value: positive -> `netGexPos`, negative -> `netGexNeg`, 0 or not a number -> null. */
export function signColor(value: number | null | undefined, set: Pick<MetricColorSet, 'netGexPos' | 'netGexNeg'>): string | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return null;
    return value > 0 ? set.netGexPos : set.netGexNeg;
}

let colors: MetricColorSet = loadMetricColors();
applySignColorVars(colors);
const listeners = new Set<() => void>();
const publish = (next: MetricColorSet) => { colors = next; applySignColorVars(next); listeners.forEach((l) => l()); };

export const getMetricColors = (): MetricColorSet => colors;

/** Sets the colour of one bar series and remembers it in the browser. */
export function setMetricColor(key: keyof MetricColorSet, value: string): void {
    const next = { ...colors, [key]: value };
    saveMetricColors(next);
    publish(next);
}

/** Back to the default colours. */
export function resetMetricColors(): void {
    saveMetricColors(DEFAULT_METRIC_COLORS);
    publish({ ...DEFAULT_METRIC_COLORS });
}

/** One subscribe function for every reader: an inline one made React resubscribe on every render. */
const subscribeMetricColors = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useMetricColors(): MetricColorSet {
    return useSyncExternalStore(subscribeMetricColors, getMetricColors, getMetricColors);
}

/** How the Net GEX metric is drawn (the switch inside its chip): `net` = Net GEX per strike (default), `split` = "Abs GEX",
 *  call GEX up and put GEX down at every strike (gexBarHalves in gex.ts). Remembered in the browser like the colours. */
export const netGexView = persistedChoice<NetGexView>('gex.netGexView.v1', ['net', 'split'], 'net');
