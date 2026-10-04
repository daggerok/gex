// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { accentOf } from '../theme';
import type { ColorThemeId } from '../types';

/**
 * Compact color-palette switcher (Emerald Ledger / Indigo Desk).
 * Shared with fundamentals so both apps can preview each other's skin.
 */
export const ColorThemeSwitch: React.FC<{ value: ColorThemeId; onChange: (c: ColorThemeId) => void }> = ({ value, onChange }) => {
    const { t } = useI18n();
    const ax = accentOf(value);
    const options: { id: ColorThemeId; swatch: string; title: string }[] = [
        { id: 'gex', swatch: 'bg-indigo-500', title: t('colorTheme.gex') },
        { id: 'fundamentals', swatch: 'bg-emerald-500', title: t('colorTheme.fundamentals') },
    ];
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const current = options.find((o) => o.id === value) ?? options[0];
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
                title={current.title}
                aria-label={current.title}
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
                <span className={`h-3.5 w-3.5 rounded-full ${current.swatch} ring-2 ring-white dark:ring-slate-900`} />
            </button>
            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-10 z-50 w-44 origin-top-right animate-fade-in rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/10"
                >
                    {choices.map((o) => (
                        <button
                            key={o.id}
                            type="button"
                            role="menuitem"
                            onClick={() => { onChange(o.id); setOpen(false); }}
                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 transition-all duration-150 dark:text-slate-200 ${ax.menuHover}`}
                        >
                            <span className={`h-3.5 w-3.5 rounded-full ${o.swatch}`} />
                            <span>{o.title}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
