/// <reference lib="esnext" />
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Tip } from './Tip';
import { useI18n, type Language } from '../i18n';
import { AUTO_LIVE_ORDER, type ProxyDiscovery, SOURCE_OVERRIDES, type SourceLabel, sanitizeSourceOverride } from '../proxy-discovery';
import { normalizeColorTheme } from '../settings-store';
import { accentOf } from '../theme';
import type { DataProvider, Settings, ThemeMode, TickerSuggestion } from '../types';
import { ChipSwitch } from './ChipSwitch';
import { SettingsPanel } from './SettingsPanel';

// ============================================================================
// TOP BAR
// ============================================================================

/**
 * Top navigation bar:
 *   [ ticker search | search button | As of | source label | theme | language | gear ]
 */

/** Segmented control — same visual language as fundamentals header pills.
 *  `size` ('sm', the default) keeps every existing caller (the language
 *  switch, dark/light, color theme - all in THIS file,
 *  TopBar's own compact row) pixel-identical. `size="md"` is an opt-in,
 *  additive variant for TabSwitcher's tab-pill usage ONLY: it widens the
 *  OUTER wrapper's own padding (`p-0.5` -> `p-[7px]`, +5px top/+5px bottom)
 *  so the Pill's own VISIBLE bordered/filled box - not just an invisible
 *  margin around it - renders at 38px tall, matching the Expirations row's
 *  own bordered-box height exactly (border(2) + p-[7px](14) + button
 *  py-1(8) + text-sm/leading-none line height(14) = 38). An earlier fix
 *  (TabSwitcher's own `py-[5px]` wrapper div, since removed) padded only the
 *  invisible OUTER bounding box to 38px while the Pill's actual bordered
 *  shape inside it stayed 28px tall - the two rows' bounding rects measured
 *  equal, but the two VISIBLE boxes people actually see next to each other
 *  did not (confirmed live via Playwright: pillInner 28px tall vs the
 *  Expirations form's own 38px tall border box, screenshot showed the
 *  mismatch plainly) - this `size` prop fixes the VISIBLE box itself
 *  instead of padding around it. */
