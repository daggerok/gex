/// <reference lib="esnext" />
import * as React from 'react';
import type { GexMetric } from '../metric-prefs';
import type { GexLevels, Settings } from '../types';
import { useI18n } from '../i18n';
import { LevelsPanel } from './LevelsPanel';
import { MetricsPanel } from './MetricsPanel';
import { Tip } from './Tip';

/**
 * The second toolbar row of ALL four tabs (owner, 2026-10-26: the upper part of every tab is identical, so nothing jumps
 * when switching tabs): the Metrics panel and the Levels panel, the same components with the same shared
 * state (metric choice and colours, level choice and colours, the Net GEX and Zero GEX / Sigma switches), so a chip toggled
 * on one tab is toggled on all. Metrics sizes to its content up to half the row (its chips scroll beyond that), Levels
 * takes the rest from the right; one `flex-wrap` row, `justify-between`, each panel's height independent of the other.
 * On the Desk the Levels panel is shown disabled (`levelsDisabled`: greyed, inert, a tooltip says why), because levels have
 * no effect there; Metrics stay active (they choose the peaks of the Desk scroll marks). The Levels panel always sits in
 * the same Tip wrapper (no text when enabled), so the row's DOM and box are the same on every tab.
 * `layout.e2e.ts` checks that the row has the same position and size on the four tabs.
 */
export const ToolbarRow: React.FC<{
    metrics: GexMetric[];
    setMetrics: (metrics: GexMetric[]) => void;
    levels: GexLevels | null;
    symbol: string;
    colorTheme: Settings['colorTheme'];
    /** the spot shown is a put-call parity estimate (the Spot chip's tooltip says so) */
    spotEstimated?: boolean;
    /** the Desk: levels are shown but not usable there */
    levelsDisabled?: boolean;
}> = ({ metrics, setMetrics, levels, symbol, colorTheme, spotEstimated = false, levelsDisabled = false }) => {
    const { t: tr } = useI18n();
    return (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2" data-toolbar-row>
            <MetricsPanel metrics={metrics} setMetrics={setMetrics} colorTheme={colorTheme} />
            {/* the wrapper takes the panel's own sizing (grow, min 300 px, at most its content), the panel fills it */}
            <Tip text={levelsDisabled ? tr('desk.levelsDisabled') : ''} wrapperClassName="flex grow basis-0 min-w-[300px] max-w-fit">
                <LevelsPanel levels={levels} symbol={symbol} colorTheme={colorTheme} spotEstimated={spotEstimated} showMaxAg={metrics.includes('absoluteGamma')} disabled={levelsDisabled} />
            </Tip>
        </div>
    );
};
