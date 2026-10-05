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

// pb-[3.5px] lg:pb-[11.5px] (NOT a plain pb-4/lg:pb-6 match to the side
// gutter's own px-4/lg:px-6 SCALE - that was tried first and overcorrected):
// the TARGET is the TOTAL bottom whitespace (this footer's own padding-top
// (none) + its text's own line-height/height + padding-bottom) reading the
// same small size as the side gutter (16px / 24px at lg), not a sum of the
// text's own height PLUS a side-gutter-sized padding stacked on top of it.
// Measured live (Playwright, footer padding temporarily zeroed): this
// footer's own single-line text height is ~12.5px regardless of breakpoint
// (text-[10px] leading-tight) - so padding-bottom alone needs to supply only
// the REMAINDER up to the gutter size (16 - 12.5 = 3.5px; 24 - 12.5 = 11.5px
// at lg), not the full 16px/24px gutter value itself stacked after the text.
// A plain pb-4/lg:pb-6 (same px-4/lg:px-6 SCALE as the side gutter) was tried
// first and measured ~37px/~29px total at desktop/narrow widths - roughly
// DOUBLE the 24px/16px side gutter it was meant to match - because it added
// the gutter-sized padding ON TOP of the text's own height instead of
// accounting for it. Known remaining limitation: at very narrow viewports
// (~390px and below) the attribution text itself wraps onto a second line
// (~25px tall) - the total necessarily exceeds the 16px gutter there since
// there's no room to shrink the legally-required notice text further; this
// pb value still minimizes the overshoot rather than adding more on top of
// it, same reasoning as the single-line case.
export const AttributionFooter: React.FC = () => (
    <footer className="mx-auto w-full max-w-3xl px-4 pb-[3.5px] text-center text-[10px] leading-tight text-slate-400 lg:max-w-none lg:px-6 lg:pb-[11.5px]">
        {NOTICE_LINE_1} &middot; {NOTICE_LINE_2}{' '}
        <a href={NOTICE_URL} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-slate-600 dark:hover:text-slate-200">
            {NOTICE_URL}
        </a>
    </footer>
);
