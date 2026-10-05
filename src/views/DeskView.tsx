// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React from 'react';
import { ChainTable, type ChainSection } from '../components/ChainTable';
import { Icon } from '../components/Icon';
import { KeyOnboarding } from '../components/KeyOnboarding';
import { useI18n } from '../i18n';
import { accentOf } from '../theme';
import type { ChainMeta, DataProvider, Settings } from '../types';
import { fmt } from '../utils';

// ============================================================================
// DESK VIEW (Tab 1) — STEP 1/STEP 2 controls + notices + onboarding + chain
// table, exactly as App rendered them before the Phase 0 split. All state lives
// in App (main.tsx); this component only renders it.
// ============================================================================

export interface DeskViewProps {
    settings: Settings;
    provider: DataProvider;
    meta: ChainMeta | null;
    loadChain: () => Promise<void>;
    getDates: (symbol: string, credsOverride?: { token?: string; secret?: string }) => Promise<void>;
    tickerInput: string;
    metaLoading: boolean;
    expLoading: boolean;
    anyLoading: boolean;
    cancelAll: () => void;
    chainSymbol: string;
    spot: number | null;
    spotIsEstimated: boolean;
    notice: string;
    error: string;
    showOnboarding: boolean;
    setToken: (providerId: string, token: string) => void;
    setSecret: (providerId: string, secret: string) => void;
    onboardingPreview: () => void;
    previewLabel: string;
    sections: ChainSection[];
    hasRows: boolean;
}

export const DeskView: React.FC<DeskViewProps> = ({
    settings, provider, meta, loadChain, getDates,
    tickerInput, metaLoading, expLoading, anyLoading, cancelAll, chainSymbol, spot,
    spotIsEstimated, notice, error, showOnboarding, setToken, setSecret, onboardingPreview,
    previewLabel, sections, hasRows,
}) => {
    const { t: tr } = useI18n();
    const ax = accentOf(settings.colorTheme);
    return (
        /* Width: comfortable centered column on phones/tablets, but on LARGE
            screens (laptops/desktops/TVs, lg: ≥1024px) go full-width so the
            option desk uses all the horizontal space instead of a narrow
            column. See index.css for the matching container note. */
        <main className="mx-auto w-full max-w-3xl px-4 py-4 lg:max-w-none lg:px-8 2xl:px-16">
            {/* ---- Controls: STEP 1 result (Cancel/spot) — the expiration
                picker + Load button (STEP 2) now live in the shared panel in
                main.tsx, in the same row as the Desk/GEX/Chart tab pills,
                visible from Desk and GEX alike. ---- */}
            <div className="mb-4 flex flex-wrap items-center gap-2">

                {/* Cancel — visible only while a request is in flight. */}
                {anyLoading && (
                    <button
                        type="button"
                        onClick={cancelAll}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-300 dark:border-rose-700 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    >
                        <Icon.X className="h-3.5 w-3.5" /> {tr('controls.cancel')}
                    </button>
                )}

                {/* Underlying spot + provider label. */}
                {chainSymbol && (
                    <div className="flex items-baseline gap-2">
                        <span className="text-lg font-bold text-slate-900 dark:text-slate-50">{chainSymbol}</span>
                        {spot != null && (
                            <span className="text-sm text-slate-500 dark:text-slate-400">
                                {tr('spot.label')} <span className="font-semibold text-slate-800 dark:text-slate-200">${fmt(spot)}</span>
                                {spotIsEstimated && <span className="ml-1 text-[11px] text-amber-500">{tr('spot.estimated')}</span>}
                            </span>
                        )}
                        <span className="text-xs text-slate-400">{tr('spot.delayed', { provider: provider.label.split(' ')[0] })}</span>
                    </div>
                )}

                {anyLoading && (
                    <span className={`animate-pulse-soft text-xs font-medium ${ax.pulse}`}>
                        {metaLoading ? tr('loading.expirations') : tr('loading.chain')}
                    </span>
                )}
            </div>

            {/* Calm notice (e.g. cancelled). */}
            {notice && !error && (
                <div className="mb-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                    {notice}
                </div>
            )}

            {/* Error banner with retry. */}
            {error && (
                <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                    <span>{error}</span>
                    <button
                        type="button"
                        onClick={() => (meta ? loadChain() : getDates(tickerInput))}
                        className="shrink-0 rounded-md border border-rose-300 dark:border-rose-700 px-2 py-0.5 text-xs font-semibold hover:bg-rose-100 dark:hover:bg-rose-900/40"
                    >
                        {tr('retry')}
                    </button>
                </div>
            )}

            {/* Onboarding card (key required for this provider + ticker). */}
            {showOnboarding && (
                <div className="py-10">
                    <KeyOnboarding
                        provider={provider}
                        tokenValue={settings.tokens[provider.id] || ''}
                        secretValue={settings.secrets[provider.id] || ''}
                        colorTheme={settings.colorTheme}
                        onSave={(apiToken, apiSecret) => {
                            setToken(provider.id, apiToken);
                            if (provider.supportsSecret) setSecret(provider.id, apiSecret);
                            // Pass creds directly to avoid a stale-closure race
                            // (settings state hasn't committed yet).
                            getDates(tickerInput || 'AAPL', { token: apiToken, secret: apiSecret });
                        }}
                        onPreview={onboardingPreview}
                        previewLabel={previewLabel}
                    />
                </div>
            )}

            {/* Option chain desk (one section per expiration), or guidance. */}
            {!showOnboarding && (
                chainSymbol && hasRows ? (
                    <ChainTable symbol={chainSymbol} sections={sections} spot={spot} columns={settings.deskColumns} colorTheme={settings.colorTheme} />
                ) : meta && !expLoading && !chainSymbol ? (
                    <div className="grid place-items-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-16 text-sm text-slate-400">
                        {tr('notice.pickExp')} <span className={`mx-1 font-semibold ${ax.pulse}`}>{tr('controls.load')}</span> {tr('notice.toFetch')}
                    </div>
                ) : (!meta && !metaLoading && !error) ? (
                    <div className="grid place-items-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-16 text-sm text-slate-400">
                        {tr('notice.enterTicker')} <span className="mx-1 font-semibold text-slate-600 dark:text-slate-300">{tr('controls.expirations')}</span> {tr('notice.toBegin')}
                    </div>
                ) : null
            )}
        </main>
    );
};