export type PillOption = string | { k: string; l: string };
export const Pill = ({
    value,
    options,
    onChange,
    dark,
    accentActive,
    disabled,
    size = 'sm',
}: {
    value: string;
    options: PillOption[];
    onChange: (k: string) => void;
    dark: boolean;
    /** Active fill classes, e.g. "bg-indigo-600 text-white shadow-sm" */
    accentActive: string;
    disabled?: boolean;
    size?: 'sm' | 'md';
}) => (
    <div
        // `rounded-lg p-0.5 border` stays LITERAL and unconditional (header-
        // parity.test.ts source-matches this exact substring against the
        // fundamentals reference design) - `size="md"`'s wider padding is
        // layered on top as a trailing `!p-[7px]` (Tailwind's `!` important
        // modifier) rather than swapped in by conditionally omitting
        // `p-0.5`, so the override is unconditionally correct regardless of
        // Tailwind's generated utility order, not reliant on `p-[7px]`
        // happening to win a plain same-specificity cascade tie against
        // `p-0.5`.
        className={`flex-shrink-0 flex items-center rounded-lg p-0.5 border ${
            dark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'
        } ${disabled ? 'opacity-50' : ''} ${size === 'md' ? '!p-[7px]' : ''}`}
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
    onClearData: () => Promise<void>;
    onClearSettings: () => void;
    onClearAll: () => Promise<void>;
    tickerInput: string;
    /** placeholder of the empty ticker search: the fetcher's default list from api/options/index.json, or a plain label until it is known */
    tickerHint: string;
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
    /** Auto proxy discovery state (src/proxy-discovery.ts). */
    proxy: ProxyDiscovery;
    /** False on a page not served from this machine: no request goes to the proxy. */
    proxyAllowed: boolean;
    /** The data source is live (proxy found or a live provider fixed), else the cache. */
    live: boolean;
    /** Source label next to the ticker; null in a backtest (the As of selector shows the day). */
    source: SourceLabel | null;
    /** The cached data shown is of an earlier trading day. */
    sourceStale: boolean;
    /** The "As of" selector (backtest), rendered next to the provider. */
    asOfSlot?: React.ReactNode;
    /** The same controls as a block of the settings menu, for a narrow screen where the selector is hidden. */
    asOfMenuSlot?: React.ReactNode;
}> = ({
    settings, provider, onChange, onSetToken, onSetSecret, onClearData, onClearSettings, onClearAll,
    tickerInput, tickerHint, onTickerInput, onSearch, searching,
    tickerSuggestions, tickerSuggestionsOpen, tickerSuggestionsLoading, activeTickerSuggestion,
    onTickerFocus, onTickerBlur, onTickerKeyDown, onChooseSuggestion, setActiveTickerSuggestion, setTickerSuggestionsOpen,
    proxy, proxyAllowed, live, source, sourceStale, asOfSlot, asOfMenuSlot,
}) => {
    const [openSettings, setOpenSettings] = useState(false);
    const { t, lang, setLang } = useI18n();
    const hasKey = !!(settings.tokens[provider.id]) &&
        (!provider.supportsSecret || !!(settings.secrets[provider.id]));
    const ax = accentOf(settings.colorTheme);
    const isCache = !live;
    // the proxy is probed at all: allowed on this page and not the "always cache" override
    const probing = proxyAllowed && settings.source !== 'static';
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

    const settingsRef = useRef<HTMLDivElement | null>(null);
    const showTickerSuggestions = tickerSuggestionsOpen && (tickerSuggestionsLoading || tickerSuggestions.length > 0);

    useEffect(() => {
        const h = (e: MouseEvent) => {
            const n = e.target as Node;
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

    // proxy status: muted when it is not probed, pulsing while a probe runs, accent when found, slate when not (no proxy is
    // not an error: the cache serves)
    const proxyDotCls = !probing
        ? 'bg-slate-400/50 dark:bg-slate-600/50'
        : proxy.checking || proxy.up === null
            ? 'bg-yellow-400 animate-pulse'
            : proxy.up
                ? (settings.colorTheme === 'fundamentals' ? 'bg-emerald-500' : 'bg-indigo-500')
                : 'bg-slate-400';
    const proxyStatusCls = probing && proxy.up ? statusOk : mt;
    const proxyStatusText = !probing
        ? (proxyAllowed ? t('settings.proxyOff') : t('settings.proxyLocalOnly'))
        : proxy.up === null ? t('settings.proxyChecking') : proxy.up ? t('settings.proxyFound') : t('settings.proxyNotFound');
    const base = settings.proxyBase || '—';
    const sourceText = !source ? '' : source.kind === 'checking' ? '…' : source.kind === 'live'
        ? `LIVE${source.provider ? ` ${source.provider}` : ''}`
        : `CACHE${source.date ? ` ${source.date}` : ''}`;
    const sourceTip = !source ? '' : source.kind === 'checking'
        ? t('source.tip.checking', { base })
        : source.kind === 'live'
            ? (source.provider ? t('source.tip.live', { provider: source.provider, base }) : t('source.tip.liveNext', { base }))
            : (source.date ? t('source.tip.cache', { date: source.date }) : t('source.tip.cacheNext'));
    const sourceCls = sourceStale
        ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
        : source?.kind === 'live'
            ? (dark ? `border-slate-600 bg-slate-800 ${textAccent}` : `border-slate-200 bg-slate-50 ${textAccent}`)
            : (dark ? 'border-slate-700 bg-slate-800 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600');
    const overrideLabel = (o: string) => o === 'auto' ? t('settings.sourceOverride.auto') : o === 'static' ? t('settings.sourceOverride.static') : t('settings.sourceOverride.fixed', { provider: o.toUpperCase() });

    const setThemeMode = (mode: ThemeMode) => onChange({ theme: mode });
    const toggleDark = () => setThemeMode(dark ? 'light' : 'dark');

    return (
        <div className={`sticky top-0 z-50 ${bg} backdrop-blur-md border-b ${bdr}`}>
            <div className="px-4 lg:px-6">
                <div className="flex items-center gap-2 sm:gap-3 py-3">
                    {/* 3. Ticker — fundamentals mono input */}
                    <div className="flex-1 min-w-0 relative">
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
                            placeholder={tickerHint}
                            spellCheck={false}
                            autoCapitalize="characters"
                            role="combobox"
                            aria-expanded={showTickerSuggestions}
                            aria-label={t('topBar.ticker')}
                            className={`w-full ${inp} border rounded-lg px-3 py-2 font-mono font-bold text-sm focus:outline-none ${focusBorder} transition-colors uppercase text-ellipsis placeholder:text-ellipsis`}
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
                    <Tip text={t('topBar.search')} wrapperClassName="inline-flex flex-shrink-0">
                    <button
                        type="button"
                        onClick={onSearch}
                        disabled={!!searching}
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
                    </Tip>

                    {/* 5b. "As of" selector (backtest), same for all tabs */}
                    {asOfSlot}

                    {/* 6. Source label (auto proxy, owner 2026-10-25): LIVE CBOE / LIVE YAHOO / CACHE <data date>. It replaced the
                        CACHE / LIVE switch: the source is found automatically, a manual override is in the advanced settings. */}
                    {source && (
                        <Tip text={sourceTip} wrapperClassName="inline-flex flex-shrink-0">
                            <span
                                data-source-label={source.kind}
                                className={`flex-shrink-0 whitespace-nowrap rounded-lg border px-2 py-1.5 font-mono text-[11px] font-bold leading-none tabular-nums ${sourceCls}`}
                            >
                                {sourceText}
                            </span>
                        </Tip>
                    )}

                    {/* 7. Theme — fundamentals sun/moon text button */}
                    <Tip text={t('theme.' + (dark ? 'light' : 'dark'))} wrapperClassName="inline-flex flex-shrink-0">
                    <button
                        type="button"
                        onClick={toggleDark}
                        aria-label={t('theme.' + (dark ? 'light' : 'dark'))}
                        className={`flex-shrink-0 text-base leading-none px-2 py-1.5 rounded-lg transition-colors ${
                            dark ? `${sun} hover:bg-slate-800` : 'text-slate-500 hover:bg-slate-100'
                        }`}
                    >
                        {dark ? '☀️' : '🌙'}
                    </button>
                    </Tip>

                    {/* 8. i18n — fundamentals flag Pill. Hidden below sm (like the
                        provider select): the row's fixed-width items overflow a
                        390px viewport otherwise; language stays in the ⚙️ panel. */}
                    <Tip text={t('settings.language')} wrapperClassName="hidden sm:inline-flex flex-shrink-0">
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
                    </Tip>

                    {/* 9. Settings — fundamentals gear emoji button + card popover shell */}
                    <div className="relative flex-shrink-0" ref={settingsRef}>
                        <Tip text={t('topBar.settings')} wrapperClassName="inline-flex">
                        <button
                            type="button"
                            onClick={() => setOpenSettings((v) => !v)}
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
                        </Tip>
                        {openSettings && (
                            <div
                                className={`absolute right-0 top-full mt-2 w-[min(92vw,22rem)] z-[60] ${card} border rounded-xl shadow-xl p-3 space-y-3 max-h-[calc(100dvh-5rem)] overflow-y-auto`}
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

                                {/* Data source, at the bottom of the menu (auto proxy, owner 2026-10-25): no provider menu and no cache / live
                                    switch, only the auto-discovery with its polling switch; the manual override and the proxy URL are advanced. */}
                                <div className={`border-t ${bdr} pt-2 space-y-2`} data-data-source>
                                    <div className={`text-[10px] font-bold uppercase tracking-wide ${mt}`}>{t('settings.dataSource')}</div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className={`text-xs ${t2}`}>{t('settings.autoDiscovery')}</span>
                                        <span className={`inline-flex ${settings.proxyAutoPoll ? textAccent : mt}`} data-proxy-autopoll={settings.proxyAutoPoll ? 'on' : 'off'}>
                                            <ChipSwitch
                                                checked={settings.proxyAutoPoll}
                                                onChange={(on) => onChange({ proxyAutoPoll: on })}
                                                label={t('settings.autoDiscovery')}
                                            />
                                        </span>
                                    </div>
                                    <div className={`flex items-center gap-2 text-xs font-semibold ${proxyStatusCls}`} data-proxy-status={!probing ? 'off' : proxy.up === null ? 'checking' : proxy.up ? 'up' : 'down'}>
                                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${proxyDotCls}`} />
                                        <span>{proxyStatusText}</span>
                                    </div>
                                    <div className={`text-[10px] ${mt}`}>
                                        {settings.proxyAutoPoll ? t('settings.autoDiscoveryHint.on') : t('settings.autoDiscoveryHint.off')}
                                    </div>
                                    <details className="group" data-source-advanced>
                                        <summary className={`cursor-pointer select-none text-[10px] font-bold uppercase tracking-wide ${mt}`}>{t('settings.advanced')}</summary>
                                        <div className="mt-2 space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className={`text-xs ${t2}`}>{t('settings.sourceOverride')}</span>
                                                <select
                                                    value={settings.source}
                                                    onChange={(e) => onChange({ source: sanitizeSourceOverride(e.target.value) })}
                                                    data-source-override
                                                    className={`box-border w-[9rem] max-w-full rounded-lg border px-2 py-1 text-xs font-bold outline-none ${
                                                        dark ? 'border-slate-600 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800'
                                                    }`}
                                                >
                                                    {SOURCE_OVERRIDES.map((o) => (
                                                        <option key={o} value={o} disabled={!proxyAllowed && (AUTO_LIVE_ORDER as readonly string[]).includes(o)}>{overrideLabel(o)}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className={`text-[10px] ${mt}`}>{t('settings.sourceOverrideHint')}</div>
                                            <label className="block">
                                                <span className={`mb-1 block text-xs ${t2}`}>{t('settings.proxyBase')}</span>
                                                <input
                                                    type="text"
                                                    value={settings.proxyBase}
                                                    placeholder={t('settings.proxyBasePlaceholder')}
                                                    onChange={(e) => onChange({ proxyBase: e.target.value.trim() })}
                                                    data-proxy-base
                                                    className={`w-full rounded-lg border px-2 py-1 font-mono text-xs outline-none ${
                                                        dark ? 'border-slate-600 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800'
                                                    }`}
                                                />
                                                <span className={`mt-1 block text-[10px] ${mt}`}>{t('settings.proxyBaseHint')}</span>
                                            </label>
                                        </div>
                                    </details>
                                </div>

                                {asOfMenuSlot}

                                {/* Status and debug, the last block of the menu: they used to be a button and two dots in the header.
                                    One dot is enough, both dots always showed the same /health probe. */}
                                <div className={`border-t ${bdr} pt-2 space-y-2`} data-debug-info>
                                    <div className={`text-[10px] font-bold uppercase tracking-wide ${mt}`}>⌘ {t('topBar.debug')}</div>
                                    <div className={`rounded-lg border ${bdr} divide-y ${bdr}`}>
                                        <div className="flex items-start justify-between gap-3 px-3 py-2">
                                            <span className={`text-xs ${mt}`}>{t('topBar.proxy')}</span>
                                            <span
                                                className={`flex items-center gap-2 text-xs font-mono font-semibold ${proxyStatusCls}`}
                                                data-proxy-indicators={probing ? 'live' : 'disabled'}
                                            >
                                                <span className={`h-2.5 w-2.5 rounded-full ${proxyDotCls}`} />
                                                {!probing ? 'n/a' : proxy.up === null ? '…' : proxy.up ? 'online' : 'offline'}
                                            </span>
                                        </div>
                                        <div className="flex items-start justify-between gap-3 px-3 py-2">
                                            <span className={`text-xs ${mt}`}>{t('topBar.provider')}</span>
                                            <span className={`text-xs font-mono text-right ${t1}`}>{provider.label}</span>
                                        </div>
                                        <div className="flex items-start justify-between gap-3 px-3 py-2">
                                            <span className={`text-xs ${mt}`}>{t('topBar.mode')}</span>
                                            <span className={`text-xs font-mono font-semibold ${t1}`}>{isCache ? 'CACHE' : 'LIVE'}</span>
                                        </div>
                                        <div className="px-3 py-2">
                                            <div className={`text-[10px] ${mt}`}>proxyBase</div>
                                            <div className={`mt-1 text-[10px] font-mono break-all ${t2}`}>{settings.proxyBase || '—'}</div>
                                        </div>
                                        <div className="flex items-start justify-between gap-3 px-3 py-2">
                                            <span className={`text-xs ${mt}`}>{t('topBar.ticker')}</span>
                                            <span className={`text-xs font-mono font-semibold ${t1}`}>{tickerInput || '—'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
