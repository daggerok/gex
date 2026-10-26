/// <reference lib="esnext" />
import * as React from 'react';
import { levelColorOf } from '../custom-levels';
import { useI18n } from '../i18n';
import { gammaFlipUnavailableText, LEVEL_LABEL_KEY, LEVEL_TOOLTIP_KEY, levelPanelOrder, resetLevelPrefs, setLevelColor, sigmaMode, toggleLevel, useLevelPrefs, zeroGexDisplay } from '../level-prefs';
import { accentOf } from '../theme';
import type { GexLevels, Settings } from '../types';
import { fmt, fmtDays } from '../utils';
import { useCustomLevels } from '../use-custom-levels';
import { ChipSwitch, StableLabel } from './ChipSwitch';
import { EdgeScrollRow } from './EdgeScrollRow';
import { ToggleChip } from './ToggleChip';

// ============================================================================
// LEVELS PANEL - the row of chips that shows, hides and colours the GEX levels and the
// user's own levels. One component for the GEX tab and the Chart tab, so the two look and
// behave the same and share the same choices (level-prefs.ts, custom-levels.ts). The chips
// run from the lowest price to the highest, a level with no price sinks to the right.
// ============================================================================

/** The same frame as the Metrics panel next to it on the GEX tab. */
const BOX = 'flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5';

