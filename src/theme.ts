// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import { useEffect } from 'react';
import { DEFAULT_COLOR_THEME } from './settings-store';
import type { ColorThemeId, ThemeMode } from './types';
import { dbg } from './utils';

// ============================================================================
// THEME CONTROLLER (hook)
// ============================================================================

/**
 * Applies the chosen theme by toggling the `.dark` class on <html>.
 * For 'system', it subscribes to the OS color-scheme media query and updates
 * live if the user flips their system theme while the app is open.
 */
export function useThemeController(theme: ThemeMode, colorTheme: ColorThemeId = DEFAULT_COLOR_THEME): void {
    useEffect(() => {
        const root = document.documentElement;
        const mql = window.matchMedia('(prefers-color-scheme: dark)');
        const apply = () => {
            const isDark = theme === 'dark' || (theme === 'system' && mql.matches);
            root.classList.toggle('dark', isDark);
            root.dataset.palette = colorTheme;
            dbg('theme applied', { theme, colorTheme, isDark });
        };
        apply();
        if (theme === 'system') {
            mql.addEventListener('change', apply);
            return () => mql.removeEventListener('change', apply);
        }
        return undefined;
    }, [theme, colorTheme]);
}

/** Resolve accent Tailwind classes for the selected shared color palette. */
export function accentOf(colorTheme: ColorThemeId) {
    const isFund = colorTheme === 'fundamentals';
    return {
        brand: isFund ? 'bg-emerald-600' : 'bg-indigo-600',
        brandSoft: isFund
            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
            : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400',
        btn: isFund ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700',
        focusRing: isFund ? 'focus:ring-emerald-500' : 'focus:ring-indigo-500',
        focusRingOffset: isFund
            ? 'focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1 dark:focus:ring-offset-slate-900'
            : 'focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 dark:focus:ring-offset-slate-900',
        open: isFund
            ? 'scale-105 border-emerald-500 bg-emerald-50 text-emerald-600 shadow-sm dark:bg-emerald-950/40 dark:text-emerald-400'
            : 'scale-105 border-indigo-500 bg-indigo-50 text-indigo-600 shadow-sm dark:bg-indigo-950/40 dark:text-indigo-400',
        menuHover: isFund
            ? 'hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300'
            : 'hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300',
        menuActive: isFund
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
        link: isFund
            ? 'text-emerald-600 hover:underline dark:text-emerald-400'
            : 'text-indigo-600 hover:underline dark:text-indigo-400',
        borderHover: isFund
            ? 'hover:border-emerald-300 dark:hover:border-emerald-700'
            : 'hover:border-indigo-300 dark:hover:border-indigo-700',
        accentInput: isFund ? 'accent-emerald-600' : 'accent-indigo-600',
        openBorder: isFund
            ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
            : 'border-indigo-500 text-indigo-600 dark:text-indigo-400',
        chipActive: isFund
            ? 'border-emerald-500 bg-emerald-600 text-white shadow-sm'
            : 'border-indigo-500 bg-indigo-600 text-white shadow-sm',
        chipIdle: 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 ' +
            (isFund ? 'hover:border-emerald-400 hover:-translate-y-px' : 'hover:border-indigo-400 hover:-translate-y-px'),
        greek: isFund
            ? 'text-emerald-600 dark:text-emerald-300'
            : 'text-indigo-600 dark:text-indigo-300',
        mid: isFund
            ? 'font-medium text-teal-600 dark:text-teal-400'
            : 'font-medium text-emerald-600 dark:text-emerald-400',
        pulse: isFund ? 'text-emerald-500' : 'text-indigo-500',
        headerBg: isFund
            ? 'bg-white/80 dark:bg-slate-950/80'
            : 'bg-white/80 dark:bg-slate-900/80',
        suggestHover: isFund
            ? 'hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
            : 'hover:bg-indigo-50 dark:hover:bg-indigo-950/40',
        suggestActive: isFund
            ? 'bg-emerald-50 dark:bg-emerald-950/40'
            : 'bg-indigo-50 dark:bg-indigo-950/40',
        atm: isFund
            ? 'text-emerald-700 dark:text-emerald-300'
            : 'text-indigo-700 dark:text-indigo-300',
        expHover: isFund
            ? 'hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400'
            : 'hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400',
    } as const;
}
