// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadBackupTickers, parseTickerInput } from '../backtest/prefs';
import { useI18n } from '../i18n';
import { Modal } from './Modal';

// ============================================================================
// CREATE BACKUP DIALOG - the tickers of the last backup are preselected (all data when
// nothing was chosen before). Enter or OK builds the zip and downloads it, Esc cancels.
// A progress bar with Cancel while the data is collected.
// ============================================================================

export const BackupDialog: React.FC<{
    /** how many tickers "all data" means for the provider in use, null while unknown */
    allCount: number | null;
    progress: { done: number; total: number; symbol: string } | null;
    error: string;
    /** `null` = all data */
    onCreate: (tickers: string[] | null) => void;
    /** cancels a run in progress, or closes the dialog when idle */
    onCancel: () => void;
}> = ({ allCount, progress, error, onCreate, onCancel }) => {
    const { t } = useI18n();
    const [text, setText] = useState(() => loadBackupTickers().join(' '));
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
    const parsed = useMemo(() => parseTickerInput(text), [text]);
    const busy = progress !== null;
    const canCreate = !busy && parsed.rejected.length === 0;
    const submit = () => { if (canCreate) onCreate(parsed.tickers.length ? parsed.tickers : null); };
    return (
        <Modal title={t('bt.backup.title')} onClose={onCancel} widthClass="max-w-md" closeLabel={t('bt.backup.cancel')}>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{t('bt.backup.help')}</p>
            <label className="block text-xs font-semibold">
                {t('bt.backup.tickers')}
                <input
                    ref={inputRef}
                    value={text}
                    disabled={busy}
                    onChange={(e) => setText(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
                    spellCheck={false}
                    autoCapitalize="characters"
                    data-backup-tickers
                    className="mt-1 w-full rounded-md border border-slate-300 bg-transparent px-2 py-1.5 font-mono text-sm font-bold uppercase outline-none focus:border-indigo-500 dark:border-slate-600"
                />
            </label>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{allCount !== null ? t('bt.backup.allHint', { n: allCount }) : t('bt.backup.allUnknown')}</p>
            {parsed.rejected.length > 0 && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{t('bt.backup.rejected', { list: parsed.rejected.join(', ') })}</p>}
            {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            {progress && (
                <div className="mt-3" data-backup-progress>
                    <div className="h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
                        <div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${progress.total ? Math.round((100 * progress.done) / progress.total) : 0}%` }} />
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">{t('bt.backup.progress', { done: progress.done, total: progress.total, symbol: progress.symbol })}</p>
                </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800">{t('bt.backup.cancel')}</button>
                <button type="button" onClick={submit} disabled={!canCreate} data-backup-ok className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-40">{t('bt.backup.ok')}</button>
            </div>
        </Modal>
    );
};
