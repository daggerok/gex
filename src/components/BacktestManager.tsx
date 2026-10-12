// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useMemo, useRef, useState } from 'react';
import type { HistoryEntry } from '../backtest/entries';
import { useI18n } from '../i18n';
import { Modal } from './Modal';

// ============================================================================
// BACKTEST DATA MANAGER - the archived days the app holds in this browser: download one or
// several (several as ONE zip), remove one, some, all, or everything older than a date.
// Only what the browser holds can be removed here; the site's own files are cleaned up by
// deleting them in the repository (spec-backtest.md).
// ============================================================================

const sizeText = (bytes: number): string => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const sourceKey = { site: 'bt.sourceSite', local: 'bt.sourceLocal', both: 'bt.sourceBoth' } as const;

export const BacktestManager: React.FC<{
    entries: HistoryEntry[];
    onClose: () => void;
    onDownload: (ids: string[]) => void;
    onRemove: (ids: string[]) => void;
    onRemoveOlderThan: (date: string) => void;
    onClearAll: () => void;
    onImport: (files: File[]) => void;
}> = ({ entries, onClose, onDownload, onRemove, onRemoveOlderThan, onClearAll, onImport }) => {
    const { t } = useI18n();
    // what can be removed or downloaded from here: the days held in the browser (the site ones can still be downloaded, they are fetched)
    const held = useMemo(() => entries.filter((e) => e.size !== null), [entries]);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [olderThan, setOlderThan] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);
    const toggle = (id: string) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    const ids = entries.map((e) => e.id).filter((id) => picked.has(id));
    const heldIds = ids.filter((id) => held.some((h) => h.id === id));
    const all = entries.length > 0 && ids.length === entries.length;
    const btn = 'rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold hover:bg-slate-100 disabled:cursor-default disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800';
    const danger = 'rounded-md border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-default disabled:opacity-40 dark:border-red-500/50 dark:text-red-300 dark:hover:bg-red-500/10';
    return (
        <Modal title={t('bt.manager.title')} onClose={onClose} widthClass="max-w-2xl" closeLabel={t('bt.manager.close')}>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{t('bt.manager.help')}</p>
            {entries.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('bt.manager.empty')}</p>
            ) : (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700" data-backtest-list>
                    <label className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800/50">
                        <input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(entries.map((e) => e.id)))} />
                        {t('bt.manager.selectAll')}
                    </label>
                    <div className="max-h-72 overflow-auto">
                        {entries.map((e) => (
                            <label key={e.id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-1.5 text-xs last:border-0 dark:border-slate-800">
                                <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} data-backtest-row={e.id} />
                                <span className="w-36 font-mono font-semibold">{e.label}</span>
                                <span className="flex-1 text-slate-500 dark:text-slate-400">{t('bt.tickersCount', { n: e.tickers.length })}</span>
                                <span className="rounded bg-slate-200 px-1 text-[10px] dark:bg-slate-700">{t(sourceKey[e.source])}</span>
                                <span className="w-16 text-right text-slate-500 dark:text-slate-400">{e.size !== null ? sizeText(e.size) : ''}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className={btn} onClick={() => fileRef.current?.click()}>{t('bt.import')}</button>
                <button type="button" className={btn} disabled={ids.length === 0} onClick={() => onDownload(ids)} data-backtest-download>
                    {ids.length > 1 ? t('bt.manager.downloadMany', { n: ids.length }) : t('bt.manager.downloadOne')}
                </button>
                <button
                    type="button"
                    className={danger}
                    disabled={heldIds.length === 0}
                    onClick={() => { if (window.confirm(t('bt.manager.confirmSelected', { n: heldIds.length }))) { onRemove(heldIds); setPicked(new Set()); } }}
                >
                    {t('bt.manager.removeSelected')}
                </button>
                <button type="button" className={danger} disabled={held.length === 0} onClick={() => { if (window.confirm(t('bt.manager.confirmAll'))) { onClearAll(); setPicked(new Set()); } }}>
                    {t('bt.manager.removeAll')}
                </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400">{t('bt.manager.olderThan')}</span>
                <input type="date" value={olderThan} onChange={(e) => setOlderThan(e.target.value)} className="rounded-md border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-600" data-backtest-older />
                <button type="button" className={danger} disabled={!olderThan || held.length === 0} onClick={() => {
                    // the held days older than the date: imported ones cannot be fetched again, so ask first
                    const n = held.filter((h) => h.id.slice(0, 10) < olderThan).length;
                    if (n > 0 && !window.confirm(t('bt.manager.confirmOlder', { n, date: olderThan }))) return;
                    onRemoveOlderThan(olderThan);
                    setOlderThan('');
                }}>{t('bt.manager.removeOlder')}</button>
            </div>
            <input ref={fileRef} type="file" accept=".zip,application/zip" multiple hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) onImport(files); }} />
        </Modal>
    );
};
