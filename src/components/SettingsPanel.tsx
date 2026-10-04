// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useMemo, useState } from 'react';
import { providerDescription, useI18n } from '../i18n';
import { LIVE_PROVIDERS, PROVIDERS, PROXY_PRESETS } from '../providers';
import { cacheStats, fmtBytes, subscribeCache } from '../settings-store';
import { accentOf } from '../theme';
import type { DataProvider, Settings } from '../types';
import { ColorThemeSwitch } from './ColorThemeSwitch';
import { Icon } from './Icon';
import { LanguageSwitch } from './LanguageSwitch';
import { ThemeSwitch } from './ThemeSwitch';

// ============================================================================
// SETTINGS PANEL (popover opened by the gear button)
// ============================================================================

export const SettingsPanel: React.FC<{
    settings: Settings;
    provider: DataProvider;
    onChange: (patch: Partial<Settings>) => void;
    onSetToken: (providerId: string, token: string) => void;
    onSetSecret: (providerId: string, secret: string) => void;
    /** Cache actions (return the fresh stats to refresh the panel). */
    onClearData: () => void;
    onClearSettings: () => void;
    onClearAll: () => void;
    onClose: () => void;
    /** When true, render body only (no absolute popover chrome) — used inside fundamentals-style settings card. */
    embedded?: boolean;
}> = ({ settings, provider, onChange, onSetToken, onSetSecret, onClearData, onClearSettings, onClearAll, onClose, embedded = false }) => {
    const { t, lang } = useI18n();
    const ax = accentOf(settings.colorTheme);
    const currentToken = settings.tokens[provider.id] || '';
    const currentSecret = settings.secrets[provider.id] || '';
    // Cache stats — recompute on any cache mutation (LIVE, no manual refresh):
    // subscribe to the cache pub/sub so fetching or clearing updates the numbers
    // immediately while the panel is open.
    const [statsNonce, setStatsNonce] = useState(0);
    useEffect(() => subscribeCache(() => setStatsNonce((n) => n + 1)), []);
    const stats = useMemo(() => cacheStats(), [statsNonce]);
    const pct = stats.maxBytes > 0 ? Math.min(100, Math.round((stats.bytes / stats.maxBytes) * 100)) : 0;
    const fmtTs = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : '—');
    // Two-step confirm for destructive actions (armed button id).
    const [armed, setArmed] = useState<string>('');
    const bump = () => setStatsNonce((n) => n + 1);
    return (
        <>
            {/* Click-away backdrop (standalone popover only) */}
            {!embedded && <div className="fixed inset-0 z-40" onClick={onClose} />}
            <div
                className={embedded
            ? "themed-scroll max-h-[50vh] overflow-auto space-y-3"
            : "themed-scroll absolute right-0 top-11 z-50 max-h-[80vh] w-80 origin-top-right animate-fade-in overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-xl"}
                role={embedded ? undefined : 'dialog'}
                aria-label={embedded ? undefined : t('settings.title')}
            >
                {!embedded && (
                  <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{t('settings.title')}</h2>
                )}

                <p className="mb-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {providerDescription(provider.id, lang)}
                </p>

                {/* API key (and optional secret) — for token-capable providers. */}
                {provider.supportsToken && (
                    <div className="mb-3">
                        <div className="mb-1 flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                {provider.keyLabel || t('settings.apiKey')}
                            </span>
                            {provider.keyUrl && (
                                <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer"
                                   className={`inline-flex items-center gap-1 text-[11px] font-semibold ${ax.link}`}>
                                    {t('settings.getKey')} <Icon.External className="h-3 w-3" />
                                </a>
                            )}
                        </div>
                        <input
                            type="password"
                            value={currentToken}
                            placeholder={provider.keyLabel || t('settings.apiKey')}
                            onChange={(e) => onSetToken(provider.id, e.target.value.trim())}
                            className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                        />
                        {/* Secret field — only for KEY+SECRET providers (e.g. Alpaca). */}
                        {provider.supportsSecret && (
                            <>
                                <span className="mb-1 mt-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
                                    {provider.secretLabel || t('settings.apiSecret')}
                                </span>
                                <input
                                    type="password"
                                    value={currentSecret}
                                    placeholder={provider.secretLabel || t('settings.apiSecret')}
                                    onChange={(e) => onSetSecret(provider.id, e.target.value.trim())}
                                    className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                                />
                            </>
                        )}
                        <span className="mt-1 block text-[11px] text-slate-400">
                            {provider.keyHint || t('settings.keyHint')}
                        </span>
                    </div>
                )}

                {/* Proxy base URL — for request-handling proxies (Yahoo/worker). */}
                {provider.needsProxyBase && (
                    <label className="mb-3 block">
                        <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.proxyBase')}</span>
                        <input
                            type="text"
                            value={settings.proxyBase}
                            placeholder={t('settings.proxyBasePlaceholder')}
                            onChange={(e) => onChange({ proxyBase: e.target.value.trim() })}
                            className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                        />
                        <span className="mt-1 block text-[11px] text-slate-400">
                            {t('settings.proxyBaseHint')}
                        </span>
                    </label>
                )}

                {/* CORS proxy — only for providers that need it (CBOE). */}
                {provider.needsProxy && (
                    <>
                        <label className="mb-2 block">
                            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.corsProxy')}</span>
                            <select
                                value={settings.proxyTemplate}
                                onChange={(e) => onChange({ proxyTemplate: e.target.value })}
                                className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                            >
                                {PROXY_PRESETS.map((p) => (
                                    <option key={p.template} value={p.template}>{p.label}</option>
                                ))}
                            </select>
                            <span className="mt-1 block text-[11px] text-slate-400">
                                {t('settings.corsProxyHint')}
                            </span>
                        </label>
                        {settings.proxyTemplate.includes('{worker}') && (
                            <label className="mb-1 block">
                                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.workerUrl')}</span>
                                <input
                                    type="text"
                                    value={settings.workerUrl}
                                    placeholder={t('settings.workerUrlPlaceholder')}
                                    onChange={(e) => onChange({ workerUrl: e.target.value.trim() })}
                                    className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                                />
                            </label>
                        )}
                    </>
                )}

                {/* ---- Desk columns: per-side, per-column toggles -------- */}
                <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-3">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('settings.deskColumns')}</h3>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                        {(['calls', 'puts'] as const).map((side) => (
                            <div key={side}>
                                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                                    {t(`settings.deskColumns.${side}`)}
                                </div>
                                <div className="space-y-1">
                                    {([
                                        { id: 'openInterest', label: t('settings.deskColumns.openInterest') },
                                        { id: 'volume', label: t('settings.deskColumns.volume') },
                                        { id: 'iv', label: t('settings.deskColumns.iv') },
                                        { id: 'delta', label: t('settings.deskColumns.delta') },
                                        { id: 'gamma', label: t('settings.deskColumns.gamma') },
                                        { id: 'theta', label: t('settings.deskColumns.theta') },
                                        { id: 'vega', label: t('settings.deskColumns.vega') },
                                        { id: 'rho', label: t('settings.deskColumns.rho') },
                                        // higher-order greeks
                                        { id: 'lambda', label: t('settings.deskColumns.lambda') },
                                        { id: 'vanna', label: t('settings.deskColumns.vanna') },
                                        { id: 'vomma', label: t('settings.deskColumns.vomma') },
                                        { id: 'charm', label: t('settings.deskColumns.charm') },
                                        { id: 'speed', label: t('settings.deskColumns.speed') },
                                        { id: 'zomma', label: t('settings.deskColumns.zomma') },
                                        { id: 'color', label: t('settings.deskColumns.color') },
                                    ] as const).map((c) => (
                                        <label key={c.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                                            <input
                                                type="checkbox"
                                                checked={(settings.deskColumns as any)[side][c.id]}
                                                onChange={(e) => onChange({ deskColumns: { ...settings.deskColumns, [side]: { ...(settings.deskColumns as any)[side], [c.id]: e.target.checked } } })}
                                                className={`h-3.5 w-3.5 ${ax.accentInput}`}
                                            />
                                            <span>{c.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">{t('settings.deskColumns.note')}</p>
                </div>

                {/* ---- Cache: stats + clear actions --------------------------- */}
                <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-3">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('settings.cache')}</h3>

                    {/* Stats */}
                    <div className="mb-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <div className="flex items-center justify-between">
                            <span>{t('settings.cache.records')}</span>
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{stats.entries}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>{t('settings.cache.dataSize')}</span>
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{fmtBytes(stats.bytes)} / {fmtBytes(stats.maxBytes)} ({pct}%)</span>
                        </div>
                        {/* Usage bar */}
                        <div className="my-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                            <div className={'h-full rounded-full ' + (pct > 85 ? 'bg-rose-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex items-center justify-between">
                            <span>{t('settings.cache.settingsSize')}</span>
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{fmtBytes(stats.settingsBytes)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>{t('settings.cache.oldest')}</span>
                            <span className="font-medium text-slate-600 dark:text-slate-300">{fmtTs(stats.oldest)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>{t('settings.cache.newest')}</span>
                            <span className="font-medium text-slate-600 dark:text-slate-300">{fmtTs(stats.newest)}</span>
                        </div>
                    </div>

                    {/* Clear actions — each needs a second click to confirm. */}
                    {([
                        { id: 'data', label: t('settings.cache.clearData'), hint: t('settings.cache.clearDataHint'), run: onClearData },
                        { id: 'settings', label: t('settings.cache.clearSettings'), hint: t('settings.cache.clearSettingsHint'), run: onClearSettings },
                        { id: 'all', label: t('settings.cache.clearAll'), hint: t('settings.cache.clearAllHint'), run: onClearAll },
                    ] as const).map((a) => (
                        <div key={a.id} className="mb-1.5 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{a.label}</div>
                                <div className="truncate text-[10px] text-slate-400">{a.hint}</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (armed === a.id) { a.run(); setArmed(''); bump(); }
                                    else { setArmed(a.id); }
                                }}
                                onBlur={() => setArmed((cur) => (cur === a.id ? '' : cur))}
                                className={
                                    'shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ' +
                                    (armed === a.id
                                        ? 'border-rose-500 bg-rose-600 text-white hover:bg-rose-700'
                                        : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-rose-400 hover:text-rose-600 dark:hover:text-rose-400')
                                }
                            >
                                {armed === a.id ? t('settings.cache.confirm') : a.label}
                            </button>
                        </div>
                    ))}
                    {armed && <p className="mt-1 text-[10px] text-rose-500">{t('settings.cache.confirmHelp')}</p>}
                </div>

                {!embedded && (<>
                {/* ---- Heading fast-access controls (must live at the end of the settings menu) ---- */}
                <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-3 space-y-3">
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('topBar.settings')}</h3>
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.provider')}</span>
                        <select
                            value={settings.providerId}
                            onChange={(e) => onChange({ providerId: e.target.value })}
                            disabled={settings.providerId === 'static'}
                            className={
                                'w-full rounded-lg border px-2 py-1.5 text-sm outline-none focus:ring-2 ' +
                                (settings.providerId === 'static'
                                    ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-600'
                                    : `border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 ${ax.focusRing}`)
                            }
                        >
                            {(settings.providerId === 'static' ? PROVIDERS.filter((p) => p.id === 'static') : LIVE_PROVIDERS).map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
                        </select>
                        <span className="mt-1 block text-[11px] text-slate-400">{t('settings.providerHint')}</span>
                    </label>
                    <div>
                        <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.theme')}</span>
                        <ThemeSwitch value={settings.theme} onChange={(theme) => onChange({ theme })} colorTheme={settings.colorTheme} />
                        <span className="mt-1 block text-[11px] text-slate-400">{t('settings.themeHint')}</span>
                    </div>
                    <div>
                        <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.colorTheme')}</span>
                        <ColorThemeSwitch value={settings.colorTheme} onChange={(colorTheme) => onChange({ colorTheme })} />
                        <span className="mt-1 block text-[11px] text-slate-400">{t('settings.colorThemeHint')}</span>
                    </div>
                    <div>
                        <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('settings.language')}</span>
                        <LanguageSwitch value={settings.language} onChange={(l) => onChange({ language: l })} colorTheme={settings.colorTheme} />
                        <span className="mt-1 block text-[11px] text-slate-400">{t('settings.languageHint')}</span>
                    </div>
                </div></>)}
            </div>
        </>
    );
};
