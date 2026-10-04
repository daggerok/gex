// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useRef, useState } from 'react';
import { useI18n, type Language } from '../i18n';
import { LIVE_PROVIDERS, PROVIDERS } from '../providers';
import { normalizeColorTheme } from '../settings-store';
import { accentOf } from '../theme';
import type { DataProvider, Settings, ThemeMode, TickerSuggestion } from '../types';
import { SettingsPanel } from './SettingsPanel';

// ============================================================================
// TOP BAR
// ============================================================================

/**
 * Top navigation bar. Layout per product spec:
 *   [ left: brand "GEX" ] ................ [ API dropdown | theme | gear ]
 */

/** Segmented control — same visual language as fundamentals header pills. */
export type PillOption = string | { k: string; l: string };
export const Pill = ({
    value,
    options,
    onChange,
    dark,
    title,
    accentActive,
    disabled,
}: {
    value: string;
    options: PillOption[];
    onChange: (k: string) => void;
    dark: boolean;
    title?: string;
    /** Active fill classes, e.g. "bg-indigo-600 text-white shadow-sm" */
    accentActive: string;
    disabled?: boolean;
}) => (
    <div
        title={title}
        className={`flex-shrink-0 flex items-center rounded-lg p-0.5 border ${
            dark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'
        } ${disabled ? 'opacity-50' : ''}`}
    >
        {options.map((opt) => {
            const k = typeof opt === 'string' ? opt : opt.k;
            const l = typeof opt === 'string' ? opt : opt.l;
            return (
                <button
                    key={k}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(k)}
                    className={`px-2.5 py-1 rounded-md text-sm font-bold leading-none transition-all ${
                        value === k
                            ? accentActive
                            : dark
                                ? 'text-slate-400 hover:text-slate-200'
                                : 'text-slate-500 hover:text-slate-700'
                    } ${disabled ? 'cursor-not-allowed hover:text-slate-400' : ''}`}
                >
                    {l}
                </button>
            );
        })}
    </div>
);

