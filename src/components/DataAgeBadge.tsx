/// <reference lib="esnext" />
import * as React from 'react';
import { useI18n } from '../i18n';
import type { DataAge } from '../utils';

/**
 * Amber "Data of <day>, N d old" badge (GEX-H4): shown in the shared expirations panel, so every tab sees it, only when
 * the loaded cache data belongs to an earlier trading day than the current one and no backtest is open.
 */
export const DataAgeBadge: React.FC<{ age: DataAge | null }> = ({ age }) => {
    const { t: tr } = useI18n();
    if (!age?.stale) return null;
    return (
        <span data-data-age className="shrink-0 whitespace-nowrap rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {tr('data.stale', { day: age.day, days: String(age.daysOld) })}
        </span>
    );
};
