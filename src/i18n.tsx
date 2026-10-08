// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

// ============================================================================
// I18N — English / Russian translations, I18nProvider, useI18n().
// ============================================================================


export type Language = 'en' | 'ru';
export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGES: Language[] = ['en', 'ru'];

/** Distinct flag emoji per language for the language switcher (ru/en icons). */
export const LANG_FLAGS: Record<Language, string> = { en: '🇺🇸', ru: '🇷🇺' };

export const translations: Record<Language, Record<string, string>> = {
    en: {
        'app.brand': 'GEX',
        'app.title': 'GEX',

        'topBar.api': 'API',
        'topBar.settings': 'Settings',
        'topBar.debug': 'Debug',
        'topBar.proxy': 'Proxy status',
        'topBar.proxyDisabled': 'disabled in CACHE mode',
        'topBar.cache': 'CACHE (static)',
        'topBar.live': 'LIVE (proxy)',
        'topBar.search': 'Search / load',
        'topBar.ticker': 'Ticker',
        'topBar.language': 'Language',

        'language.en': 'English',
        'language.ru': 'Русский',
        'language.icon': '🌐',

        'theme.light': 'Light',
        'theme.system': 'System',
        'theme.dark': 'Dark',

        'settings.title': 'Settings',
        'settings.provider': 'Data provider',
        'settings.providerHint': 'Also available in the heading for quick access.',
        'settings.theme': 'Theme',
        'settings.themeHint': 'Also available in the heading for quick access.',
        'settings.colorTheme': 'Color palette',
        'settings.colorThemeHint': 'Shared with Fundamentals for a consistent merge-ready UI.',
        'colorTheme.fundamentals': 'Emerald Ledger',
        'colorTheme.gex': 'Indigo Desk',
        'settings.language': 'Language',
        'settings.languageHint': 'Also available in the heading for quick access.',
        'settings.apiKey': 'API key',
        'settings.apiSecret': 'API secret',
        'settings.getKey': 'Get a free key',
        'settings.keyHint': 'Stored only in your browser (localStorage).',
        'settings.proxyBase': 'Proxy base URL',
        'settings.proxyBaseHint': 'Run bun ./scripts/options-local-proxy.ts locally, or deploy scripts/options-cloudflare-proxy.js.',
        'settings.proxyBasePlaceholder': 'http://localhost:8787 or https://name.you.workers.dev',
        'settings.corsProxy': 'CORS proxy',
        'settings.corsProxyHint': 'Public proxies can be flaky — switch if one fails, or use your own Worker.',
        'settings.workerUrl': 'Worker URL',
        'settings.workerUrlPlaceholder': 'https://name.you.workers.dev',

        'settings.deskColumns': 'Desk columns',
        'settings.deskColumns.calls': 'Calls',
        'settings.deskColumns.puts': 'Puts',
        'settings.deskColumns.openInterest': 'Open interest (OI)',
        'settings.deskColumns.volume': 'Volume',
        'settings.deskColumns.iv': 'Implied volatility (IV)',
        'settings.deskColumns.delta': 'Delta Δ',
        'settings.deskColumns.gamma': 'Gamma Γ',
        'settings.deskColumns.theta': 'Theta Θ',
        'settings.deskColumns.vega': 'Vega',
        'settings.deskColumns.rho': 'Rho ρ',
        'settings.deskColumns.lambda': 'Lambda λ',
        'settings.deskColumns.vanna': 'Vanna',
        'settings.deskColumns.vomma': 'Vomma',
        'settings.deskColumns.charm': 'Charm',
        'settings.deskColumns.speed': 'Speed',
        'settings.deskColumns.zomma': 'Zomma',
        'settings.deskColumns.color': 'Color',
        'settings.deskColumns.bid': 'Bid',
        'settings.deskColumns.mid': 'Mid',
        'settings.deskColumns.ask': 'Ask',
        'settings.deskColumns.note': 'Bid / Mid / Ask and Strike stay visible. Rho is disabled by default.',

        'deskColumns.header.openInterest': 'OI',
        'deskColumns.header.volume': 'Vol',
        'deskColumns.header.iv': 'IV',
        'deskColumns.header.delta': 'Δ',
        'deskColumns.header.gamma': 'Γ',
        'deskColumns.header.theta': 'Θ',
        'deskColumns.header.vega': 'Vega',
        'deskColumns.header.rho': 'ρ',
        'deskColumns.header.lambda': 'λ',
        'deskColumns.header.vanna': 'Vanna',
        'deskColumns.header.vomma': 'Vomma',
        'deskColumns.header.charm': 'Charm',
        'deskColumns.header.speed': 'Speed',
        'deskColumns.header.zomma': 'Zomma',
        'deskColumns.header.color': 'Color',
        'deskColumns.header.bid': 'Bid',
        'deskColumns.header.mid': 'Mid',
        'deskColumns.header.ask': 'Ask',

        'settings.vixFuturesPricing': 'VIX futures-priced greeks (experimental)',
        'settings.vixFuturesPricing.hint': 'Black-76 pricing for VIX/VXN options. Not wired up yet — toggling this has no effect yet.',

        'settings.cache': 'Cache',
        'settings.cache.records': 'Data records',
        'settings.cache.dataSize': 'Data size',
        'settings.cache.settingsSize': 'Settings size',
        'settings.cache.oldest': 'Oldest record',
        'settings.cache.newest': 'Newest record',
        'settings.cache.clearData': 'Clear data',
        'settings.cache.clearDataHint': 'Downloaded query results only',
        'settings.cache.clearSettings': 'Clear settings',
        'settings.cache.clearSettingsHint': 'Provider / theme / color palette / language / keys / proxy / columns',
        'settings.cache.clearAll': 'Clear everything',
        'settings.cache.clearAllHint': 'Data + settings (full reset)',
        'settings.cache.confirm': 'Confirm?',
        'settings.cache.confirmHelp': 'Click “Confirm?” again to proceed, or click away to cancel.',

        'setupBadge.noSetup': 'No setup',
        'setupBadge.freeKey': 'Free key',
        'setupBadge.keySet': 'Key set',
        'setupBadge.needsProxy': 'Needs proxy',

        'providerDescription.static':
            'Local static cache — same-origin data/options/{TICKER}.json (GitHub Action + yfinance + CBOE/BS greeks). ' +
            'No proxy, no keys. Best default on GitHub Pages. Only cached tickers are listed.',
        'providerDescription.yahoo':
            'Yahoo Finance via proxy (/api/options) — crumb/cookie handled by scripts/options-local-proxy.ts or Cloudflare Worker. ' +
            'Lazy per-expiration. No provider greeks; client Black-Scholes fills them when IV is present.',
        'providerDescription.nasdaq':
            'NASDAQ option chain via proxy (/api/nasdaq) — full chain one call (bid/ask/last/volume/OI). ' +
            'No IV/greeks in feed (higher-order stay empty). Needs Proxy base URL.',
        'providerDescription.cboe':
            'CBOE delayed options via proxy (/api/cboe) — equities & indices, greeks/IV/OI + spot. ' +
            'Default on localhost when proxy is available. Needs Proxy base URL.',

        'onboarding.title': 'One quick step: add your free {{provider}} {{keys}}',
        'onboarding.description': '{{hint}}',
        'onboarding.getKey': 'Get a free key',
        'onboarding.save': 'Save {{keys}} & load',
        'onboarding.saved': 'Credentials already saved — just search a ticker above.',
        'onboarding.keys': 'keys',
        'onboarding.key': 'key',
        'onboarding.previewDemo': 'or get {{symbol}}’s dates now (no key needed)',
        'onboarding.previewCache': 'or switch to CACHE (AAPL static data)',

        'controls.tickerPlaceholder': 'Ticker or company (e.g. AAPL, Tesla, SPX)',
        'controls.expirations': 'Expirations',
        'controls.loading': 'Loading…',
        'controls.reset': 'Reset',
        'controls.resetTooltip': 'Back to the nearest expiration. Data loads as soon as you click a date.',
        'controls.enterKey': 'Enter',
        'controls.all': 'All',
        'controls.none': 'None',
        'controls.cancel': 'Cancel',
        'controls.searching': 'Searching tickers…',

        'chain.expirations': 'expiration',
        'chain.expirationsPlural': 'expirations',
        'chain.collapseAll': 'Collapse all',
        'chain.expandAll': 'Expand all',
        'chain.calls': 'Calls',
        'chain.puts': 'Puts',
        'chain.strike': 'Strike',
        'chain.strikeSymbol': '$',
        'chain.strikes': '{{count}} strikes',

        'spot.label': 'Spot',
        'spot.estimated': '(est.)',
        'spot.delayed': '· delayed · {{provider}}',

        'loading.expirations': 'Fetching expirations…',
        'loading.chain': 'Loading chain…',

        'notice.cancelled': 'Request cancelled.',
        'notice.noOptions': '“{{symbol}}” is a valid ticker, but the latest local index marks it as (no options).',
        'notice.noContracts': 'No contracts returned for the selected expiration(s).',
        'notice.enterTicker': 'Enter a ticker and press',
        'notice.toBegin': 'to load its options.',
        'notice.pickExp': 'Pick one or more expirations above to see the chain.',
        'notice.toFetch': 'to fetch the chain.',

        'error.enterTicker': 'Enter a ticker symbol.',
        'error.noContracts': 'No option contracts found for “{{symbol}}”.',
        'error.providerBulk': 'Provider misconfigured (bulk without fetchAll).',
        'error.providerLazy': 'Provider misconfigured (lazy without fetchMeta).',
        'error.friendly.networkProxy':
            'Could not reach the proxy. To fix this:\n\n' +
            '1. Clone the repo: git clone https://github.com/daggerok/gex.git\n' +
            '2. Install dependencies: bun install -E\n' +
            '3. Run the proxy: bun ./scripts/options-local-proxy.ts\n' +
            '4. Set Proxy base URL in Settings to http://localhost:8787\n\n' +
            'Or deploy scripts/options-cloudflare-proxy.js and set the Worker URL instead.\n\n' +
            'See docs/README.en.md for detailed instructions.',
        'error.friendly.networkCors':
            'Network/CORS error reaching the proxy. Try a different CORS proxy in Settings, or use CACHE (static data).',
        'error.friendly.networkGeneric':
            'Network error — could not reach the data provider. Check your connection and try again.',
        'error.friendly.unexpectedJson':
            'The provider returned an unexpected (non-JSON) response — often a proxy error page. Switch the proxy or provider in Settings.',
        'error.friendly.generic': 'Something went wrong while loading option data.',

        'retry': 'Retry',
        'expired': 'expired',
        'noOptions': '(no options)',
        'tickerFromIndex': 'Ticker from local index',
        'validTickerFromIndex': 'Valid ticker from local index',

        'tabs.label': 'Views',
        'tabs.desk': 'Desk',
        'tabs.gex': 'GEX',
        'tabs.chart': 'Chart',
        'tabs.stub.gex': 'GEX view coming soon.',
        'tabs.stub.chart': 'Chart view coming soon.',


        'gex.na': '-',
        'gex.unit': '$/1%',
        'gex.sidebar.totalCallOi': 'Total Call OI',
        'gex.sidebar.totalPutOi': 'Total Put OI',
        'gex.sidebar.totalNetGex': 'Total Net GEX',
        'gex.sidebar.regime': 'Regime',
        'gex.sidebar.keyLevels': 'Levels',
        'gex.sidebar.metrics': 'Metrics',
        'gex.values.title': 'Values',
        'gex.values.level': 'Level',
        'gex.values.strike': 'Strike',
        'gex.values.nearest': 'Spot or Gamma Flip is not on a strike: the nearest strike is shown',
        'gex.sidebar.totalCallVolume': 'Total Call Volume',
        'gex.sidebar.totalAg': 'Total AG',
        'gex.sidebar.totalPutVolume': 'Total Put Volume',
        'gex.sidebar.pcRatioOi': 'P/C Ratio by OI',
        'gex.sidebar.pcRatioVolume': 'P/C Ratio by Volume',
        'gex.regime.positive': 'Positive gamma',
        'gex.regime.negative': 'Negative gamma',
        'gex.regime.neutral': 'Neutral',
        'gex.level.maxNetGex': 'Max Net GEX',
        'gex.level.netGexPlus': 'Net GEX+',
        'gex.level.gammaFlip': 'Gamma Flip',
        'gex.level.minNetGex': 'Min Net GEX',
        'gex.level.netGexMinus': 'Net GEX-',
        'gex.level.sumNetGexPlus': '75% Sum Net GEX+',
        'gex.level.sumNetGexMinus': '75% Sum Net GEX-',
        'gex.level.maxPain': 'Max Pain',
        'gex.metric.label': 'Metrics',
        'gex.metric.netGex': 'Net GEX',
        // Short "AG" abbreviation for the toggle chip itself (matches the
        // reference tool's own abbreviation); 'gex.metric.absoluteGammaFull'
        // below spells out "Absolute Gamma" wherever there's room (chart
        // title, legend, hover-tooltip rows) - see GexView.tsx's
        // metricLabelFull.
        'gex.metric.absoluteGamma': 'AG',
        'gex.metric.absoluteGammaFull': 'Absolute Gamma',
        'gex.metric.callOi': 'Call OI',
        'gex.metric.putOi': 'Put OI',
        'gex.metric.callVolume': 'Call Volume',
        'gex.metric.putVolume': 'Put Volume',
        'gex.metric.pcRatioOi': 'P/C OI',
        'gex.metric.pcRatioVolume': 'P/C Volume',
        'gex.chart.title': '{{metric}} by strike (selected expirations)',
        'gex.chart.titleMulti': '{{metrics}} by strike (selected expirations)',
        'gex.chart.spot': 'Spot',
        'gex.chart.maxNetGex': 'Max Net GEX',
        'gex.chart.minNetGex': 'Min Net GEX',
        'gex.chart.netGexPlus': 'Net GEX+',
        'gex.chart.gammaFlip': 'Gamma Flip',
        'gex.chart.netGexMinus': 'Net GEX-',
        'gex.chart.sumNetGexPlus': '75% Sum Net GEX+',
        'gex.chart.sumNetGexMinus': '75% Sum Net GEX-',
        'gex.chart.maxPain': 'Max Pain',
        'gex.chart.zeroLine': 'Zero GEX',
        'gex.zoom.resetH': 'Reset Horizontal Zoom',
        'gex.zoom.panLeft': 'Move Left',
        'gex.zoom.panRight': 'Move Right',
        'gex.zoom.xIn': 'Horizontal Zoom In',
        'gex.zoom.xOut': 'Horizontal Zoom Out',
        'gex.zoom.hint': 'Drag on the chart to zoom into a strike range.',
        'gex.metric.reset': 'Reset',
        'gex.metric.color': '{{metric}} color',
        'gex.metric.colorNetGexPos': 'Net GEX (+) color',
        'gex.metric.colorNetGexNeg': 'Net GEX (−) color',
        'gex.level.reset': 'Reset',
        'gex.level.color': '{{level}} color',

        // Hover tooltips (native title attr) for the Metrics panel buttons and
        // the Key Levels panel entries - plain-language explanations for a
        // non-programmer trader, not implementation detail.
        'gex.metric.tooltip.netGex': 'Net dollar gamma exposure at this strike: calls minus puts, where each side\'s GEX = gamma x open interest x 100 x spot^2 x 0.01. Calls add positively, puts subtract; the result estimates how many dollars of hedging flow dealers would need to transact here for every 1% move in the underlying.',
        'gex.metric.tooltip.absoluteGamma': 'Absolute Gamma (AG): total gamma exposure at this strike regardless of direction - |Call GEX| + |Put GEX|, with no cancellation between calls and puts (unlike Net GEX, which nets them). A strike with a large AG is a strong support/resistance/pinning magnet even if its net GEX is small. Plotted on its own right-hand axis since AG is always a much larger, always-positive number than the signed metrics sharing the left axis.',
        'gex.metric.tooltip.callOi': 'Total open interest for calls at this strike - the open-interest field from every call contract at that strike, summed across the selected expirations. Counts outstanding contracts, not shares or dollars.',
        'gex.metric.tooltip.putOi': 'Total open interest for puts at this strike - the open-interest field from every put contract at that strike, summed across the selected expirations. Counts outstanding contracts, not shares or dollars.',
        'gex.metric.tooltip.callVolume': 'Total contracts traded today for calls at this strike - the volume field from every call contract at that strike, summed across the selected expirations.',
        'gex.metric.tooltip.putVolume': 'Total contracts traded today for puts at this strike - the volume field from every put contract at that strike, summed across the selected expirations.',
        'gex.metric.tooltip.pcRatioOi': 'Put/call ratio of open interest at this strike: put OI divided by call OI. Blank where the strike has no call OI. Plotted on its own axis and capped at 5 for readability, the hover shows the real value.',
        'gex.metric.tooltip.pcRatioVolume': 'Put/call ratio of today\'s volume at this strike: put volume divided by call volume. Blank where the strike has no call volume. Plotted on its own axis and capped at 5 for readability, the hover shows the real value.',
        'gex.level.tooltip.maxNetGex': 'The strike with the single largest positive Net GEX among call-dominated strikes (netGex > 0). Dealers hedging a large long-gamma position here tend to buy as price falls and sell as it rises, which can act as resistance.',
        'gex.level.tooltip.minNetGex': 'The strike with the largest-magnitude negative Net GEX among put-dominated strikes (netGex < 0). Dealer hedging here tends to work the opposite way, which can act as support.',
        'gex.level.tooltip.netGexPlus': 'The strongest positive Net GEX strike above the Max Net GEX strike and at least a minimum distance away from it (3% of spot by default, a flat $ amount for some symbols such as SPY). This "second wall" rule is this app\'s own heuristic, not an industry standard - treat it as a rough secondary marker, not a precise level.',
        'gex.level.tooltip.netGexMinus': 'The strongest negative Net GEX strike below the Min Net GEX strike and at least a minimum distance away from it (3% of spot by default, a flat $ amount for some symbols such as SPY). This "second wall" rule is this app\'s own heuristic, not an industry standard - treat it as a rough secondary marker, not a precise level.',
        'gex.level.tooltip.sumNetGexPlus': 'Original heuristic, not an industry standard. Starting at spot and moving right (up in price), the strike where the running sum of positive Net GEX reaches 75% of all positive Net GEX at or above spot, for the selected expirations. Roughly where most of the positive gamma above spot is enclosed.',
        'gex.level.tooltip.sumNetGexMinus': 'Original heuristic, not an industry standard. Starting at spot and moving left (down in price), the strike where the running sum of negative Net GEX (by magnitude) reaches 75% of all negative Net GEX at or below spot, for the selected expirations. Roughly where most of the negative gamma below spot is enclosed.',
        'gex.level.tooltip.gammaFlip': 'The hypothetical underlying price where dealers\' modeled aggregate gamma would flip sign: every option\'s gamma is recomputed as if the price were there, summed across the chain, and this is where that sum crosses zero. Above it, dealer hedging tends to dampen price moves; below it, hedging tends to reinforce them.',
        'gex.level.tooltip.maxPain': 'The strike where option sellers\' total payout to holders would be smallest if the underlying settled there at expiration. For each candidate strike S: call payout = OI x max(0, price - S), put payout = OI x max(0, S - price), summed across all contracts; Max Pain is the S that minimizes this sum.',
        'gex.level.tooltip.spot': 'The spot price the Levels were computed against - every other level\'s position is read relative to this one.',
        'gex.level.tooltip.spotEstimated': 'The spot price the Levels were computed against - every other level\'s position is read relative to this one. The provider did not report the underlying price directly for this chain, so it is estimated via put-call parity from the nearest selected expiration instead.',

        'gex.empty.noData': 'Enter a ticker and press Enter to analyze its gamma exposure.',
        'gex.empty.noSelection': 'Select at least one expiration.',
        'gex.empty.noGamma': 'No gamma data for the selected expirations (this provider may not supply greeks or IV).',
        'gex.empty.futuresPriced': 'GEX analysis is not available for {{symbol}} (futures-priced, not supported by the current model).',
        'gex.futuresPricedHint': '{{symbol}} is futures-priced: these levels are computed per-expiration against each quote\'s own Black-76 forward, not a single spot price.',
        'gex.lazyHint': 'YAHOO loads one expiration at a time: all dates are fetched in the background once the ticker is found, and a date you click shows its data as soon as it is ready.',

        'chart.range.label': 'Range',
        'chart.range.1mo': '1M',
        'chart.range.3mo': '3M',
        'chart.range.6mo': '6M',
        'chart.range.1y': '1Y',
        'chart.interval': 'Daily candles',
        'chart.loading': 'Loading price history…',
        'chart.error': 'Could not load price history: {{error}}',
        'chart.proxyHint': 'The Chart tab needs the companion proxy on every provider, CACHE included (Settings -> Proxy base URL).',
        'chart.empty.noData': 'Enter a ticker and press Enter to chart its price with GEX levels.',
        'chart.empty.noBars': 'No price history returned for {{symbol}}.',
        'chart.levels.source': 'GEX levels from the GEX tab selection ({{count}} exp.):',
        'chart.levels.none': 'none (no gamma data for the selected expirations)',
        'chart.levels.futuresPriced': 'not available for {{symbol}} (futures-priced, not supported by the current model)',
        'chart.levels.futuresPricedHint': '(futures-terms levels - per-expiration forward, not spot)',
    },
    ru: {
        'app.brand': 'GEX',
        'app.title': 'GEX',

        'topBar.api': 'API',
        'topBar.settings': 'Настройки',
        'topBar.debug': 'Отладка',
        'topBar.proxy': 'Статус прокси',
        'topBar.proxyDisabled': 'отключено в режиме CACHE',
        'topBar.cache': 'CACHE (статика)',
        'topBar.live': 'LIVE (прокси)',
        'topBar.search': 'Поиск / загрузка',
        'topBar.ticker': 'Тикер',
        'topBar.language': 'Язык',

        'language.en': 'English',
        'language.ru': 'Русский',
        'language.icon': '🌐',

        'theme.light': 'Светлая',
        'theme.system': 'Системная',
        'theme.dark': 'Тёмная',

        'settings.title': 'Настройки',
        'settings.provider': 'Провайдер данных',
        'settings.providerHint': 'Также доступен в шапке для быстрого доступа.',
        'settings.theme': 'Тема',
        'settings.themeHint': 'Также доступна в шапке для быстрого доступа.',
        'settings.colorTheme': 'Цветовая палитра',
        'settings.colorThemeHint': 'Общая с Fundamentals — единый UI при будущем слиянии.',
        'colorTheme.fundamentals': 'Изумрудный Ledger',
        'colorTheme.gex': 'Индиго Desk',
        'settings.language': 'Язык',
        'settings.languageHint': 'Также доступен в шапке для быстрого доступа.',
        'settings.apiKey': 'API ключ',
        'settings.apiSecret': 'API секрет',
        'settings.getKey': 'Получить бесплатный ключ',
        'settings.keyHint': 'Хранится только в браузере (localStorage).',
        'settings.proxyBase': 'Базовый URL прокси',
        'settings.proxyBaseHint': 'Запусти bun ./scripts/options-local-proxy.ts локально или задеплой scripts/options-cloudflare-proxy.js.',
        'settings.proxyBasePlaceholder': 'http://localhost:8787 или https://name.you.workers.dev',
        'settings.corsProxy': 'CORS прокси',
        'settings.corsProxyHint': 'Публичные прокси могут быть нестабильны — переключайся при сбоях или используй свой Worker.',
        'settings.workerUrl': 'URL Worker',
        'settings.workerUrlPlaceholder': 'https://name.you.workers.dev',

        'settings.deskColumns': 'Колонки доски',
        'settings.deskColumns.calls': 'Коллы',
        'settings.deskColumns.puts': 'Путы',
        'settings.deskColumns.openInterest': 'Открытый интерес (ОИ)',
        'settings.deskColumns.volume': 'Объём',
        'settings.deskColumns.iv': 'Подразумеваемая волатильность (IV)',
        'settings.deskColumns.delta': 'Дельта Δ',
        'settings.deskColumns.gamma': 'Гамма Γ',
        'settings.deskColumns.theta': 'Тета Θ',
        'settings.deskColumns.vega': 'Вега',
        'settings.deskColumns.rho': 'Ро ρ',
        'settings.deskColumns.lambda': 'Лямбда λ',
        'settings.deskColumns.vanna': 'Ванна',
        'settings.deskColumns.vomma': 'Вомма',
        'settings.deskColumns.charm': 'Чарм',
        'settings.deskColumns.speed': 'Спид',
        'settings.deskColumns.zomma': 'Зомма',
        'settings.deskColumns.color': 'Колор',
        'settings.deskColumns.bid': 'Бид (спрос)',
        'settings.deskColumns.mid': 'Мид (середина)',
        'settings.deskColumns.ask': 'Аск (предложение)',
        'settings.deskColumns.note': 'Бид / Мид / Аск и Страйк всегда видны. Ро отключён по умолчанию.',

        'deskColumns.header.openInterest': 'ОИ',
        'deskColumns.header.volume': 'Объём',
        'deskColumns.header.iv': 'IV',
        'deskColumns.header.delta': 'Δ',
        'deskColumns.header.gamma': 'Γ',
        'deskColumns.header.theta': 'Θ',
        'deskColumns.header.vega': 'Вега',
        'deskColumns.header.rho': 'ρ',
        'deskColumns.header.lambda': 'λ',
        'deskColumns.header.vanna': 'Ванна',
        'deskColumns.header.vomma': 'Вомма',
        'deskColumns.header.charm': 'Чарм',
        'deskColumns.header.speed': 'Спид',
        'deskColumns.header.zomma': 'Зомма',
        'deskColumns.header.color': 'Колор',
        'deskColumns.header.bid': 'Бид',
        'deskColumns.header.mid': 'Мид',
        'deskColumns.header.ask': 'Аск',

        'settings.vixFuturesPricing': 'Гриски VIX по фьючерсам (экспериментально)',
        'settings.vixFuturesPricing.hint': 'Модель Black-76 для опционов VIX/VXN. Пока не подключена — переключатель ни на что не влияет.',

        'settings.cache': 'Кэш',
        'settings.cache.records': 'Записей данных',
        'settings.cache.dataSize': 'Размер данных',
        'settings.cache.settingsSize': 'Размер настроек',
        'settings.cache.oldest': 'Самая старая запись',
        'settings.cache.newest': 'Самая новая запись',
        'settings.cache.clearData': 'Очистить данные',
        'settings.cache.clearDataHint': 'Только загруженные результаты запросов',
        'settings.cache.clearSettings': 'Очистить настройки',
        'settings.cache.clearSettingsHint': 'Провайдер / тема / палитра / язык / ключи / прокси / колонки',
        'settings.cache.clearAll': 'Очистить всё',
        'settings.cache.clearAllHint': 'Данные + настройки (полный сброс)',
        'settings.cache.confirm': 'Подтвердить?',
        'settings.cache.confirmHelp': 'Нажми «Подтвердить?» ещё раз, чтобы продолжить, или клни вне кнопки для отмены.',

        'setupBadge.noSetup': 'Без настройки',
        'setupBadge.freeKey': 'Бесплатный ключ',
        'setupBadge.keySet': 'Ключ задан',
        'setupBadge.needsProxy': 'Нужен прокси',

        'providerDescription.static':
            'Локальный статический кэш — same-origin data/options/{TICKER}.json (GitHub Action + yfinance + CBOE/BS греки). ' +
            'Без прокси и ключей. Лучший default для GitHub Pages. Показываются только закэшированные тикеры.',
        'providerDescription.yahoo':
            'Yahoo Finance через прокси (/api/options) — crumb/cookie обрабатывают scripts/options-local-proxy.ts или Cloudflare Worker. ' +
            'Lazy по expiration. Нет провайдерских греков; клиентский Black-Scholes считает их при наличии IV.',
        'providerDescription.nasdaq':
            'Цепочка NASDAQ через прокси (/api/nasdaq) — полная цепочка за один запрос (bid/ask/last/volume/OI). ' +
            'Нет IV/греков в фиде (higher-order остаются пустыми). Нужен Proxy base URL.',
        'providerDescription.cboe':
            'CBOE delayed options через прокси (/api/cboe) — акции и индексы, греки/IV/OI + spot. ' +
            'Default на localhost, если прокси доступен. Нужен Proxy base URL.',

        'onboarding.title': 'Один простой шаг: добавь бесплатный {{keys}} для {{provider}}',
        'onboarding.description': '{{hint}}',
        'onboarding.getKey': 'Получить бесплатный ключ',
        'onboarding.save': 'Сохранить {{keys}} и загрузить',
        'onboarding.saved': 'Ключи уже сохранены — просто введи тикер выше.',
        'onboarding.keys': 'ключи',
        'onboarding.key': 'ключ',
        'onboarding.previewDemo': 'или получить даты для {{symbol}} прямо сейчас (без ключа)',
        'onboarding.previewCache': 'или переключиться на CACHE (статичные данные AAPL)',

        'controls.tickerPlaceholder': 'Тикер или компания (например, AAPL, Tesla, SPX)',
        'controls.expirations': 'Экспирации',
        'controls.loading': 'Загрузка…',
        'controls.reset': 'Сбросить',
        'controls.resetTooltip': 'Вернуться к ближайшей экспирации. Данные загружаются сразу по клику на дату.',
        'controls.enterKey': 'Enter',
        'controls.all': 'Все',
        'controls.none': 'Нет',
        'controls.cancel': 'Отмена',
        'controls.searching': 'Ищем тикеры…',

        'chain.expirations': 'экспирация',
        'chain.expirationsPlural': 'экспираций',
        'chain.collapseAll': 'Свернуть все',
        'chain.expandAll': 'Развернуть все',
        'chain.calls': 'Коллы',
        'chain.puts': 'Путы',
        'chain.strike': 'Страйк',
        'chain.strikeSymbol': '$',
        'chain.strikes': '{{count}} страйков',

        'spot.label': 'Спот',
        'spot.estimated': '(оценка)',
        'spot.delayed': '· с задержкой · {{provider}}',

        'loading.expirations': 'Загружаем экспирации…',
        'loading.chain': 'Загружаем цепочку…',

        'notice.cancelled': 'Запрос отменён.',
        'notice.noOptions': '«{{symbol}}» — валидный тикер, но последний локальный индекс помечает его как (no options).',
        'notice.noContracts': 'По выбранным экспирациям не вернулось контрактов.',
        'notice.enterTicker': 'Введи тикер и нажми',
        'notice.toBegin': 'чтобы загрузить опционы.',
        'notice.pickExp': 'Выбери одну или несколько экспираций выше, чтобы увидеть цепочку.',
        'notice.toFetch': 'и цепочка загрузится.',

        'error.enterTicker': 'Введи тикер.',
        'error.noContracts': 'Для «{{symbol}}» не найдено опционных контрактов.',
        'error.providerBulk': 'Провайдер настроен неверно (bulk без fetchAll).',
        'error.providerLazy': 'Провайдер настроен неверно (lazy без fetchMeta).',
        'error.friendly.networkProxy':
            'Не удалось достучаться до прокси. Чтобы исправить:\n\n' +
            '1. Клонируй репозиторий: git clone https://github.com/daggerok/gex.git\n' +
            '2. Установи зависимости: bun install -E\n' +
            '3. Запусти прокси: bun ./scripts/options-local-proxy.ts\n' +
            '4. Укажи Proxy base URL в настройках: http://localhost:8787\n\n' +
            'Или задеплой scripts/options-cloudflare-proxy.js и укажи URL Worker.\n\n' +
            'Подробности — в docs/README.en.md.',
        'error.friendly.networkCors':
            'Ошибка сети/CORS при обращении к прокси. Попробуй другой CORS-прокси в настройках или используй CACHE (статичные данные).',
        'error.friendly.networkGeneric':
            'Сетевая ошибка — не удалось достучаться до провайдера данных. Проверь соединение и попробуй снова.',
        'error.friendly.unexpectedJson':
            'Провайдер вернул неожиданный (не-JSON) ответ — часто это страница ошибки прокси. Переключи прокси или провайдера в настройках.',
        'error.friendly.generic': 'Что-то пошло не так при загрузке данных об опционах.',

        'retry': 'Повторить',
        'expired': 'истёк',
        'noOptions': '(нет опционов)',
        'tickerFromIndex': 'Тикер из локального индекса',
        'validTickerFromIndex': 'Валидный тикер из локального индекса',

        'tabs.label': 'Представления',
        'tabs.desk': 'Деск',
        'tabs.gex': 'GEX',
        'tabs.chart': 'График',
        'tabs.stub.gex': 'Экран GEX скоро появится.',
        'tabs.stub.chart': 'Экран графика скоро появится.',


        'gex.na': '-',
        'gex.unit': '$/1%',
        'gex.sidebar.totalCallOi': 'Всего ОИ коллов',
        'gex.sidebar.totalPutOi': 'Всего ОИ путов',
        'gex.sidebar.totalNetGex': 'Суммарный нетто GEX',
        'gex.sidebar.regime': 'Режим',
        'gex.sidebar.keyLevels': 'Уровни',
        'gex.sidebar.metrics': 'Метрики',
        'gex.values.title': 'Значения',
        'gex.values.level': 'Уровень',
        'gex.values.strike': 'Страйк',
        'gex.values.nearest': 'Спот или Gamma Flip не лежит на страйке: показан ближайший страйк',
        'gex.sidebar.totalCallVolume': 'Всего объём коллов',
        'gex.sidebar.totalAg': 'Всего AG',
        'gex.sidebar.totalPutVolume': 'Всего объём путов',
        'gex.sidebar.pcRatioOi': 'P/C по ОИ',
        'gex.sidebar.pcRatioVolume': 'P/C по объёму',
        'gex.regime.positive': 'Положительная гамма',
        'gex.regime.negative': 'Отрицательная гамма',
        'gex.regime.neutral': 'Нейтральный',
        'gex.level.maxNetGex': 'Max Net GEX',
        'gex.level.netGexPlus': 'Net GEX+',
        'gex.level.gammaFlip': 'Гамма-флип',
        'gex.level.minNetGex': 'Min Net GEX',
        'gex.level.netGexMinus': 'Net GEX-',
        'gex.level.sumNetGexPlus': '75% Sum Net GEX+',
        'gex.level.sumNetGexMinus': '75% Sum Net GEX-',
        'gex.level.maxPain': 'Макс. боль (Max Pain)',
        'gex.metric.label': 'Метрики',
        'gex.metric.netGex': 'Нетто GEX',
        'gex.metric.absoluteGamma': 'AG',
        'gex.metric.absoluteGammaFull': 'Абсолютная гамма',
        'gex.metric.callOi': 'ОИ коллов',
        'gex.metric.putOi': 'ОИ путов',
        'gex.metric.callVolume': 'Объём коллов',
        'gex.metric.putVolume': 'Объём путов',
        'gex.metric.pcRatioOi': 'P/C ОИ',
        'gex.metric.pcRatioVolume': 'P/C объём',
        'gex.chart.title': '{{metric}} по страйкам (выбранные экспирации)',
        'gex.chart.titleMulti': '{{metrics}} по страйкам (выбранные экспирации)',
        'gex.chart.spot': 'Спот',
        'gex.chart.maxNetGex': 'Max Net GEX',
        'gex.chart.minNetGex': 'Min Net GEX',
        'gex.chart.netGexPlus': 'Net GEX+',
        'gex.chart.gammaFlip': 'Гамма-флип',
        'gex.chart.netGexMinus': 'Net GEX-',
        'gex.chart.sumNetGexPlus': '75% Sum Net GEX+',
        'gex.chart.sumNetGexMinus': '75% Sum Net GEX-',
        'gex.chart.maxPain': 'Макс. боль (Max Pain)',
        'gex.chart.zeroLine': 'Нулевой GEX',
        'gex.zoom.resetH': 'Сбросить горизонтальный масштаб',
        'gex.zoom.panLeft': 'Сдвиг влево',
        'gex.zoom.panRight': 'Сдвиг вправо',
        'gex.zoom.xIn': 'Увеличить по горизонтали',
        'gex.zoom.xOut': 'Уменьшить по горизонтали',
        'gex.zoom.hint': 'Потяни по графику, чтобы приблизить диапазон страйков.',
        'gex.metric.reset': 'Сбросить',
        'gex.metric.color': 'Цвет: {{metric}}',
        'gex.metric.colorNetGexPos': 'Цвет Нетто GEX (+)',
        'gex.metric.colorNetGexNeg': 'Цвет Нетто GEX (−)',
        'gex.level.reset': 'Сбросить',
        'gex.level.color': 'Цвет: {{level}}',

        'gex.metric.tooltip.netGex': 'Нетто-долларовая гамма-экспозиция на этом страйке: коллы минус путы, где GEX каждой стороны = гамма x открытый интерес x 100 x спот^2 x 0.01. Коллы добавляют с плюсом, путы — с минусом; результат показывает, сколько долларов хеджирующего потока потребуется дилерам на каждый 1% движения базового актива.',
        'gex.metric.tooltip.absoluteGamma': 'Абсолютная гамма (AG): суммарная гамма-экспозиция на этом страйке независимо от направления — |GEX коллов| + |GEX путов|, без взаимной компенсации коллов и путов (в отличие от Нетто GEX, где они вычитаются). Страйк с большим AG — сильный магнит поддержки/сопротивления/прижатия цены, даже если его нетто GEX невелик. Отображается на собственной правой оси, так как AG — всегда намного большее и всегда положительное число по сравнению со знаковыми метриками на левой оси.',
        'gex.metric.tooltip.callOi': 'Суммарный открытый интерес коллов на этом страйке — поле открытого интереса каждого контракта-колла на этом страйке, просуммированное по выбранным экспирациям. Считает контракты, а не акции или доллары.',
        'gex.metric.tooltip.putOi': 'Суммарный открытый интерес путов на этом страйке — поле открытого интереса каждого контракта-пута на этом страйке, просуммированное по выбранным экспирациям. Считает контракты, а не акции или доллары.',
        'gex.metric.tooltip.callVolume': 'Суммарный объём торгов коллами на этом страйке за сегодня — поле объёма каждого контракта-колла на этом страйке, просуммированное по выбранным экспирациям.',
        'gex.metric.tooltip.putVolume': 'Суммарный объём торгов путами на этом страйке за сегодня — поле объёма каждого контракта-пута на этом страйке, просуммированное по выбранным экспирациям.',
        'gex.metric.tooltip.pcRatioOi': 'Отношение открытого интереса путов к коллам на этом страйке: ОИ путов, делённый на ОИ коллов. Пусто, если у страйка нет ОИ коллов. Рисуется на своей оси и обрезается на 5 для читаемости, настоящее значение видно во всплывающей подсказке.',
        'gex.metric.tooltip.pcRatioVolume': 'Отношение сегодняшнего объёма путов к коллам на этом страйке: объём путов, делённый на объём коллов. Пусто, если у страйка нет объёма коллов. Рисуется на своей оси и обрезается на 5 для читаемости, настоящее значение видно во всплывающей подсказке.',
        'gex.level.tooltip.maxNetGex': 'Страйк с максимальным положительным Net GEX среди страйков с преобладанием коллов (netGex > 0). Дилеры, хеджирующие здесь крупную длинную гамма-позицию, обычно покупают при падении цены и продают при росте — это может работать как сопротивление.',
        'gex.level.tooltip.minNetGex': 'Страйк с максимальным по модулю отрицательным Net GEX среди страйков с преобладанием путов (netGex < 0). Хеджирование дилеров здесь работает в обратную сторону — это может работать как поддержка.',
        'gex.level.tooltip.netGexPlus': 'Самый сильный страйк с положительным Net GEX выше страйка Max Net GEX и не ближе минимального расстояния от него (по умолчанию 3% от спота, для некоторых тикеров, например SPY, фиксированная сумма в $). Это правило «второй стены» — собственная эвристика приложения, а не отраслевой стандарт; воспринимай её как грубый вторичный ориентир, а не точный уровень.',
        'gex.level.tooltip.netGexMinus': 'Самый сильный страйк с отрицательным Net GEX ниже страйка Min Net GEX и не ближе минимального расстояния от него (по умолчанию 3% от спота, для некоторых тикеров, например SPY, фиксированная сумма в $). Это правило «второй стены» — собственная эвристика приложения, а не отраслевой стандарт; воспринимай её как грубый вторичный ориентир, а не точный уровень.',
        'gex.level.tooltip.sumNetGexPlus': 'Собственная эвристика, а не отраслевой стандарт. От спота вправо (вверх по цене): страйк, на котором накопленная сумма положительного Net GEX достигает 75% всего положительного Net GEX на споте и выше, по выбранным экспирациям. Примерно там, где заканчивается основная масса положительной гаммы над спотом.',
        'gex.level.tooltip.sumNetGexMinus': 'Собственная эвристика, а не отраслевой стандарт. От спота влево (вниз по цене): страйк, на котором накопленная сумма отрицательного Net GEX (по модулю) достигает 75% всего отрицательного Net GEX на споте и ниже, по выбранным экспирациям. Примерно там, где заканчивается основная масса отрицательной гаммы под спотом.',
        'gex.level.tooltip.gammaFlip': 'Гипотетическая цена базового актива, при которой суммарная модельная гамма дилеров сменила бы знак: гамма каждого опциона пересчитывается так, будто цена там, суммируется по всей цепочке, и это точка, где эта сумма пересекает ноль. Выше неё хеджирующий поток дилеров склонен сглаживать движение цены; ниже — усиливать его.',
        'gex.level.tooltip.maxPain': 'Страйк, при котором суммарная выплата продавцов опционов держателям была бы минимальной, если бы базовый актив экспирировался на этом уровне. Для каждого страйка-кандидата S: выплата по коллам = OI x max(0, цена - S), выплата по путам = OI x max(0, S - цена), сумма по всем контрактам; Max Pain — это S, минимизирующий эту сумму.',
        'gex.level.tooltip.spot': 'Спот-цена, относительно которой рассчитаны уровни — положение каждого другого уровня читается относительно неё.',
        'gex.level.tooltip.spotEstimated': 'Спот-цена, относительно которой рассчитаны уровни — положение каждого другого уровня читается относительно неё. Провайдер не предоставил цену базового актива напрямую для этой цепочки, поэтому она оценена через пут-колл паритет по ближайшей выбранной экспирации.',

        'gex.empty.noData': 'Введи тикер и нажми Enter, чтобы проанализировать гамма-экспозицию.',
        'gex.empty.noSelection': 'Выбери хотя бы одну экспирацию.',
        'gex.empty.noGamma': 'Нет данных по гамме для выбранных экспираций (провайдер может не отдавать греки или IV).',
        'gex.empty.futuresPriced': 'Анализ GEX недоступен для {{symbol}} (цена определяется фьючерсами, текущая модель это не поддерживает).',
        'gex.futuresPricedHint': '{{symbol}} торгуется от фьючерсов: эти уровни считаются по каждой экспирации отдельно, от её собственного форварда по модели Black-76, а не от единого спота.',
        'gex.lazyHint': 'YAHOO загружает экспирации по одной: все даты подгружаются в фоне, как только тикер найден, а выбранная дата показывает данные, как только они готовы.',

        'chart.range.label': 'Период',
        'chart.range.1mo': '1М',
        'chart.range.3mo': '3М',
        'chart.range.6mo': '6М',
        'chart.range.1y': '1Г',
        'chart.interval': 'Дневные свечи',
        'chart.loading': 'Загрузка истории цен…',
        'chart.error': 'Не удалось загрузить историю цен: {{error}}',
        'chart.proxyHint': 'Вкладке «График» нужен прокси для любого провайдера, включая CACHE (Настройки -> Базовый URL прокси).',
        'chart.empty.noData': 'Введи тикер и нажми Enter, чтобы построить график цены с уровнями GEX.',
        'chart.empty.noBars': 'Нет истории цен для {{symbol}}.',
        'chart.levels.source': 'Уровни GEX по выбору на вкладке GEX ({{count}} эксп.):',
        'chart.levels.none': 'нет (нет данных по гамме для выбранных экспираций)',
        'chart.levels.futuresPriced': 'недоступно для {{symbol}} (цена определяется фьючерсами, текущая модель это не поддерживает)',
        'chart.levels.futuresPricedHint': '(уровни во фьючерсных терминах - форвард по экспирации, не спот)',
    },
};

