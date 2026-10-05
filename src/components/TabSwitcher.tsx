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
     *  [Desk | GEX | Chart]  [expiration chips... All] [Load]. Omit (or pass
     *  null/undefined) where it doesn't apply, e.g. the Chart tab. */
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
        <nav aria-label={t('tabs.label')} className="mx-auto w-full max-w-3xl px-4 pt-4 lg:max-w-none lg:px-8 2xl:px-16">
            <div className="flex items-center justify-between gap-2">
                <Pill
                    value={value}
                    options={APP_TABS.map((k) => ({ k, l: t('tabs.' + k) }))}
                    onChange={(k) => onChange(k as AppTab)}
                    dark={dark}
                    accentActive={pillActive}
                />
                {endSlot}
            </div>
        </nav>
    );
};

/** Honest placeholder for a tab whose real view lands in a later phase. */
export const TabStub: React.FC<{ tab: Exclude<AppTab, 'desk'> }> = ({ tab }) => {
    const { t } = useI18n();
    return (
        <main className="mx-auto w-full max-w-3xl px-4 py-4 lg:max-w-none lg:px-8 2xl:px-16">
            <div className="grid place-items-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-16 text-sm text-slate-400">
                {t('tabs.stub.' + tab)}
            </div>
        </main>
    );
};
