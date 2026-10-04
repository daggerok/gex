// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React from 'react';
import { useI18n } from '../i18n';
import { accentOf } from '../theme';
import type { ColorThemeId } from '../types';

/**
 * Multi-select expiration chips + "All"/"None" toggle, shared by Desk (Tab 1)
 * and GEX (Tab 2). Renders a fragment (label, chip strip, toggle) so each
 * caller supplies its own wrapper: Desk wraps it in the Load <form>, GEX in a
 * plain box with the same styling. Extracted verbatim from DeskView.
 */
export const ExpirationChips: React.FC<{
    expirations: string[];
    selected: string[];
    onToggle: (exp: string) => void;
    /** Called with every expiration ("All") or an empty list ("None"). */
    onSetAll: (exps: string[]) => void;
    colorTheme: ColorThemeId;
}> = ({ expirations, selected, onToggle, onSetAll, colorTheme }) => {
    const { t: tr } = useI18n();
    const ax = accentOf(colorTheme);
    const allOn = selected.length === expirations.length;
    return (
        <>
            <span className="text-xs text-slate-400">{tr('controls.expirations')}</span>
            <div className="themed-scroll flex max-w-[46vw] items-center gap-1 overflow-x-auto">
                {expirations.map((exp) => {
                    const on = selected.includes(exp);
                    return (
                        <button
                            key={exp}
                            type="button"
                            onClick={() => onToggle(exp)}
                            aria-pressed={on}
                            className={
                                'shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ' +
                                (on
                                    ? ax.chipActive
                                    : ax.chipIdle)
                            }
                        >
                            {exp}
                        </button>
                    );
                })}
            </div>
            <button
                type="button"
                onClick={() => onSetAll(allOn ? [] : [...expirations])}
                className="shrink-0 rounded-md border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                title={tr('controls.all') + ' / ' + tr('controls.none')}
            >
                {allOn ? tr('controls.none') : tr('controls.all')}
            </button>
        </>
    );
};
