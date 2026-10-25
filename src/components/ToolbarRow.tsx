/// <reference lib="esnext" />
import * as React from 'react';
import type { GexMetric } from '../metric-prefs';
import type { GexLevels, Settings } from '../types';
import { LevelsPanel } from './LevelsPanel';
import { MetricsPanel } from './MetricsPanel';

/**
 * The second toolbar row of the Board, GEX and Chart tabs (owner, 2026-10-25: the upper part of those three tabs is
 * identical, the Desk has no such row): the Metrics panel and the Levels panel, the same components with the same shared
 * state (metric choice and colours, level choice and colours, the Net GEX and Zero GEX / Sigma switches), so a chip toggled
 * on one tab is toggled on all. Metrics sizes to its content up to half the row (its chips scroll beyond that), Levels
 * takes the rest from the right; one `flex-wrap` row, `justify-between`, each panel's height independent of the other.
 * `layout.e2e.ts` checks that the row has the same position and size on the three tabs.
 */
export const ToolbarRow: React.FC<{
    metrics: GexMetric[];
    setMetrics: (metrics: GexMetric[]) => void;
    levels: GexLevels | null;
    symbol: string;
    colorTheme: Settings['colorTheme'];
    /** the spot shown is a put-call parity estimate (the Spot chip's tooltip says so) */
    spotEstimated?: boolean;
}> = ({ metrics, setMetrics, levels, symbol, colorTheme, spotEstimated = false }) => (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2" data-toolbar-row>
        <MetricsPanel metrics={metrics} setMetrics={setMetrics} colorTheme={colorTheme} />
        <LevelsPanel levels={levels} symbol={symbol} colorTheme={colorTheme} spotEstimated={spotEstimated} showMaxAg={metrics.includes('absoluteGamma')} />
    </div>
);
