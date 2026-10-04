// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React from 'react';
import { useI18n } from '../i18n';
import type { DataProvider } from '../types';

/** Small pill that communicates how much setup a provider needs. */
export const SetupBadge: React.FC<{ provider: DataProvider; hasKey: boolean }> = ({ provider, hasKey }) => {
    const { t } = useI18n();
    let text = '';
    let cls = '';
    if (provider.setup === 'none') { text = t('setupBadge.noSetup'); cls = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'; }
    else if (provider.setup === 'key') { text = hasKey ? t('setupBadge.keySet') : t('setupBadge.freeKey'); cls = hasKey ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400'; }
    else { text = t('setupBadge.needsProxy'); cls = 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'; }
    return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{text}</span>;
};