export const TopBar: React.FC<{
    settings: Settings;
    provider: DataProvider;
    onChange: (patch: Partial<Settings>) => void;
    onSetToken: (providerId: string, token: string) => void;
    onSetSecret: (providerId: string, secret: string) => void;
    onClearData: () => void;
    onClearSettings: () => void;
    onClearAll: () => void;
    tickerInput: string;
    onTickerInput: (v: string) => void;
    onSearch: () => void;
    searching?: boolean;
    tickerSuggestions: TickerSuggestion[];
    tickerSuggestionsOpen: boolean;
    tickerSuggestionsLoading: boolean;
    activeTickerSuggestion: number;
    onTickerFocus: () => void;
    onTickerBlur: () => void;
    onTickerKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    onChooseSuggestion: (s: TickerSuggestion) => void;
    setActiveTickerSuggestion: (i: number) => void;
    setTickerSuggestionsOpen: (v: boolean) => void;
    proxyOk: boolean | null;
    proxyChecking: boolean;
}> = ({
    settings, provider, onChange, onSetToken, onSetSecret, onClearData, onClearSettings, onClearAll,
    tickerInput, onTickerInput, onSearch, searching,
    tickerSuggestions, tickerSuggestionsOpen, tickerSuggestionsLoading, activeTickerSuggestion,
    onTickerFocus, onTickerBlur, onTickerKeyDown, onChooseSuggestion, setActiveTickerSuggestion, setTickerSuggestionsOpen,
    proxyOk, proxyChecking,
}) => {
    const [openSettings, setOpenSettings] = useState(false);
    const [showDebug, setShowDebug] = useState(false);
    const { t, lang, setLang } = useI18n();
    const hasKey = !!(settings.tokens[provider.id]) &&
        (!provider.supportsSecret || !!(settings.secrets[provider.id]));
    const ax = accentOf(settings.colorTheme);
    const isCache = settings.providerId === 'static';
    const isDark = settings.theme === 'dark' || (
        settings.theme === 'system' &&
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
    );
    // Resolve effective dark for class tokens (subscribe via theme controller already on html)
    const [dark, setDarkLocal] = useState(isDark);
    useEffect(() => {
        const root = document.documentElement;
        const sync = () => setDarkLocal(root.classList.contains('dark'));
        sync();
        const obs = new MutationObserver(sync);
        obs.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, [settings.theme]);

    const debugRef = useRef<HTMLDivElement | null>(null);
    const settingsRef = useRef<HTMLDivElement | null>(null);
    const showTickerSuggestions = tickerSuggestionsOpen && (tickerSuggestionsLoading || tickerSuggestions.length > 0);

    useEffect(() => {
        const h = (e: MouseEvent) => {
            const n = e.target as Node;
            if (debugRef.current && !debugRef.current.contains(n)) setShowDebug(false);
            if (settingsRef.current && !settingsRef.current.contains(n)) setOpenSettings(false);
        };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, []);

    // ---- fundamentals-identical surface tokens ----
    const bg = dark ? 'bg-slate-950/95 text-slate-100' : 'bg-white/95 text-slate-900';
    const bdr = dark ? 'border-slate-800' : 'border-slate-200';
    const card = dark
        ? 'bg-slate-800 border-slate-600 text-slate-100'
        : 'bg-white border-slate-200 text-slate-900 shadow-sm';
    const inp = dark
        ? `bg-slate-800 border-slate-700 ${settings.colorTheme === 'fundamentals' ? 'text-emerald-400' : 'text-indigo-400'}`
        : `bg-slate-50 border-slate-300 ${settings.colorTheme === 'fundamentals' ? 'text-emerald-700' : 'text-indigo-700'}`;
    const mt = dark ? 'text-slate-400' : 'text-slate-500';
    const t1 = dark ? 'text-slate-100' : 'text-slate-800';
    const t2 = dark ? 'text-slate-300' : 'text-slate-600';
    const sugBg = dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200 shadow-lg';
    const sugH = dark ? 'bg-slate-700' : 'bg-slate-100';
    const sugH2 = dark ? 'hover:bg-slate-700/50' : 'hover:bg-slate-50';
    const pillActive = settings.colorTheme === 'fundamentals'
        ? 'bg-emerald-500 text-white shadow-sm'
        : 'bg-indigo-600 text-white shadow-sm';
    const focusBorder = settings.colorTheme === 'fundamentals'
        ? 'focus:border-emerald-500'
        : 'focus:border-indigo-500';
    const btn = settings.colorTheme === 'fundamentals'
        ? 'bg-emerald-500 hover:bg-emerald-400'
        : 'bg-indigo-600 hover:bg-indigo-500';
    const chipActiveDark = settings.colorTheme === 'fundamentals'
        ? 'bg-slate-700 text-emerald-400'
        : 'bg-slate-700 text-indigo-400';
    const chipActiveLight = settings.colorTheme === 'fundamentals'
        ? 'bg-slate-200 text-emerald-700'
        : 'bg-slate-200 text-indigo-700';
    const statusOk = settings.colorTheme === 'fundamentals' ? 'text-emerald-500' : 'text-indigo-500';
    const textAccent = dark
        ? (settings.colorTheme === 'fundamentals' ? 'text-emerald-400' : 'text-indigo-400')
        : (settings.colorTheme === 'fundamentals' ? 'text-emerald-700' : 'text-indigo-700');
    const sun = 'text-yellow-400';

    const proxyDotCls = isCache
        ? 'bg-slate-400/50 dark:bg-slate-600/50'
        : proxyChecking
            ? 'bg-yellow-400 animate-pulse'
            : proxyOk
                ? (settings.colorTheme === 'fundamentals' ? 'bg-emerald-500' : 'bg-indigo-500')
                : 'bg-red-500';
    const proxyStatusCls = !isCache && proxyOk ? statusOk : (!isCache && proxyOk === false ? 'text-red-500' : mt);
    const proxyStatusLabel = isCache ? '● n/a' : proxyChecking ? '● …' : proxyOk ? '● online' : '● offline';

    const setThemeMode = (mode: ThemeMode) => onChange({ theme: mode });
    const toggleDark = () => setThemeMode(dark ? 'light' : 'dark');

    return (
        <div className={`sticky top-0 z-50 ${bg} backdrop-blur-md border-b ${bdr}`}>
            <div className="px-4 xl:px-8">
                <div className="flex items-center gap-2 sm:gap-3 py-3">
                    {/* 1. Debug — same as fundamentals ⌘ */}
                    <div className="relative flex-shrink-0" ref={debugRef}>
                        <button
                            type="button"
                            onClick={() => setShowDebug((v) => !v)}
                            title={t('topBar.debug')}
                            aria-label={t('topBar.debug')}
                            aria-expanded={showDebug}
                            className={`text-xs px-2 py-1.5 rounded-lg transition-colors ${
                                showDebug
                                    ? dark ? chipActiveDark : chipActiveLight
                                    : dark
                                        ? 'text-slate-600 hover:text-slate-400 hover:bg-slate-800'
                                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            ⌘
                        </button>
                        {showDebug && (
                            <div
                                role="dialog"
                                aria-label={t('topBar.debug')}
                                className={`absolute left-0 top-full mt-2 w-[min(92vw,22rem)] z-[60] ${card} border rounded-xl shadow-xl p-3 space-y-3`}
                            >
                                <div className={`font-bold text-sm ${t1}`}>⌘ {t('topBar.debug')}</div>
                                <div className={`text-[10px] font-bold uppercase tracking-wide ${mt}`}>Overview</div>
                                <div className={`rounded-lg border ${bdr} divide-y ${bdr}`}>
                                    <div className="flex items-start justify-between gap-3 px-3 py-2">
                                        <span className={`text-xs ${mt}`}>Provider</span>
                                        <span className={`text-xs font-mono text-right ${t1}`}>{provider.label}</span>
                                    </div>
                                    <div className="grid grid-cols-2 divide-x divide-inherit">
                                        <div className="px-3 py-2">
                                            <div className={`text-[10px] ${mt}`}>Mode</div>
                                            <div className={`text-xs font-mono font-semibold ${t1}`}>{isCache ? 'CACHE' : 'LIVE'}</div>
                                        </div>
                                        <div className="px-3 py-2">
                                            <div className={`text-[10px] ${mt}`}>Proxy</div>
                                            <div className={`text-xs font-mono font-semibold ${proxyStatusCls}`}>{proxyStatusLabel}</div>
                                        </div>
                                    </div>
                                    <div className="px-3 py-2">
                                        <div className={`text-[10px] ${mt}`}>proxyBase</div>
                                        <div className={`mt-1 text-[10px] font-mono break-all ${t2}`}>{settings.proxyBase || '—'}</div>
                                    </div>
                                    <div className="px-3 py-2">
                                        <div className={`text-[10px] ${mt}`}>Ticker</div>
                                        <div className={`text-xs font-mono font-semibold ${t1}`}>{tickerInput || '—'}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 2. Proxy dots — fundamentals size/spacing */}
                    <div
                        className="flex gap-1.5 flex-shrink-0"
                        data-proxy-indicators={isCache ? 'disabled' : 'live'}
                        title={isCache ? `${t('topBar.proxy')} (${t('topBar.cache')} — ${t('topBar.proxyDisabled')})` : t('topBar.proxy')}
                        aria-label={t('topBar.proxy')}
                    >
                        <div className={`h-2.5 w-2.5 rounded-full ${proxyDotCls}`} />
                        <div className={`h-2.5 w-2.5 rounded-full ${proxyDotCls}`} />
                    </div>

                    {/* 3. Ticker — fundamentals mono input */}
                    <div className="flex-1 min-w-0 relative" title={t('topBar.ticker')}>
                        <input
                            type="text"
                            value={tickerInput}
                            onChange={(e) => {
                                onTickerInput(e.target.value.toUpperCase());
                                setTickerSuggestionsOpen(true);
                            }}
                            onFocus={(e) => { onTickerFocus(); e.currentTarget.select(); }}
                            onClick={(e) => e.currentTarget.select()}
                            onBlur={onTickerBlur}
                            onKeyDown={onTickerKeyDown}
                            placeholder={t('controls.tickerPlaceholder')}
                            spellCheck={false}
                            autoCapitalize="characters"
                            role="combobox"
                            aria-expanded={showTickerSuggestions}
                            aria-label={t('topBar.ticker')}
                            className={`w-full ${inp} border rounded-lg px-3 py-2 font-mono font-bold text-sm focus:outline-none ${focusBorder} transition-colors uppercase`}
                        />
                        {showTickerSuggestions && (
                            <div className={`absolute top-full left-0 right-0 mt-1 ${sugBg} border rounded-lg overflow-hidden z-50 max-w-xl`}>
                                {tickerSuggestionsLoading && tickerSuggestions.length === 0 ? (
                                    <div className={`px-3 py-2 text-xs ${mt}`}>{t('controls.searching')}</div>
                                ) : tickerSuggestions.map((s, i) => (
                                    <button
                                        key={`${s.source}:${s.symbol}:${i}`}
                                        type="button"
                                        onMouseDown={(e) => { e.preventDefault(); onChooseSuggestion(s); }}
                                        onMouseEnter={() => setActiveTickerSuggestion(i)}
                                        className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                                            i === activeTickerSuggestion ? sugH : sugH2
                                        }`}
                                    >
                                        <span className={`font-mono font-bold text-sm w-14 flex-shrink-0 ${textAccent}`}>
                                            {s.symbol}
                                        </span>
                                        <span className={`text-xs truncate ${t2}`}>
                                            {s.name || (s.hasOptions ? t('tickerFromIndex') : t('validTickerFromIndex'))}
                                            {!s.hasOptions ? ` ${t('noOptions')}` : ''}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 4. Search — fundamentals solid accent button */}
                    <button
                        type="button"
                        onClick={onSearch}
                        disabled={!!searching}
                        title={t('topBar.search')}
                        aria-label={t('topBar.search')}
                        className={`flex-shrink-0 flex items-center ${btn} text-white font-bold px-3 sm:px-4 py-2 rounded-lg text-sm transition-all active:scale-95 disabled:opacity-40`}
                    >
                        {searching ? (
                            <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4" aria-hidden>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                            </svg>
                        )}
                    </button>

                    {/* 5. Provider — greys out when CACHE (same pill shell feel via native select styled) */}
                    <div className="hidden sm:block flex-shrink-0 w-[7.25rem]">
                        <select
                            value={settings.providerId}
                            onChange={(e) => onChange({ providerId: e.target.value })}
                            disabled={isCache}
                            data-provider-select={isCache ? 'disabled' : 'live'}
                            title={isCache ? `${t('settings.provider')} (${t('topBar.proxyDisabled')})` : t('settings.provider')}
                            className={`box-border w-full max-w-full rounded-lg border px-2 py-1.5 text-sm font-bold outline-none transition-colors ${
                                isCache
                                    ? dark
                                        ? 'border-slate-700 bg-slate-800/50 text-slate-500 cursor-not-allowed'
                                        : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                                    : dark
                                        ? 'border-slate-700 bg-slate-800 text-slate-100'
                                        : 'border-slate-200 bg-slate-100 text-slate-800'
                            }`}
                        >
                            {(isCache ? PROVIDERS.filter((p) => p.id === 'static') : LIVE_PROVIDERS).map((p) => (
                                <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* 6. CACHE / LIVE — fundamentals Pill */}
                    <div title={isCache ? t('topBar.cache') : t('topBar.live')} className="flex-shrink-0">
                        <Pill
                            value={isCache ? 'cache' : 'live'}
                            options={[
                                { k: 'cache', l: '💾' },
                                { k: 'live', l: '🌐' },
                            ]}
                            onChange={(k) => {
                                if (k === 'cache') onChange({ providerId: 'static' });
                                else if (isCache) onChange({ providerId: 'cboe' });
                            }}
                            dark={dark}
                            accentActive={pillActive}
                            title={isCache ? t('topBar.cache') : t('topBar.live')}
                        />
                    </div>

                    {/* 7. Theme — fundamentals sun/moon text button */}
                    <button
                        type="button"
                        onClick={toggleDark}
                        title={t('theme.' + (dark ? 'light' : 'dark'))}
                        aria-label={t('theme.' + (dark ? 'light' : 'dark'))}
                        className={`flex-shrink-0 text-base leading-none px-2 py-1.5 rounded-lg transition-colors ${
                            dark ? `${sun} hover:bg-slate-800` : 'text-slate-500 hover:bg-slate-100'
                        }`}
                    >
                        {dark ? '☀️' : '🌙'}
                    </button>

                    {/* 8. i18n — fundamentals flag Pill. Hidden below sm (like the
                        provider select): the row's fixed-width items overflow a
                        390px viewport otherwise; language stays in the ⚙️ panel. */}
                    <div title={t('settings.language')} className="hidden sm:block flex-shrink-0">
                        <Pill
                            value={settings.language}
                            options={[
                                { k: 'en', l: '🇺🇸' },
                                { k: 'ru', l: '🇷🇺' },
                            ]}
                            onChange={(k) => {
                                onChange({ language: k as Language });
                                setLang(k as Language);
                            }}
                            dark={dark}
                            accentActive={pillActive}
                            title={t('settings.language')}
                        />
                    </div>

                    {/* 9. Settings — fundamentals gear emoji button + card popover shell */}
                    <div className="relative flex-shrink-0" ref={settingsRef}>
                        <button
                            type="button"
                            onClick={() => setOpenSettings((v) => !v)}
                            title={t('topBar.settings')}
                            aria-label={t('topBar.settings')}
                            aria-expanded={openSettings}
                            className={`flex-shrink-0 text-base leading-none px-2 py-1.5 rounded-lg transition-colors ${
                                openSettings
                                    ? dark ? chipActiveDark : chipActiveLight
                                    : dark
                                        ? 'text-slate-300 hover:bg-slate-800'
                                        : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            ⚙️
                        </button>
                        {openSettings && (
                            <div
                                className={`absolute right-0 top-full mt-2 w-[min(92vw,22rem)] z-[60] ${card} border rounded-xl shadow-xl p-3 space-y-3`}
                            >
                                <div className={`font-bold text-sm ${t1}`}>⚙️ {t('settings.title')}</div>

                                <div className={`text-[10px] font-bold uppercase tracking-wide ${mt}`}>{t('settings.theme')}</div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className={`text-xs ${t2}`}>{t('settings.theme')}</span>
                                    <Pill
                                        value={dark ? 'dark' : 'light'}
                                        options={[
                                            { k: 'light', l: '☀️' },
                                            { k: 'dark', l: '🌙' },
                                        ]}
                                        onChange={(k) => setThemeMode(k as ThemeMode)}
                                        dark={dark}
                                        accentActive={pillActive}
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className={`text-xs ${t2}`}>{t('settings.colorTheme')}</span>
                                    <Pill
                                        value={settings.colorTheme}
                                        options={[
                                            { k: 'gex', l: '📘' },
                                            { k: 'fundamentals', l: '📗' },
                                        ]}
                                        onChange={(k) => onChange({ colorTheme: normalizeColorTheme(k) })}
                                        dark={dark}
                                        accentActive={pillActive}
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className={`text-xs ${t2}`}>{t('settings.language')}</span>
                                    <Pill
                                        value={settings.language}
                                        options={[
                                            { k: 'en', l: '🇺🇸' },
                                            { k: 'ru', l: '🇷🇺' },
                                        ]}
                                        onChange={(k) => {
                                            onChange({ language: k as Language });
                                            setLang(k as Language);
                                        }}
                                        dark={dark}
                                        accentActive={pillActive}
                                    />
                                </div>

                                <div className={`text-[10px] font-bold uppercase tracking-wide pt-1 ${mt}`}>{t('settings.provider')}</div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className={`text-xs ${t2}`}>{t('settings.provider')}</span>
                                    <select
                                        value={settings.providerId}
                                        onChange={(e) => onChange({ providerId: e.target.value })}
                                        disabled={isCache}
                                        data-provider-select={isCache ? 'disabled' : 'live'}
                                        className={`box-border w-[7.25rem] max-w-full rounded-lg border px-2 py-1 text-xs font-bold outline-none ${
                                            isCache
                                                ? dark
                                                    ? 'border-slate-700 bg-slate-900/50 text-slate-500 cursor-not-allowed'
                                                    : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                                                : dark
                                                    ? 'border-slate-600 bg-slate-900 text-slate-100'
                                                    : 'border-slate-200 bg-white text-slate-800'
                                        }`}
                                    >
                                        {(isCache ? PROVIDERS.filter((p) => p.id === 'static') : LIVE_PROVIDERS).map((p) => (
                                            <option key={p.id} value={p.id}>{p.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className={`text-[10px] ${mt}`}>
                                    {isCache ? t('topBar.proxyDisabled') : t('settings.providerHint')}
                                </div>

                                {/* Nested full SettingsPanel for desk columns / cache / proxy fields */}
                                <div className={`border-t ${bdr} pt-2`}>
                                    <SettingsPanel
                                        settings={settings}
                                        provider={provider}
                                        onChange={onChange}
                                        onSetToken={onSetToken}
                                        onSetSecret={onSetSecret}
                                        onClearData={onClearData}
                                        onClearSettings={onClearSettings}
                                        onClearAll={onClearAll}
                                        onClose={() => setOpenSettings(false)}
                                        embedded
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
