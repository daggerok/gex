// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React from 'react';
import { useI18n } from '../i18n';
import { accentOf } from '../theme';
import type { Settings } from '../types';
import { CHART_RANGES, type ChartRange } from '../views/chart-range';
import { FullscreenButton } from './FullscreenButton';
import { HelpButton } from './HelpButton';

// ============================================================================
// CHART HEADER - the symbol, the help (?) button and the interval selector (1M, 3M,
// 6M, 1Y, All) of the Chart tab, laid in the very top left corner of the chart (flush, no margin, only its bottom right corner is rounded, so no candle or line shows around it) (owner's layout: the tab row
// and the Expirations panel stay exactly as on the other tabs, the Metrics and Levels panels are the
// same as on the GEX tab). Rendered by ChartView inside the chart box.
// ============================================================================

const BOX = 'flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-0.5';

export const ChartHeader: React.FC<{
    symbol: string;
    range: ChartRange;
    setRange: (range: ChartRange) => void;
    colorTheme: Settings['colorTheme'];
    fullscreen?: { full: boolean; toggle: () => void };
}> = ({ symbol, range, setRange, colorTheme, fullscreen }) => {
    const { t: tr } = useI18n();
    const ax = accentOf(colorTheme);
    return (
        <div data-chart-header className="flex flex-wrap items-center gap-2 rounded-br-lg border-b border-r border-slate-300 bg-white/90 px-2 py-1 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/85">
            <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-slate-900 dark:text-slate-50">{symbol}</span>
                <HelpButton label={tr('chart.help.label')} paragraphs={[tr('chart.help.addLevel'), tr('chart.help.editLevel'), tr('chart.help.moveLevel'), tr('chart.help.removeLevel')]} align="left" />
            </div>
            <div className={BOX} role="group" aria-label={tr('chart.range.label')}>
                <span className="text-xs text-slate-400">{tr('chart.range.label')}</span>
                <div className="flex items-center gap-1">
                    {CHART_RANGES.map((r) => (
                        <button
                            key={r}
                            type="button"
                            onClick={() => setRange(r)}
                            aria-pressed={range === r}
                            className={'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ' + (range === r ? ax.chipActive : ax.chipIdle)}
                        >
                            {tr('chart.range.' + r)}
                        </button>
                    ))}
                </div>
            </div>
            {fullscreen && <FullscreenButton full={fullscreen.full} onToggle={fullscreen.toggle} />}
        </div>
    );
};
