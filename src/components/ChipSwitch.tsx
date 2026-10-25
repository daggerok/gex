/// <reference lib="esnext" />
import * as React from 'react';

// ============================================================================
// CHIP SWITCH - a small on/off switch that sits INSIDE a panel chip (ToggleChip's `leading` slot), on the left of the
// chip's label, while the colour swatches stay on the right. It switches a mode of what the chip shows, not whether it
// is shown: the Net GEX / Abs GEX view of the Net GEX metric, the line / area display of the Zero GEX level, the % / sigma
// mode of the Chart tab's Sigma levels. Its own click and keys never reach the chip (they would toggle the metric or
// level). It draws in `currentColor`, so it reads on an active (accent) chip and on an idle (white or dark) one alike.
//
// StableLabel keeps the chip exactly as wide in both modes: every possible label is laid in the same grid cell and only
// the current one is visible, so the cell is as wide as the widest label and nothing next to the chip moves.
// ============================================================================

export const ChipSwitch: React.FC<{
    checked: boolean;
    onChange: (checked: boolean) => void;
    /** accessible name, e.g. "Show GEX split"; no native `title`: the chip's own animated tooltip explains the switch */
    label: string;
}> = ({ checked, onChange, label }) => {
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            data-chip-switch=""
            onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
            onMouseDown={stop}
            onKeyDown={stop}
            className={
                'relative inline-flex h-3.5 w-6 shrink-0 cursor-pointer items-center rounded-full border border-current p-0 transition-colors duration-150 ' +
                (checked ? 'bg-current/30' : 'bg-transparent')
            }
        >
            <span
                aria-hidden="true"
                className={'absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-current transition-[left] duration-150 ' + (checked ? 'left-[calc(100%-0.6875rem)]' : 'left-[0.1875rem]')}
            />
        </button>
    );
};

/** One of several labels, as wide as the widest of them (no layout jump when the label changes). */
export const StableLabel: React.FC<{ value: string; options: readonly string[] }> = ({ value, options }) => (
    <span className="inline-grid">
        {options.map((o) => (
            <span key={o} aria-hidden={o !== value} className={'col-start-1 row-start-1 whitespace-nowrap ' + (o === value ? '' : 'invisible')}>
                {o}
            </span>
        ))}
    </span>
);
