import type { Language } from './i18n';

// ============================================================================
// DOMAIN TYPES
// ============================================================================

/** Source of greeks stored on a quote. `black-scholes` is a model estimate.
 *  `black-76` is the futures-priced model estimate for VIX/VXN (Phase 2 of
 *  .plans/gex-vix-futures-pricing-research.txt, opt-in via
 *  settings.vixFuturesPricing). Legacy static files may still carry
 *  `marketdata` / `dolthub` tags. */
export type GreeksSource = 'cboe' | 'black-scholes' | 'black-76' | 'marketdata' | 'dolthub' | null;

/** Top-level greeks enrichment summary written by scripts/options-data.py. */
export interface GreeksSummary {
    enabled?: boolean;
    primarySource?: string | null;
    fallbackSource?: string | null;
    riskFreeRate?: number | null;
    dividendYield?: number | null;
    total?: number;
    cboeMatched?: number;
    computed?: number;
    missing?: number;
    cboeContracts?: number;
}

/** A single normalized option contract quote (provider-agnostic shape). */
export interface OptionQuote {
    /** OCC-style option symbol, e.g. "AAPL260717C00110000". */
    symbol: string;
    /** ISO expiration date "YYYY-MM-DD". */
    expiration: string;
    /** Contract side. */
    side: 'call' | 'put';
    /** Strike price in dollars. */
    strike: number;
    bid: number | null;
    ask: number | null;
    /** Convenience mid = (bid+ask)/2 when both present. */
    mid: number | null;
    last: number | null;
    volume: number | null;
    openInterest: number | null;
    /** Implied volatility as a decimal (0.25 = 25%), when provided. */
    iv: number | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    /** Rho: sensitivity to interest rates (per 1pp rate change). */
    rho?: number | null;
    /** Lambda (Ω): leverage = delta * spot / option price. */
    lambda?: number | null;
    /** 2nd-order: dDelta/dVol (or dVega/dSpot). */
    vanna?: number | null;
    /** 2nd-order: dVega/dVol (volga). */
    vomma?: number | null;
    /** 2nd-order: dDelta/dTime (delta decay). */
    charm?: number | null;
    /** 3rd-order: dGamma/dSpot. */
    speed?: number | null;
    /** 3rd-order: dGamma/dVol. */
    zomma?: number | null;
    /** 3rd-order: dGamma/dTime. */
    color?: number | null;
    /** Where greeks came from, if known (cboe / black-scholes / …). */
    greeksSource?: GreeksSource;
    /** Why greeks are still missing after enrichment, if known. */
    greeksMissingReason?: string | null;
    /**
     * Per-expiration futures/forward price used to price this quote under
     * Black-76 (VIX/VXN only, when settings.vixFuturesPricing is on). Client
     * computed, never written by scripts/options-data.py or persisted to
     * data/options/*.json. Null/absent for every non-futures-priced quote.
     */
    forward?: number | null;
}

/** Lightweight chain metadata (expirations + spot) — the cheap first fetch. */
export interface ChainMeta {
    symbol: string;
    /** Spot price of the underlying, when the provider supplies it (else null). */
    underlyingPrice: number | null;
    /** Sorted unique list of ISO expirations available. */
    expirations: string[];
    /** Optional greeks enrichment summary for static-cache files. */
    greeks?: GreeksSummary;
}

/** Full chain result for a symbol (used internally by BULK providers). */
export interface ChainResult extends ChainMeta {
    /** All contracts across all expirations. */
    quotes: OptionQuote[];
}

/** Runtime context handed to a provider so it can honor user settings. */
export interface ProviderContext {
    /** CORS proxy template; "{url}" is replaced with the encoded target URL. */
    proxyTemplate: string;
    /** Base URL of a request-handling proxy (Yahoo/worker), e.g. localhost:8787. */
    proxyBase: string;
    /** Optional/required API token or key (provider-specific). */
    token: string;
    /** Optional/required API secret, for providers needing a KEY + SECRET pair
     *  (e.g. Alpaca: APCA-API-KEY-ID + APCA-API-SECRET-KEY). Stored locally. */
    secret: string;
    /** Abort signal so any in-flight request can be cancelled by the user. */
    signal?: AbortSignal;
}

