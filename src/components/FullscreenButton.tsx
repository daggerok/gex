/// <reference lib="esnext" />
import * as React from 'react';
import { useI18n } from '../i18n';

/** Expand or compress icon button for a chart card (GEX and Chart tabs). */
export const FullscreenButton: React.FC<{ full: boolean; onToggle: () => void; className?: string }> = ({ full, onToggle, className = '' }) => {
    const { t } = useI18n();
    const label = t(full ? 'chart.fullscreen.exit' : 'chart.fullscreen.enter');
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-label={label}
            aria-pressed={full}
            title={label}
            data-fullscreen-button
            className={'grid h-6 w-6 shrink-0 select-none place-items-center rounded-md text-slate-500 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-slate-700/70 ' + className}
        >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {full
                    ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                    : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
            </svg>
        </button>
    );
};
