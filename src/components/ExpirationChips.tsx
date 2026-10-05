// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React from 'react';
import { useI18n } from '../i18n';
import { accentOf } from '../theme';
import type { ColorThemeId } from '../types';

/**
 * Multi-select expiration chips + "All"/"None" toggle. Rendered ONCE in a
 * shared panel (main.tsx, via TabSwitcher's `endSlot`, in the same row as the
 * Desk/GEX/Chart tab pills) alongside the Load button, visible on Desk and
 * GEX alike - no longer duplicated per-view (see main.tsx changelog). Renders
 * a fragment (label, chip strip, toggle) so the caller supplies the wrapper.
 *
 * Overflow fix: the chip strip caps itself at `max-w-[70vw]` and scrolls
 * internally (`overflow-x-auto`) - that part was never the bug. The bug was
 * the CALLER's row not wrapping: a plain `flex` row has no upper bound of its
 * own, so at narrow (mobile) widths the fixed-width "All"/"None" toggle AND
 * the Load button (a sibling in the caller's row) got pushed past the right
 * edge of the viewport - genuinely clipped, not just scrolled - because nothing
 * in that row could wrap. Confirmed live via Playwright at 320-414px widths
 * before this fix (Load button's bounding rect exceeded window.innerWidth and
 * document.documentElement.scrollWidth grew past the viewport). Callers now
 * add `flex-wrap` to their own row so the toggle/Load button drop to a second
 * line instead of sliding off-screen when space is tight.
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
            {/* Was max-w-[46vw]: that cap was sized to share a row with Desk's
                ticker-input/provider-dropdown row. Now this strip lives alone
                in the shared panel (main.tsx), so it can afford more room;
                widened to 70vw. Still capped (not unbounded) so the "All"/
                "None" toggle in a wide chain never has to fight for space on
                the same line - the caller's row additionally wraps (flex-wrap)
                as a second line of defense at widths where even 70vw plus the
                toggle/Load button don't fit. */}
            <div className="themed-scroll flex max-w-[70vw] items-center gap-1 overflow-x-auto">
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