/** How much setup a provider needs before it can serve the requested symbol. */
export type SetupKind = 'none' | 'key' | 'proxy';

/**
 * How a provider delivers data:
 *  - 'bulk': one request returns the entire chain (cached; per-expiration views
 *            are filtered from cache -> no extra requests).
 *  - 'lazy': list expirations first, then fetch each expiration on demand
 *            (required by APIs whose chain endpoint needs an expiration param).
 */
export type ProviderMode = 'bulk' | 'lazy';

/** Pluggable data source contract. Add new sources by implementing this. */
export interface DataProvider {
    id: string;
    /** Short label shown in the top-bar dropdown. */
    label: string;
    /** One-line human description shown in Settings / onboarding. */
    description: string;
    /** Delivery strategy (see ProviderMode). */
    mode: ProviderMode;
    /** Setup requirement classification (drives badges & onboarding). */
    setup: SetupKind;
    /** Whether this provider accepts an API key/token. */
    supportsToken: boolean;
    /**
     * Whether this provider ALSO needs a secret (KEY + SECRET pair), e.g. Alpaca
     * (APCA-API-KEY-ID + APCA-API-SECRET-KEY). Both are stored in localStorage,
     * exactly like the single token — no server needed for a personal static app.
     */
    supportsSecret?: boolean;
    /** Placeholder label for the key field (defaults to "key"). */
    keyLabel?: string;
    /** Placeholder label for the secret field (when supportsSecret). */
    secretLabel?: string;
    /** Whether this provider is routed through the CORS proxy template. */
    needsProxy: boolean;
    /** Whether this provider needs a request-handling proxy base URL (Yahoo). */
    needsProxyBase?: boolean;
    /** URL where the user can obtain a free key (for the onboarding link). */
    keyUrl?: string;
    /** Symbol that works with NO key (demo), if any (e.g. AAPL / IBM). */
    demoSymbol?: string;
    /** Extra human hint for the onboarding card (e.g. "no funded account"). */
    keyHint?: string;
    /** True if, given settings, this provider needs a key to serve `symbol`. */
    needsKeyFor: (symbol: string, ctx: ProviderContext) => boolean;

    // -- BULK providers implement this (returns the whole chain in one shot) --
    fetchAll?: (symbol: string, ctx: ProviderContext) => Promise<ChainResult>;

    // -- LAZY providers implement these two --------------------------------
    fetchMeta?: (symbol: string, ctx: ProviderContext) => Promise<ChainMeta>;
    fetchExpiration?: (symbol: string, expiration: string, ctx: ProviderContext) => Promise<OptionQuote[]>;

    /** Optional: list of tickers this provider can serve (Static cache uses it). */
    listTickers?: (ctx: ProviderContext) => Promise<string[]>;

    /**
     * Optional provider-native ticker suggestions / symbol search.
     * Providers that expose their own search endpoint (Yahoo/NASDAQ/CBOE proxy,
     * DoltHub SQL) implement this. Providers without one fall back to the local
     * data/options/index.json manifest, including tickers known to have no options.
     */
    suggestTickers?: (query: string, ctx: ProviderContext) => Promise<TickerSuggestion[]>;
}

/** A normalized ticker search suggestion shown under the ticker input. */
export interface TickerSuggestion {
    /** Display/submission symbol. For CBOE indices the user-facing symbol is SPX; the provider maps it to _SPX internally. */
    symbol: string;
    /** Optional company / index / instrument name for full-text search context. */
    name?: string;
    /** Optional exchange label (NASDAQ, NYSE, CBOE, etc.). */
    exchange?: string;
    /** Human label for the source of this suggestion (Provider / Local index). */
    source: string;
    /** False only when data/options/index.json explicitly says the ticker exists but has no listed options. */
    hasOptions: boolean;
}

// ============================================================================
// SETTINGS TYPES (store + defaults live in settings-store.ts)
// ============================================================================

export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Shared color palettes across daggerok apps (fundamentals + gex).
 * Each product keeps its native default; the other palette is selectable so a
 * future merge ships with both UIs already consistent.
 *  - gex          → Indigo Desk    (indigo accents, slate-900 dark surface)  [default here]
 *  - fundamentals → Emerald Ledger (emerald accents, slate-950 dark surface)
 */
