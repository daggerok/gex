// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { DEFAULT_COLOR_THEME } from '../settings-store';
import { accentOf } from '../theme';
import type { ColorThemeId, ThemeMode } from '../types';
import { Icon } from './Icon';

/**
 * Compact theme picker: shows only the current theme icon. Clicking it toggles a
 * small animated menu with the other themes; Escape/click-away closes it.
 */

export const ThemeSwitch: React.FC<{ value: ThemeMode; onChange: (theme: ThemeMode) => void; colorTheme?: ColorThemeId }> = ({ value, onChange, colorTheme = DEFAULT_COLOR_THEME }) => {
    const { t } = useI18n();
    const ax = accentOf(colorTheme);
    const options: { id: ThemeMode; icon: React.FC<{ className?: string }>; title: string }[] = [
        { id: 'light', icon: Icon.Sun, title: t('theme.light') },
        { id: 'system', icon: Icon.Monitor, title: t('theme.system') },
        { id: 'dark', icon: Icon.Moon, title: t('theme.dark') },
    ];
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const current = options.find((o) => o.id === value) ?? options[1];
    const CurrentIcon = current.icon;
    const choices = options.filter((o) => o.id !== value);

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
                title={`${current.title} theme`}
                aria-label={`${current.title} theme`}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={
                    'flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-150 ' +
                    (open
                        ? ax.open
                        : 'border-slate-300 dark:border-slate-700 text-slate-500 hover:-translate-y-px hover:text-slate-800 dark:hover:text-slate-200')
                }
            >
                <CurrentIcon className="h-4 w-4 transition-transform duration-150" />
            </button>
            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-10 z-50 w-36 origin-top-right animate-fade-in rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/10"
                >
                    {choices.map((o) => {
                        const IconCmp = o.icon;
                        return (
                            <button
                                key={o.id}
                                type="button"
                                role="menuitem"
                                onClick={() => { onChange(o.id); setOpen(false); }}
                                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 transition-all duration-150 dark:text-slate-200 ${ax.menuHover}`}
                            >
                                <IconCmp className="h-4 w-4" />
                                <span>{o.title}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
