// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import type { ColorThemeId } from '../types';
import { Pill } from './TopBar';

/** Content views below the TopBar (plan section 2). Order is fixed. */
export type AppTab = 'desk' | 'gex' | 'chart';
export const APP_TABS: AppTab[] = ['desk', 'gex', 'chart'];

/**
 * Tab switcher rendered between <TopBar/> and the active view. Reuses the
 * header's Pill segmented control (same active fill per color palette) and
 * the DeskView content column (same max-width / gutters) so it lines up with
 * the controls row underneath.
 */
export const TabSwitcher: React.FC<{
    value: AppTab;
    onChange: (tab: AppTab) => void;
    colorTheme: ColorThemeId;
    /** Rendered in the SAME row as the tab pills, after them (main.tsx's
     *  shared expiration picker + Load button) - one horizontal bar:
     *  [Desk | GEX | Chart]  [expiration chips... All] [Load]. The row wraps
     *  (flex-wrap) so this drops to its own line on narrow viewports instead
     *  of squeezing/clipping next to the pills. Omit (or pass null/undefined)
     *  where it doesn't apply, e.g. the Chart tab. */
    endSlot?: React.ReactNode;
}> = ({ value, onChange, colorTheme, endSlot }) => {
    const { t } = useI18n();
    // Pill takes an explicit `dark` flag; follow the `.dark` class that
    // useThemeController toggles on <html> (same approach as TopBar).
    const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
    useEffect(() => {
        const root = document.documentElement;
        const sync = () => setDark(root.classList.contains('dark'));
        sync();
        const obs = new MutationObserver(sync);
        obs.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, []);
    const pillActive = colorTheme === 'fundamentals'
        ? 'bg-emerald-500 text-white shadow-sm'
        : 'bg-indigo-600 text-white shadow-sm';
    return (
        <nav aria-label={t('tabs.label')} className="mx-auto w-full px-4 pt-4 lg:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
                {/* size="md": the shared <Pill/> (TopBar.tsx) defaults to a
                    compact 28px-tall rendering sized for TopBar's own CACHE/
                    LIVE and language switches - noticeably SHORTER than the
                    Expirations row's own bordered form (px-3 py-1.5,
                    ExpirationChips/Load button at text-xs, 38px tall).
                    size="md" is an opt-in Pill variant (TopBar.tsx's own doc
                    comment) that widens Pill's OUTER wrapper padding so its
                    actual VISIBLE bordered box renders at 38px, matching the
                    Expirations form's own box exactly - not an invisible
                    `py-[…]` margin hack around an unchanged 28px Pill (an
                    earlier version of this fix did exactly that: it matched
                    the two rows' invisible bounding rects at 38px each, but
                    the actual bordered PILL shape inside stayed 28px tall,
                    floating in blank space - so the two rows still visibly
                    read as different heights despite measuring equal,
                    confirmed live via Playwright screenshot). `shrink-0`
                    still keeps this panel from being squeezed by `flex-wrap`
                    on the surrounding row. */}
                <div className="shrink-0">
                    <Pill
                        value={value}
                        options={APP_TABS.map((k) => ({ k, l: t('tabs.' + k) }))}
                        onChange={(k) => onChange(k as AppTab)}
                        dark={dark}
                        accentActive={pillActive}
                        size="md"
                    />
                </div>
                {endSlot}
            </div>
        </nav>
    );
};

/** Honest placeholder for a tab whose real view lands in a later phase. */
export const TabStub: React.FC<{ tab: Exclude<AppTab, 'desk'> }> = ({ tab }) => {
    const { t } = useI18n();
    return (
        <main className="mx-auto w-full px-4 py-4 lg:px-6">
            <div className="grid place-items-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-16 text-sm text-slate-400">
                {t('tabs.stub.' + tab)}
            </div>
        </main>
    );
};