export function translate(key: string, lang: Language, params?: Record<string, string | number>): string {
    const dict = translations[lang] ?? translations[DEFAULT_LANGUAGE];
    let text = dict[key] ?? translations[DEFAULT_LANGUAGE][key] ?? key;
    if (params) {
        Object.entries(params).forEach(([k, v]) => {
            text = text.split(`{{${k}}}`).join(String(v));
        });
    }
    return text;
}

export function providerDescription(providerId: string, lang: Language): string {
    return translate(`providerDescription.${providerId}`, lang);
}

export interface I18nContextValue {
    lang: Language;
    t: (key: string, params?: Record<string, string | number>) => string;
    setLang: (lang: Language) => void;
}

export const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export const I18nProvider: React.FC<{ initial: Language; children: React.ReactNode }> = ({ initial, children }) => {
    const [lang, setLang] = useState<Language>(LANGUAGES.includes(initial) ? initial : DEFAULT_LANGUAGE);
    useEffect(() => {
        document.documentElement.lang = lang;
        document.documentElement.dir = 'ltr';
    }, [lang]);

    const t = useCallback(
        (key: string, params?: Record<string, string | number>) => translate(key, lang, params),
        [lang],
    );

    return <I18nContext.Provider value={{ lang, t, setLang }}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
    const ctx = useContext(I18nContext);
    if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
    return ctx;
}