export type ColorThemeId = 'fundamentals' | 'gex';

export interface SideColumnSettings {
    openInterest: boolean;
    volume: boolean;
    iv: boolean;
    delta: boolean;
    gamma: boolean;
    theta: boolean;
    vega: boolean;
    rho: boolean;
    // higher-order greeks
    lambda: boolean;
    vanna: boolean;
    vomma: boolean;
    charm: boolean;
    speed: boolean;
    zomma: boolean;
    color: boolean;
}

export interface DeskColumnSettings {
    calls: SideColumnSettings;
    puts: SideColumnSettings;
}

export interface Settings {
    providerId: string;
    language: Language;
    theme: ThemeMode;
    /** Shared product color palette (Emerald Ledger / Indigo Desk). */
    colorTheme: ColorThemeId;
    proxyTemplate: string;
    /** Base URL of the request-handling proxy (Yahoo/worker). */
    proxyBase: string;
    /** Optional Cloudflare Worker origin, substituted into {worker} templates. */
    workerUrl: string;
    /** Per-provider API keys, so switching providers keeps each key. */
    tokens: Record<string, string>;
    /** Per-provider API secrets (for KEY+SECRET providers like Alpaca). */
    secrets: Record<string, string>;
    /** Column groups shown in the options desk. Greeks are enabled by default. */
    deskColumns: DeskColumnSettings;
    lastTicker: string;
    /**
     * Opt-in to Black-76 futures-priced greeks/IV for VIX/VXN (see
     * src/vix-pricing.ts and .plans/gex-vix-futures-pricing-research.txt).
     * PHASE 1: this field is persisted and toggleable but nothing reads it
     * yet — wiring it into the live enrichment path is Phase 2. Defaults to
     * OFF: a new, not-yet-fully-wired feature must not change behavior for
     * existing users until it is actually wired up.
     */
    vixFuturesPricing: boolean;
}

// ============================================================================
// GEX / CHART TYPES (see .plans/gex-implementation-plan.txt section 5)
// ============================================================================

/** Aggregated gamma exposure at a single strike (output of computeGexProfile). */
export interface GexPoint {
    strike: number;
    callGex: number;
    /** Negative number (puts contribute negative gamma exposure). */
    putGex: number;
    /** callGex + putGex. */
    netGex: number;
    callOi: number;
    putOi: number;
    callVolume: number;
    putVolume: number;
}

/** Key levels derived from a chain slice (output of computeGexLevels). */
export interface GexLevels {
    spot: number;
    /**
     * The last net-GEX zero-crossing overall (ascending by strike) - whichever
     * of `gammaFlipPos` / `gammaFlipNeg` has the higher (later) strike, or the
     * sole non-null one if only one direction crosses anywhere in the chain.
     * Kept as a plain convenience field so existing consumers (src/views/
     * GexView.tsx) keep compiling and working unchanged. See src/gex.ts's
     * findGammaFlip/findGammaFlipCrossings doc comments for the full rule.
     */
    gammaFlip: number | null;
    /**
     * Last negative -> positive netGex transition (ascending by strike).
     * Null if the profile never crosses in that direction. A follow-up UI
     * change will show this as "Gamma Flip +" alongside gammaFlipNeg when
     * both are non-null.
     */
    gammaFlipPos: number | null;
    /**
     * Last positive -> negative netGex transition (ascending by strike).
     * Null if the profile never crosses in that direction. A follow-up UI
     * change will show this as "Gamma Flip -" alongside gammaFlipPos when
     * both are non-null.
     */
    gammaFlipNeg: number | null;
    callWall: number | null;
    putWall: number | null;
    /** "Resistance 2" - null if none qualifies. */
    callWall2: number | null;
    /** "Support 2" - null if none qualifies. */
    putWall2: number | null;
    maxPain: number | null;
    pcRatioOi: number | null;
    pcRatioVolume: number | null;
    totalNetGex: number;
}

/** A single OHLC candle (for the chart tab / providers/chart.ts). */
export interface OhlcBar {
    /** Unix seconds (UTC midnight for daily bars). */
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
}
