// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React from 'react';

// ---------------------------------------------------------------------------
// App-wide attribution for lightweight-charts (Chart tab), rendered below the
// active view on EVERY tab (plan sections 8.2 / 15). Its Apache-2.0 terms, as
// stated in the package README, require the "attribution notice" from the
// NOTICE file plus a link to https://www.tradingview.com/ on a page available
// to users.
//
// NOTICE_* below are the two lines of the upstream NOTICE file, VERBATIM
// (github.com/tradingview/lightweight-charts/blob/master/NOTICE, identical at
// tag v5.2.1, the installed version). Legal text: deliberately not routed
// through i18n so it is never translated or reworded. Note the upstream file
// writes the copyright sign as "(" + CYRILLIC SMALL LETTER ES (U+0441) + ")";
// it is kept as-is rather than "corrected".
// ---------------------------------------------------------------------------

export const NOTICE_LINE_1 = 'TradingView Lightweight Charts™';
export const NOTICE_LINE_2 = 'Copyright (с) 2025 TradingView, Inc.';
export const NOTICE_URL = 'https://www.tradingview.com/';

export const AttributionFooter: React.FC = () => (
    <footer className="mx-auto w-full max-w-3xl px-4 pb-2 text-[11px] leading-4 text-slate-400 lg:max-w-none lg:px-8 2xl:px-16">
        {NOTICE_LINE_1} &middot; {NOTICE_LINE_2}{' '}
        <a href={NOTICE_URL} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-slate-600 dark:hover:text-slate-200">
            {NOTICE_URL}
        </a>
    </footer>
);
