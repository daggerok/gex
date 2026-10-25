/// <reference lib="esnext" />
import type { IPrimitivePaneRenderer, IPrimitivePaneView, Logical, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';

// ============================================================================
// Drawings on the Chart tab that a price line cannot do, as lightweight-charts series primitives (drawn on the candle
// series' pane, in price coordinates of that series). Display only: the prices come from GexLevels (src/gex.ts).
//  - PriceBand: a translucent horizontal band between two prices across the whole pane (the Zero GEX zone as an area)
//  - RightSegments: dotted lines from the slot after the last candle to the right edge (the Sigma levels)
// ============================================================================

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** `#rrggbb` -> `rgba(r, g, b, alpha)`; any other colour string is returned unchanged. */
export function withAlpha(hex: string, alpha: number): string {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export interface PriceBandSpec {
    low: number;
    high: number;
    color: string;
}

/** A horizontal band from `low` to `high` across the whole pane, drawn under the candles, with a thin edge line on both sides. */
export class PriceBand implements ISeriesPrimitive<Time> {
    private series: ISeriesApi<SeriesType> | null = null;
    private requestUpdate: (() => void) | null = null;
    private spec: PriceBandSpec | null = null;
    private readonly view: IPrimitivePaneView;

    constructor() {
        const renderer: IPrimitivePaneRenderer = {
            draw: () => { /* drawn in the background, below the candles */ },
            drawBackground: (target: DrawTarget) => this.drawBand(target),
        };
        this.view = { renderer: () => renderer, zOrder: () => 'bottom' };
    }

    attached(param: SeriesAttachedParameter<Time>): void {
        this.series = param.series;
        this.requestUpdate = param.requestUpdate;
    }

    detached(): void {
        this.series = null;
        this.requestUpdate = null;
    }

    paneViews(): readonly IPrimitivePaneView[] {
        return [this.view];
    }

    /** null hides the band */
    set(spec: PriceBandSpec | null): void {
        this.spec = spec;
        this.requestUpdate?.();
    }

    private drawBand(target: DrawTarget): void {
        const spec = this.spec;
        const series = this.series;
        if (!spec || !series) return;
        const y1 = series.priceToCoordinate(spec.high);
        const y2 = series.priceToCoordinate(spec.low);
        if (y1 == null || y2 == null) return;
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
            const top = Math.min(y1, y2);
            const height = Math.max(1, Math.abs(y2 - y1));
            context.fillStyle = withAlpha(spec.color, 0.18);
            context.fillRect(0, top, mediaSize.width, height);
            context.strokeStyle = withAlpha(spec.color, 0.6);
            context.lineWidth = 1;
            context.setLineDash([2, 4]);
            context.beginPath();
            context.moveTo(0, top + 0.5);
            context.lineTo(mediaSize.width, top + 0.5);
            context.moveTo(0, top + height - 0.5);
            context.lineTo(mediaSize.width, top + height - 0.5);
            context.stroke();
            context.setLineDash([]);
        });
    }
}

export interface RightSegmentsSpec {
    prices: readonly number[];
    color: string;
    /** line width in px */
    width: number;
    /** logical index where the segments start (the bar slot right after the last candle = the number of bars) */
    fromLogical: number;
}

/**
 * Horizontal dotted segments at `prices` from the slot after the last candle (the next day) to the right edge of the pane:
 * the Sigma levels (owner 2026-10-25: "not across the whole chart width but only from the next day to the right edge").
 * Their labels are price lines without a line of their own (ChartView), so they stack with the other level labels.
 */
export class RightSegments implements ISeriesPrimitive<Time> {
    private series: ISeriesApi<SeriesType> | null = null;
    private chart: SeriesAttachedParameter<Time>['chart'] | null = null;
    private requestUpdate: (() => void) | null = null;
    private spec: RightSegmentsSpec | null = null;
    private readonly view: IPrimitivePaneView;

    constructor() {
        const renderer: IPrimitivePaneRenderer = { draw: (target: DrawTarget) => this.drawSegments(target) };
        this.view = { renderer: () => renderer, zOrder: () => 'top' };
    }

    attached(param: SeriesAttachedParameter<Time>): void {
        this.series = param.series;
        this.chart = param.chart;
        this.requestUpdate = param.requestUpdate;
    }

    detached(): void {
        this.series = null;
        this.chart = null;
        this.requestUpdate = null;
    }

    paneViews(): readonly IPrimitivePaneView[] {
        return [this.view];
    }

    /** null hides the segments */
    set(spec: RightSegmentsSpec | null): void {
        this.spec = spec;
        this.requestUpdate?.();
    }

    private drawSegments(target: DrawTarget): void {
        const spec = this.spec;
        const series = this.series;
        const chart = this.chart;
        if (!spec || !series || !chart || spec.prices.length === 0) return;
        const x0 = chart.timeScale().logicalToCoordinate(spec.fromLogical as Logical);
        if (x0 == null) return;
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
            const from = Math.max(0, x0);
            if (from >= mediaSize.width) return;
            context.strokeStyle = spec.color;
            context.lineWidth = spec.width;
            context.setLineDash([spec.width, spec.width * 1.5]);
            context.beginPath();
            for (const price of spec.prices) {
                const y = series.priceToCoordinate(price);
                if (y == null) continue;
                const yy = Math.round(y) + (spec.width % 2 ? 0.5 : 0);
                context.moveTo(from, yy);
                context.lineTo(mediaSize.width, yy);
            }
            context.stroke();
            context.setLineDash([]);
        });
    }
}
