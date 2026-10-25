/// <reference lib="esnext" />
import { CrosshairMode, type IChartApi, type ISeriesApi, type MouseEventParams, type Time } from 'lightweight-charts';

// ============================================================================
// CROSSHAIR MAGNET (Chart tab, owner 2026-10-25) - the horizontal crosshair line follows the cursor and snaps to the
// NEAREST of the hovered candle's open, high, low and close only when the cursor is within CROSSHAIR_SNAP_PX of it;
// farther away the crosshair is free and the price axis shows the real cursor price. The library's own modes do not do
// this: Magnet snaps to the close only, MagnetOHLC always snaps. So the chart runs in Normal mode and this module moves
// the crosshair onto the price with setCrosshairPosition when the cursor is close enough.
// ============================================================================

/** How close (px, vertically) the cursor must be to an open, high, low or close for the crosshair to snap to it. */
export const CROSSHAIR_SNAP_PX = 8;

/** One snap target: a price of the hovered candle and its y coordinate on the chart. */
export interface SnapTarget {
    price: number;
    y: number;
}

/**
 * The price the crosshair snaps to (pure): the target whose y is nearest to `cursorY`, when that distance is at most
 * `threshold` px; null when none is that close (the crosshair stays free). Equal distance: the lower price.
 */
export function snapPrice(cursorY: number, targets: readonly SnapTarget[], threshold: number = CROSSHAIR_SNAP_PX): number | null {
    if (!Number.isFinite(cursorY)) return null;
    let best: SnapTarget | null = null;
    for (const t of targets) {
        if (!Number.isFinite(t.y) || !Number.isFinite(t.price)) continue;
        const d = Math.abs(t.y - cursorY);
        if (d > threshold) continue;
        if (best === null) { best = t; continue; }
        const bd = Math.abs(best.y - cursorY);
        if (d < bd || (d === bd && t.price < best.price)) best = t;
    }
    return best ? best.price : null;
}

/** OHLC of a bar of the hovered series, or null for anything else (a whitespace bar, another series type). */
function ohlcOf(data: unknown): { open: number; high: number; low: number; close: number } | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    return typeof d.open === 'number' && typeof d.high === 'number' && typeof d.low === 'number' && typeof d.close === 'number'
        ? { open: d.open, high: d.high, low: d.low, close: d.close }
        : null;
}

/**
 * Turns the magnet on for `series` of `chart` (sets Normal crosshair mode). `onSnap` reports the snapped price or null
 * (free), for the browser checks. Returns the function that turns it off.
 *
 * Feedback loop guard: setCrosshairPosition fires a crosshair move of its own; that event has no `sourceEvent` (it was
 * not the mouse or a touch), so it is ignored. Every real move inside the snap distance sets the position again: the
 * library has just drawn the free crosshair at the cursor for that move.
 */
export function attachCrosshairMagnet(chart: IChartApi, series: ISeriesApi<'Candlestick'>, onSnap?: (price: number | null) => void): () => void {
    chart.applyOptions({ crosshair: { mode: CrosshairMode.Normal } });
    const onMove = (param: MouseEventParams<Time>) => {
        if (!param.sourceEvent) return; // our own setCrosshairPosition
        const bar = ohlcOf(param.seriesData.get(series));
        if (!param.point || param.time === undefined || !bar) {
            onSnap?.(null);
            return;
        }
        const targets: SnapTarget[] = [];
        for (const price of [bar.open, bar.high, bar.low, bar.close]) {
            const y = series.priceToCoordinate(price);
            if (y !== null) targets.push({ price, y });
        }
        const price = snapPrice(param.point.y, targets);
        onSnap?.(price);
        if (price !== null) chart.setCrosshairPosition(price, param.time, series);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
}
