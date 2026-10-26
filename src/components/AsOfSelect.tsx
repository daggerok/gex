/// <reference lib="esnext" />
import * as React from 'react';
import { Tip } from './Tip';
import { useEffect, useRef, useState } from 'react';
import type { HistoryEntry } from '../backtest/entries';
import { useI18n } from '../i18n';

// ============================================================================
// "AS OF" SELECTOR - one control in the top bar for all three tabs
// (agentic-workspace docs/repos/gex/spec-backtest.md). Grey = informational, not a
// backtest: "As of today" while a live provider is reachable, otherwise "As of <date of
// the latest cache file>". Amber = backtest mode on an archived snapshot. The menu lists
// the snapshots (site and local), and has Import, Create backup and the data manager.
// ============================================================================

const sourceKey = { site: 'bt.sourceSite', local: 'bt.sourceLocal', both: 'bt.sourceBoth' } as const;

export const AsOfSelect: React.FC<{
    entries: HistoryEntry[];
    /** id of the snapshot shown, null = live (not a backtest) */
    activeId: string | null;
    activeLabel: string | null;
    /** the grey text: "As of today" or "As of <date>" */
    liveText: string;
    loading: boolean;
    onSelect: (id: string | null) => void;
    onImport: (files: File[]) => void;
    onCreateBackup: () => void;
    onManage: () => void;
}> = ({ entries, activeId, activeLabel, liveText, loading, onSelect, onImport, onCreateBackup, onManage }) => {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const active = activeId !== null;
    const text = active ? t('bt.asOfLatest', { date: activeLabel ?? activeId }) : liveText;
    const item = 'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800';
    return (
        <div ref={wrapRef} className="relative hidden flex-shrink-0 sm:block" data-asof-select={active ? 'backtest' : 'live'}>
            <Tip text={t('bt.asOfTitle')} wrapperClassName="inline-flex">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={open}
                data-asof-trigger
                className={`box-border flex max-w-[11rem] items-center gap-1 rounded-lg border px-2 py-1.5 text-sm font-bold outline-none transition-colors ${
                    active
                        ? 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-500/60 dark:bg-amber-500/20 dark:text-amber-200'
                        : 'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400'
                }`}
            >
                <span className="truncate">{loading ? '...' : text}</span>
                <span aria-hidden className="text-[10px]">▾</span>
            </button>
            </Tip>
            {open && (
                <div role="listbox" className="absolute right-0 top-full z-[60] mt-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                    <button type="button" role="option" aria-selected={!active} onClick={() => { setOpen(false); onSelect(null); }} className={item}>
                        <span className="font-semibold">{!active ? '✓ ' : ''}{t('bt.live')}</span>
                        <span className="text-slate-500 dark:text-slate-400">{t('bt.liveHint')}</span>
                    </button>
                    <div className="max-h-64 overflow-auto border-y border-slate-200 dark:border-slate-700">
                        {entries.length === 0 && <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{t('bt.noSnapshots')}</div>}
                        {entries.map((e) => (
                            <button key={e.id} type="button" role="option" aria-selected={e.id === activeId} data-asof-option={e.id} onClick={() => { setOpen(false); onSelect(e.id); }} className={item}>
                                <span className="font-mono font-semibold">{e.id === activeId ? '✓ ' : ''}{t('bt.asOfLatest', { date: e.label })}</span>
                                <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                    <span>{t('bt.tickersCount', { n: e.tickers.length })}</span>
                                    {e.source !== 'site' && <span className="rounded bg-slate-200 px-1 text-[10px] dark:bg-slate-700">{t(sourceKey[e.source])}</span>}
                                </span>
                            </button>
                        ))}
                    </div>
                    <button type="button" onClick={() => { setOpen(false); fileRef.current?.click(); }} className={item}>{t('bt.import')}</button>
                    <button type="button" onClick={() => { setOpen(false); onCreateBackup(); }} className={item}>{t('bt.createBackup')}</button>
                    <button type="button" onClick={() => { setOpen(false); onManage(); }} className={item}>{t('bt.manage')}</button>
                </div>
            )}
            <input
                ref={fileRef}
                type="file"
                accept=".zip,application/zip"
                multiple
                hidden
                data-asof-import
                onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) onImport(files); }}
            />
        </div>
    );
};

/**
 * The same controls as a block of the settings menu, on every screen width (owner 2026-10-26: the menu holds everything the top
 * bar has; the selector in the top bar is hidden below `sm`):
 * a native list of the snapshots and the three actions.
 */
export const AsOfMenuSection: React.FC<{
    entries: HistoryEntry[];
    activeId: string | null;
    liveText: string;
    onSelect: (id: string | null) => void;
    onImport: (files: File[]) => void;
    onCreateBackup: () => void;
    onManage: () => void;
}> = ({ entries, activeId, liveText, onSelect, onImport, onCreateBackup, onManage }) => {
    const { t } = useI18n();
    const fileRef = useRef<HTMLInputElement>(null);
    const btn = 'rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800';
    return (
        <div className="space-y-2 border-t border-slate-200 pt-2 dark:border-slate-700" data-asof-mobile>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('bt.mobileTitle')}</div>
            <select
                value={activeId ?? ''}
                onChange={(e) => onSelect(e.target.value || null)}
                aria-label={t('bt.asOfTitle')}
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
                <option value="">{t('bt.live')} ({liveText})</option>
                {entries.map((e) => <option key={e.id} value={e.id}>{t('bt.asOfLatest', { date: e.label })}</option>)}
            </select>
            <div className="grid grid-cols-3 gap-2">
                <button type="button" className={btn} onClick={() => fileRef.current?.click()}>{t('bt.import')}</button>
                <button type="button" className={btn} onClick={onCreateBackup}>{t('bt.createBackup')}</button>
                <button type="button" className={btn} onClick={onManage}>{t('bt.manage')}</button>
            </div>
            <input ref={fileRef} type="file" accept=".zip,application/zip" multiple hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) onImport(files); }} />
        </div>
    );
};
