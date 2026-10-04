// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useState } from 'react';
import { providerDescription, useI18n } from '../i18n';
import { DEFAULT_COLOR_THEME } from '../settings-store';
import { accentOf } from '../theme';
import type { ColorThemeId, DataProvider } from '../types';
import { Icon } from './Icon';

// ============================================================================
// ONBOARDING CARD (shown when the active provider needs a key that isn't set)
// ============================================================================

export const KeyOnboarding: React.FC<{
    provider: DataProvider;
    tokenValue: string;
    secretValue: string;
    onSave: (apiToken: string, apiSecret: string) => void;
    onPreview: () => void;
    previewLabel: string;
    colorTheme?: ColorThemeId;
}> = ({ provider, tokenValue, secretValue, onSave, onPreview, previewLabel, colorTheme = DEFAULT_COLOR_THEME }) => {
    const { t, lang } = useI18n();
    const ax = accentOf(colorTheme);
    const [keyDraft, setKeyDraft] = useState('');
    const [secretDraft, setSecretDraft] = useState('');
    // Ready when the key (and, if required, the secret) are filled in.
    const ready = !!keyDraft && (!provider.supportsSecret || !!secretDraft);
    const save = () => { if (ready) onSave(keyDraft, secretDraft); };
    return (
        <div className="mx-auto max-w-lg animate-fade-in rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center shadow-sm">
            <div className={`mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full ${ax.brandSoft}`}>
                <Icon.Key className="h-5 w-5" />
            </div>
            <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-50">
                {t('onboarding.title', { provider: provider.label.split(' ')[0], keys: provider.supportsSecret ? t('onboarding.keys') : t('onboarding.key') })}
            </h2>
            <p className="mx-auto mb-4 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {provider.keyHint || providerDescription(provider.id, lang)}
            </p>

            {provider.keyUrl && (
                <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer"
                   className={`mb-3 inline-flex items-center gap-1.5 rounded-lg ${ax.btn} px-4 py-2 text-sm font-semibold text-white`}>
                    {t('onboarding.getKey')} <Icon.External className="h-4 w-4" />
                </a>
            )}

            <div className="mt-3 space-y-2 text-left">
                <input
                    type="password"
                    value={keyDraft}
                    placeholder={provider.keyLabel || t('settings.apiKey')}
                    onChange={(e) => setKeyDraft(e.target.value.trim())}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !provider.supportsSecret) save(); }}
                    className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                />
                {provider.supportsSecret && (
                    <input
                        type="password"
                        value={secretDraft}
                        placeholder={provider.secretLabel || t('settings.apiSecret')}
                        onChange={(e) => setSecretDraft(e.target.value.trim())}
                        onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                        className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 ${ax.focusRing}`}
                    />
                )}
                <button
                    type="button"
                    disabled={!ready}
                    onClick={save}
                    className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                    {t('onboarding.save', { keys: provider.supportsSecret ? t('onboarding.keys') : t('onboarding.key') })}
                </button>
            </div>

            <button
                type="button"
                onClick={onPreview}
                className={`mt-4 text-xs font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400 ${ax.link}`}
            >
                {previewLabel}
            </button>
            {tokenValue && (!provider.supportsSecret || secretValue) && (
                <p className="mt-3 text-[11px] text-emerald-600 dark:text-emerald-400">{t('onboarding.saved')}</p>
            )}
        </div>
    );
};
