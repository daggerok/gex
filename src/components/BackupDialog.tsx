/// <reference lib="esnext" />
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadBackupChoice, parseTickerInput, type BackupChoice } from '../backtest/prefs';
import { useI18n } from '../i18n';
import { Modal } from './Modal';

// ============================================================================
// CREATE BACKUP DIALOG - the preset of required tickers is the default (the choice of the
// last backup is remembered). Enter or OK builds the zip and downloads it, Esc cancels.
// A progress bar with Cancel while the data is collected.
// ============================================================================

export const BackupDialog: React.FC<{
    /** how many tickers "all data" means for the provider in use, null while unknown */
    /** the ticker on screen, '' when none is loaded */
    currentTicker: string;
    /** the preset of required tickers (the fetcher's default list from api/options/index.json), [] while unknown */
    presetTickers: readonly string[];
    allCount: number | null;
    progress: { done: number; total: number; symbol: string } | null;
    error: string;
    onCreate: (choice: BackupChoice) => void;
    /** cancels a run in progress, or closes the dialog when idle */
    onCancel: () => void;
}> = ({ currentTicker, presetTickers, allCount, progress, error, onCreate, onCancel }) => {
    const { t } = useI18n();
    const [initial] = useState(() => loadBackupChoice());
    // the last choice was the current ticker but none is loaded now: fall back to the preset
    const [mode, setMode] = useState<BackupChoice['mode']>(initial.mode === 'current' && !currentTicker ? 'preset' : initial.mode);
    const [text, setText] = useState(() => (initial.mode === 'custom' ? initial.tickers.join(' ') : ''));
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => { if (mode === 'custom') { inputRef.current?.focus(); inputRef.current?.select(); } }, [mode]);
    const parsed = useMemo(() => parseTickerInput(text), [text]);
    const busy = progress !== null;
    const canCreate = !busy && (mode !== 'custom' || (parsed.rejected.length === 0 && parsed.tickers.length > 0)) && (mode !== 'preset' || presetTickers.length > 0);
    const submit = () => {
        if (!canCreate) return;
        onCreate(mode === 'custom' ? { mode, tickers: parsed.tickers } : { mode });
    };
    const row = 'flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs dark:border-slate-700';
    const radio = (m: BackupChoice['mode']) => (
        <input type="radio" name="backup-mode" checked={mode === m} disabled={busy} onChange={() => setMode(m)} className="mt-0.5" data-backup-mode={m} />
    );
    return (
        <Modal title={t('bt.backup.title')} onClose={onCancel} widthClass="max-w-md" closeLabel={t('bt.backup.cancel')}>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{t('bt.backup.help')}</p>
            <div className="space-y-2" onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); submit(); } }}>
                <label className={row + (presetTickers.length ? '' : ' opacity-50')}>
                    <input type="radio" name="backup-mode" checked={mode === 'preset'} disabled={busy || !presetTickers.length} onChange={() => setMode('preset')} className="mt-0.5" data-backup-mode="preset" />
                    <span>
                        <span className="font-semibold">{t('bt.backup.preset')}</span>
                        {presetTickers.length
                            ? <span className="block font-mono text-[11px] text-slate-500 dark:text-slate-400" data-backup-preset-list>{presetTickers.join(', ')}</span>
                            : <span className="block text-[11px] text-slate-500 dark:text-slate-400">{t('bt.backup.presetUnknown')}</span>}
                    </span>
                </label>
                <label className={row + (currentTicker ? '' : ' opacity-50')}>
                    <input type="radio" name="backup-mode" checked={mode === 'current'} disabled={busy || !currentTicker} onChange={() => setMode('current')} className="mt-0.5" data-backup-mode="current" />
                    <span>
                        <span className="font-semibold">{t('bt.backup.current')}{currentTicker ? `: ${currentTicker}` : ''}</span>
                        {!currentTicker && <span className="block text-[11px] text-slate-500 dark:text-slate-400">{t('bt.backup.currentNone')}</span>}
                    </span>
                </label>
                <label className={row}>
                    {radio('all')}
                    <span>
                        <span className="font-semibold">{t('bt.backup.all')}</span>
                        <span className="block text-[11px] text-slate-500 dark:text-slate-400">{allCount !== null ? t('bt.backup.allHint', { n: allCount }) : t('bt.backup.allUnknown')}</span>
                    </span>
                </label>
                <label className={row}>
                    {radio('custom')}
                    <span className="min-w-0 flex-1">
                        <span className="font-semibold">{t('bt.backup.custom')}</span>
                        <input
                            ref={inputRef}
                            value={text}
                            disabled={busy}
                            placeholder={t('bt.backup.tickers')}
                            onFocus={() => setMode('custom')}
                            onChange={(e) => { setText(e.target.value.toUpperCase()); setMode('custom'); }}
                            spellCheck={false}
                            autoCapitalize="characters"
                            data-backup-tickers
                            className="mt-1 w-full rounded-md border border-slate-300 bg-transparent px-2 py-1.5 font-mono text-sm font-bold uppercase outline-none focus:border-indigo-500 dark:border-slate-600"
                        />
                    </span>
                </label>
            </div>
            {mode === 'custom' && parsed.rejected.length > 0 && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{t('bt.backup.rejected', { list: parsed.rejected.join(', ') })}</p>}
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
