/// <reference lib="esnext" />
import * as React from 'react';
import { useI18n } from '../i18n';
import { DEFAULT_GEX_METRICS, GEX_METRICS, resetMetricColors, setMetricColor, useMetricColors, type GexMetric } from '../metric-prefs';
import { accentOf } from '../theme';
import type { Settings } from '../types';
import { ToggleChip } from './ToggleChip';

// ============================================================================
// METRICS PANEL - the row of chips that turns the GEX metrics on and off and sets the colours of
// their bars. One component for the GEX tab and the Chart tab, so the two look and behave the
// same (the metrics selection is `gexMetrics` of main.tsx, the colours are in metric-prefs.ts).
// Moved here from GexView.tsx.
// ============================================================================

/** The same frame as the Levels panel next to it. */
const BOX = 'flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5';

const SWATCH = 'h-4 w-4 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700';

export const MetricsPanel: React.FC<{
    metrics: GexMetric[];
    setMetrics: (metrics: GexMetric[]) => void;
    colorTheme: Settings['colorTheme'];
    /** `shrink basis-auto` sizes it to its own content, capped at half the row, as on the GEX tab */
    className?: string;
}> = ({ metrics, setMetrics, colorTheme, className = 'shrink basis-auto min-w-[260px] max-w-[50%]' }) => {
    const { t: tr } = useI18n();
    const ax = accentOf(colorTheme);
    const colors = useMetricColors();
    const labelFull = (m: GexMetric) => (m === 'absoluteGamma' ? tr('gex.metric.absoluteGammaFull') : tr('gex.metric.' + m));
    const reset = () => {
        setMetrics([...DEFAULT_GEX_METRICS]);
        resetMetricColors();
    };
    return (
        <div className={BOX + ' ' + className} role="group" aria-label={tr('gex.metric.label')}>
            <span className="text-xs text-slate-400 whitespace-nowrap">{tr('gex.metric.label')}</span>
            <div className="themed-scroll flex items-center gap-2 overflow-x-auto">
                {GEX_METRICS.map((m) => {
                    const on = metrics.includes(m);
                    return (
                        <ToggleChip
                            key={m}
                            on={on}
                            // Independently togglable (not radio buttons); the last remaining selected metric can't be turned
                            // off, so the chart is never empty.
                            onToggle={() => setMetrics(on ? (metrics.length > 1 ? metrics.filter((x) => x !== m) : metrics) : [...metrics, m])}
                            title={tr('gex.metric.tooltip.' + m)}
                            activeClass={ax.chipActive}
                            idleClass={ax.chipIdle}
                            // Per-metric bar colour pickers: Net GEX has two (its signed positive and negative halves), the others
                            // one each. Always visible (not gated on `on`) so a colour can be set up before the metric is turned on.
                            swatches={m === 'netGex' ? (
                                <>
                                    <input type="color" value={colors.netGexPos} onChange={(e) => setMetricColor('netGexPos', e.target.value)}
                                           title={tr('gex.metric.colorNetGexPos')} aria-label={tr('gex.metric.colorNetGexPos')} className={SWATCH} />
                                    <input type="color" value={colors.netGexNeg} onChange={(e) => setMetricColor('netGexNeg', e.target.value)}
                                           title={tr('gex.metric.colorNetGexNeg')} aria-label={tr('gex.metric.colorNetGexNeg')} className={SWATCH} />
                                </>
                            ) : (
                                <input type="color" value={colors[m]} onChange={(e) => setMetricColor(m, e.target.value)}
                                       title={tr('gex.metric.color', { metric: labelFull(m) })} aria-label={tr('gex.metric.color', { metric: labelFull(m) })} className={SWATCH} />
                            )}
                        >
                            {tr('gex.metric.' + m)}
                        </ToggleChip>
                    );
                })}
            </div>
            <button type="button" onClick={reset} className={'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ' + ax.chipIdle}>
                {tr('gex.metric.reset')}
            </button>
        </div>
    );
};
