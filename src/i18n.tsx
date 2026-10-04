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
        'controls.load': 'Load',
        'controls.loadCount': 'Load ({{count}})',
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
        'notice.toBegin': 'to begin.',
        'notice.pickExp': 'Pick one or more expirations and press',
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
        'gex.sidebar.oiVolume': 'OI Volume',
        'gex.sidebar.totalCallOi': 'Total Call OI',
        'gex.sidebar.totalPutOi': 'Total Put OI',
        'gex.sidebar.gexAnalysis': 'GEX Analysis',
        'gex.sidebar.totalNetGex': 'Total Net GEX',
        'gex.sidebar.regime': 'Regime',
        'gex.sidebar.keyLevels': 'Key Levels',
        'gex.sidebar.pcRatio': 'P/C Ratio',
        'gex.regime.positive': 'Positive gamma',
        'gex.regime.negative': 'Negative gamma',
        'gex.regime.neutral': 'Neutral',
        'gex.level.callWall': 'Call Wall (R1)',
        'gex.level.resistance2': 'Resistance 2',
        'gex.level.gammaFlip': 'Gamma Flip',
        'gex.level.putWall': 'Put Wall (S1)',
        'gex.level.support2': 'Support 2',
        'gex.level.maxPain': 'Max Pain',
        'gex.pcRatio.byOi': 'By OI',
        'gex.pcRatio.byVolume': 'By Volume',
        'gex.metric.label': 'Metric',
        'gex.metric.netGex': 'Net GEX',
        'gex.metric.callOi': 'Call OI',
        'gex.metric.putOi': 'Put OI',
        'gex.metric.callVolume': 'Call Volume',
        'gex.metric.putVolume': 'Put Volume',
        'gex.chart.title': '{{metric}} by strike (selected expirations)',
        'gex.chart.spot': 'Spot {{price}}',
        'gex.chart.callWall': 'Call Wall',
        'gex.chart.putWall': 'Put Wall',
        'gex.empty.noData': 'Enter a ticker and press Expirations to analyze its gamma exposure.',
        'gex.empty.noSelection': 'Select at least one expiration.',
        'gex.empty.noGamma': 'No gamma data for the selected expirations (this provider may not supply greeks or IV).',
        'gex.lazyHint': 'YAHOO loads one expiration at a time: only dates already loaded on the Desk tab are listed here.',
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
        'controls.load': 'Загрузить',
        'controls.loadCount': 'Загрузить ({{count}})',
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
        'notice.toBegin': 'для начала.',
        'notice.pickExp': 'Выбери одну или несколько экспираций и нажми',
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
        'gex.sidebar.oiVolume': 'ОИ и объём',
        'gex.sidebar.totalCallOi': 'Всего ОИ коллов',
        'gex.sidebar.totalPutOi': 'Всего ОИ путов',
        'gex.sidebar.gexAnalysis': 'Анализ GEX',
        'gex.sidebar.totalNetGex': 'Суммарный нетто GEX',
        'gex.sidebar.regime': 'Режим',
        'gex.sidebar.keyLevels': 'Ключевые уровни',
        'gex.sidebar.pcRatio': 'Коэффициент P/C',
        'gex.regime.positive': 'Положительная гамма',
        'gex.regime.negative': 'Отрицательная гамма',
        'gex.regime.neutral': 'Нейтральный',
        'gex.level.callWall': 'Стена коллов (R1)',
        'gex.level.resistance2': 'Сопротивление 2',
        'gex.level.gammaFlip': 'Гамма-флип',
        'gex.level.putWall': 'Стена путов (S1)',
        'gex.level.support2': 'Поддержка 2',
        'gex.level.maxPain': 'Макс. боль (Max Pain)',
        'gex.pcRatio.byOi': 'По ОИ',
        'gex.pcRatio.byVolume': 'По объёму',
        'gex.metric.label': 'Метрика',
        'gex.metric.netGex': 'Нетто GEX',
        'gex.metric.callOi': 'ОИ коллов',
        'gex.metric.putOi': 'ОИ путов',
        'gex.metric.callVolume': 'Объём коллов',
        'gex.metric.putVolume': 'Объём путов',
        'gex.chart.title': '{{metric}} по страйкам (выбранные экспирации)',
        'gex.chart.spot': 'Спот {{price}}',
        'gex.chart.callWall': 'Стена коллов',
        'gex.chart.putWall': 'Стена путов',
        'gex.empty.noData': 'Введи тикер и нажми «Экспирации», чтобы проанализировать гамма-экспозицию.',
        'gex.empty.noSelection': 'Выбери хотя бы одну экспирацию.',
        'gex.empty.noGamma': 'Нет данных по гамме для выбранных экспираций (провайдер может не отдавать греки или IV).',
        'gex.lazyHint': 'YAHOO загружает экспирации по одной: здесь показаны только даты, уже загруженные на вкладке «Деск».',
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