export const LevelsPanel: React.FC<{
    levels: GexLevels | null;
    symbol: string;
    colorTheme: Settings['colorTheme'];
    /** the spot shown is an estimate (put-call parity), its tooltip says so */
    spotEstimated?: boolean;
    /** the AG metric is on: only then the Max AG level has a chip */
    showMaxAg?: boolean;
    /** fills its wrapper in ToolbarRow, which carries the row sizing (grow, min 300 px, at most its content) */
    className?: string;
    /** shown but not usable (the Desk: levels have no effect there, owner 2026-10-26): greyed, `inert` (no clicks, no focus);
     *  the reason is the tooltip of the wrapper around it (ToolbarRow), since an inert element gets no hover */
    disabled?: boolean;
}> = ({ levels, symbol, colorTheme, spotEstimated = false, showMaxAg = false, className = 'min-w-0 flex-1', disabled = false }) => {
    const { t: tr } = useI18n();
    const ax = accentOf(colorTheme);
    const { selected, colors } = useLevelPrefs();
    const zeroArea = zeroGexDisplay.use() === 'area';
    const sigmaStat = sigmaMode.use() === 'stat';
    /** The Sigma tooltip says which mode is shown, and in the statistical mode what it was computed from. */
    const sigmaTooltip = (): string => {
        if (!sigmaStat) return tr('gex.level.tooltip.sigmaPct');
        const basis = levels?.sigma?.statBasis;
        if (!basis) return tr('gex.level.tooltip.sigmaStatNone');
        return tr('gex.level.tooltip.sigmaStat', { move: fmt(basis.move), iv: `${(basis.iv * 100).toFixed(1)}%`, expiration: basis.expiration, days: fmtDays(basis.days) });
    };
    const [customLevels, setCustomLevels] = useCustomLevels(symbol);
    const entries = levelPanelOrder(levels, customLevels, showMaxAg ? [] : ['maxAbsGamma']);

    const reset = () => {
        resetLevelPrefs();
        // a custom level that was switched off comes back, its colour stays
        if (customLevels.some((c) => c.hidden)) setCustomLevels(customLevels.map(({ hidden, ...rest }) => rest));
    };

    return (
        <div className={BOX + ' ' + className + (disabled ? ' opacity-50 grayscale' : '')} role="group" aria-label={tr('gex.sidebar.keyLevels')} inert={disabled} aria-disabled={disabled || undefined} data-levels-disabled={disabled || undefined}>
            <span className="text-xs text-slate-400 whitespace-nowrap">{tr('gex.sidebar.keyLevels')}</span>
            {/* A spacer as the first child, not `justify-end` on the row: with `justify-end` an overflowing row cannot be
                scrolled back to its first chips; the spacer pushes the chips to the right when they fit and gives way when not.
                No scrollbar: fades and < / > buttons on the side(s) with more chips, like the Expirations panel (EdgeScrollRow). */}
            <EdgeScrollRow scope="levels" rowClassName="gap-2" prevLabel={tr('gex.level.scrollPrev')} nextLabel={tr('gex.level.scrollNext')}>
                <div aria-hidden="true" className="flex-1" />
                {entries.map((entry) => {
                    if (entry.builtin) {
                        const key = entry.builtin;
                        const on = selected.includes(key);
                        const label = tr(LEVEL_LABEL_KEY[key]);
                        const tooltip = key === 'spot' && spotEstimated ? tr('gex.level.tooltip.spotEstimated')
                            : key === 'sigma' ? sigmaTooltip()
                                : key === 'gammaFlip' && levels?.gammaFlipUnavailable
                                    ? `${gammaFlipUnavailableText(levels, tr)} ${tr(LEVEL_TOOLTIP_KEY[key])}`
                                    : tr(LEVEL_TOOLTIP_KEY[key]);
                        return (
                            <ToggleChip
                                key={entry.key}
                                on={on}
                                onToggle={() => toggleLevel(key)}
                                title={tooltip}
                                activeClass={ax.chipActive}
                                idleClass={ax.chipIdle}
                                // Zero GEX: the switch on the left of the label draws it as a band (area) instead of a line
                                leading={key === 'zeroGex' ? (
                                    <ChipSwitch checked={zeroArea} onChange={(on) => zeroGexDisplay.set(on ? 'area' : 'line')} label={tr('gex.level.zeroGexSwitch')} />
                                ) : key === 'sigma' ? (
                                    // Sigma: % steps (off) or statistical sigma (on); the label names the mode, same width in both
                                    <ChipSwitch checked={sigmaStat} onChange={(on) => sigmaMode.set(on ? 'stat' : 'pct')} label={tr('gex.level.sigmaSwitch')} />
                                ) : undefined}
                                swatches={
                                    <input
                                        type="color"
                                        value={colors[key]}
                                        onChange={(e) => setLevelColor(key, e.target.value)}
                                        aria-label={tr('gex.level.color', { level: label })}
                                        className="h-4 w-4 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700"
                                    />
                                }
                            >
                                {key === 'sigma'
                                    ? <StableLabel value={tr(sigmaStat ? 'gex.level.sigmaStatLabel' : 'gex.level.sigmaPctLabel')} options={[tr('gex.level.sigmaPctLabel'), tr('gex.level.sigmaStatLabel')]} />
                                    : label}
                            </ToggleChip>
                        );
                    }
                    const c = entry.custom!;
                    return (
                        <ToggleChip
                            key={entry.key}
                            on={!c.hidden}
                            onToggle={() => setCustomLevels(customLevels.map((x) => (x.id === c.id ? (x.hidden ? (({ hidden, ...rest }) => rest)(x) : { ...x, hidden: true }) : x)))}
                            title={tr('chart.custom.chipTitle', { price: fmt(c.price) })}
                            activeClass={ax.chipActive}
                            idleClass={ax.chipIdle}
                            swatches={
                                <input
                                    type="color"
                                    value={levelColorOf(c)}
                                    onChange={(e) => setCustomLevels(customLevels.map((x) => (x.id === c.id ? { ...x, color: e.target.value } : x)))}
                                    aria-label={tr('gex.level.color', { level: c.name })}
                                    className="h-4 w-4 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700"
                                />
                            }
                        >
                            {c.name}
                        </ToggleChip>
                    );
                })}
            </EdgeScrollRow>
            <button
                type="button"
                onClick={reset}
                className={'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ' + ax.chipIdle}
            >
                {tr('gex.level.reset')}
            </button>
        </div>
    );
};
