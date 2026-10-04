// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useRef, useState } from 'react';
import { LANG_FLAGS, LANGUAGES, useI18n, type Language } from '../i18n';
import { DEFAULT_COLOR_THEME } from '../settings-store';
import { accentOf } from '../theme';
import type { ColorThemeId } from '../types';

/**
 * Compact language switcher: shows a globe icon + current language code.
 * Clicking it toggles a small animated menu; Escape/click-away closes it.
 */
export const LanguageSwitch: React.FC<{ value: Language; onChange: (l: Language) => void; colorTheme?: ColorThemeId }> = ({ value, onChange, colorTheme = DEFAULT_COLOR_THEME }) => {
    const { t } = useI18n();
    const ax = accentOf(colorTheme);
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        const onPointer = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('mousedown', onPointer);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('mousedown', onPointer);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                title={t('topBar.language')}
                aria-label={t('topBar.language')}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={
                    'flex h-8 items-center gap-1 rounded-lg border px-1.5 transition-all duration-150 ' +
                    (open
                        ? ax.open
                        : 'border-slate-300 dark:border-slate-700 text-slate-500 hover:-translate-y-px hover:text-slate-800 dark:hover:text-slate-200')
                }
            >
                <span className="text-base leading-none" aria-hidden="true">{LANG_FLAGS[value]}</span>
                <span className="text-xs font-semibold uppercase">{value}</span>
            </button>
            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-10 z-50 w-36 origin-top-right animate-fade-in rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/10"
                >
                    {LANGUAGES.map((l) => (
                        <button
                            key={l}
                            type="button"
                            role="menuitem"
                            onClick={() => { onChange(l); setOpen(false); }}
                            className={
                                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-all duration-150 ' +
                                (l === value
                                    ? ax.menuActive
                                    : 'text-slate-700 dark:text-slate-200 ' + ax.menuHover)
                            }
                        >
                            <span className="text-base leading-none" aria-hidden="true">{LANG_FLAGS[l]}</span>
                            <span>{t(`language.${l}`)}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
