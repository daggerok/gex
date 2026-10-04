import type { ChainResult, GreeksSummary, OptionQuote } from './types';
import { estimateSpot, num } from './utils';
// Lazily-bound to avoid a hard circular-import ordering requirement at module
// init: vix-pricing.ts itself imports BS_RISK_FREE_RATE/normCdf/normPdf/
// yearsToExpiration/hasFirstOrderGreeks/hasHigherOrderGreeks from this file.
// Both modules only reference each other's exports from inside function
// bodies (never at top-level), so the cycle is safe — see
// https://nodejs.org/api/esm.html#circular-dependencies for why this works.
import { enrichFuturesPricedQuotes } from './vix-pricing';

// ---------------------------------------------------------------------------
// Client-side Black-Scholes greeks — SINGLE SOURCE OF TRUTH for model math
// ---------------------------------------------------------------------------
// scripts/options-data.py may attach provider Cboe 1st-order only. All model work
// (missing 1st-order + λ + 2nd/3rd-order) happens here after every provider
// fetch, including CACHE. Do not reintroduce BS in Python — that duplicates this.
// Conventions: theta per calendar day; vega/rho per 1 vol-point / 1pp rate.
export const BS_RISK_FREE_RATE = 0.045;
export const BS_DIVIDEND_YIELD = 0.0;
// Approximate S&P 500 continuous dividend yield. Shared by SPX and XSP: XSP is
// literally SPX/10 (same constituents, same weights), so the yields must match.
export const SPX_DIVIDEND_YIELD = 0.011;
// Per-index continuous dividend yield used by the model greeks. Each index gets
// ITS OWN figure - reusing the S&P 500 yield for e.g. Nasdaq-100 or the Dow
// misprices carry. Hardcoded estimates, not live figures - they drift over time.
// Source (2026-10): trailing-12m distribution yield of the tracking ETF plus its
// expense ratio (ETF payouts are net of fees): SPY 0.99%+0.09%, QQQ 0.41%+0.18%,
// DIA 1.41%+0.16%, IWM 0.97%+0.19%.
// Canonical (display / input / cache-key) form is the bare symbol; each provider
// derives its own upstream spelling: Yahoo "^SPX", Cboe "_SPX", NASDAQ unsupported.
// Every key here was live-verified against both yfinance (^SYM) and Cboe (_SYM).
// OEX is NOT here: its listed chain is effectively dead (~50 contracts of total
// OI, zero IV on Cboe, 4 sparse expirations on Yahoo). Do NOT add VIX
// (different, futures-based pricing model).
// Keep in sync with data/Indices.txt and SUPPORTED_INDEX_SYMBOLS in
// scripts/options-*-proxy.*.
export const INDEX_DIVIDEND_YIELDS: Readonly<Record<string, number>> = {
    SPX: SPX_DIVIDEND_YIELD, // S&P 500
    XSP: SPX_DIVIDEND_YIELD, // Mini-SPX = S&P 500 / 10
    NDX: 0.006,              // Nasdaq-100: tech/growth-heavy, low payout
    DJX: 0.015,              // Dow Jones Industrial Average / 100: mature blue chips
    RUT: 0.011,              // Russell 2000: small caps, close to the S&P 500 today
};
// Cash-settled index underlyings supported end-to-end across providers. Derived
// from the yield table so an index can never be added without its own yield.
export const INDEX_SYMBOLS: ReadonlySet<string> = new Set(Object.keys(INDEX_DIVIDEND_YIELDS));
/** Dividend yield the BS model should use for an underlying symbol. */
export function dividendYieldForSymbol(symbol: string | null | undefined): number {
    const raw = String(symbol ?? '').trim().toUpperCase().replace(/^[_^.]/, '');
    return INDEX_SYMBOLS.has(raw) ? INDEX_DIVIDEND_YIELDS[raw] : BS_DIVIDEND_YIELD;
}
// Volatility-index options priced off a FUTURES curve per expiration, not the
// spot index level - this app's Black-Scholes model (spot-based, everywhere
// else in this file) is simply the wrong model for them, not just imprecise.
// VIX is already reachable today via CBOE_INDEX_SYMBOLS in
// src/providers/cboe.ts, whose own feed supplies correct 1st-order greeks
// (delta/gamma/theta/vega/rho) for it - that part stays untouched by default.
// VXN (Nasdaq-100 volatility index) is the same class of instrument; treated
// the same out of caution rather than independently re-verified live.
// Deliberately NOT folded into INDEX_SYMBOLS: that set drives the per-index
// dividend yield and Yahoo `^`-prefix machinery built for spot-priced
// indices, which does not apply to a futures-priced one.
// Real Black-76 futures-priced greeks (src/vix-pricing.ts) are available
// opt-in via settings.vixFuturesPricing (default OFF) — see
// enrichQuotesWithModelGreeks below and
// .plans/gex-vix-futures-pricing-research.txt.
export const FUTURES_PRICED_SYMBOLS: ReadonlySet<string> = new Set(['VIX', 'VXN']);
/** True when `symbol` is a futures-priced volatility index (see FUTURES_PRICED_SYMBOLS). */
export function isFuturesPricedSymbol(symbol: string | null | undefined): boolean {
    const raw = String(symbol ?? '').trim().toUpperCase().replace(/^[_^.]/, '');
    return FUTURES_PRICED_SYMBOLS.has(raw);
}
export const HIGHER_ORDER_GREEK_KEYS = ['lambda', 'vanna', 'vomma', 'charm', 'speed', 'zomma', 'color'] as const;

export function normPdf(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Error function — Abramowitz & Stegun 7.1.26 (max abs error ~1.5e-7). */
export function erf(x: number): number {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
        - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
    return sign * y;
}

/** Standard normal CDF Φ(x) = ½ (1 + erf(x/√2)), matching Python math.erfc path. */
export function normCdf(x: number): number {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Years to expiration (calendar), +1 day floor — same rule as options-data.py. */
export function yearsToExpiration(expiration: string, now: Date = new Date()): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiration || ''));
    if (!m) return null;
    const expUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((expUtc - todayUtc) / 86_400_000) + 1;
    if (days <= 0) return null;
    return Math.max(days / 365.0, 1.0 / 365.0);
}

export type BsGreeks = {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
    lambda: number;
    vanna: number;
    vomma: number;
    charm: number;
    speed: number;
    zomma: number;
    color: number;
};

/**
 * Model-estimated greeks for one quote. Returns null + reason when inputs are
 * insufficient (missing spot/strike/IV/expiration). Does not mutate `q`.
 */
export function blackScholesGreeks(
    q: Pick<OptionQuote, 'side' | 'strike' | 'expiration' | 'iv' | 'last' | 'mid' | 'bid' | 'ask'>,
    spot: number,
    riskFree: number = BS_RISK_FREE_RATE,
    dividendYield: number = BS_DIVIDEND_YIELD,
): { greeks: BsGreeks; reason: null } | { greeks: null; reason: string } {
    const s = num(spot);
    const k = num(q.strike);
    const sigma = num(q.iv);
    if (s == null || s <= 0) return { greeks: null, reason: 'missing_spot' };
    if (k == null || k <= 0) return { greeks: null, reason: 'missing_strike' };
    if (sigma == null || sigma <= 0) return { greeks: null, reason: 'missing_iv' };
    const t = yearsToExpiration(q.expiration);
    if (t == null || t <= 0) return { greeks: null, reason: 'expired' };

    try {
        const sqrtT = Math.sqrt(t);
        const d1 = (Math.log(s / k) + (riskFree - dividendYield + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
        const d2 = d1 - sigma * sqrtT;
        const discQ = Math.exp(-dividendYield * t);
        const discR = Math.exp(-riskFree * t);
        const pdf = normPdf(d1);
        const gamma = discQ * pdf / (s * sigma * sqrtT);
        const vega = s * discQ * pdf * sqrtT / 100.0;
        const isPut = q.side === 'put';

        let delta: number;
        let thetaYear: number;
        let rho: number;
        let theoPrice: number;
        let charmRaw: number;
        if (isPut) {
            delta = discQ * (normCdf(d1) - 1.0);
            thetaYear = (-(s * discQ * pdf * sigma) / (2.0 * sqrtT)
                + riskFree * k * discR * normCdf(-d2)
                - dividendYield * s * discQ * normCdf(-d1));
            rho = -k * t * discR * normCdf(-d2) / 100.0;
            theoPrice = k * discR * normCdf(-d2) - s * discQ * normCdf(-d1);
            charmRaw = -dividendYield * discQ * normCdf(-d1)
                - discQ * pdf * (2 * (riskFree - dividendYield) * t - d2 * sigma * sqrtT) / (2 * t * sigma * sqrtT);
        } else {
            delta = discQ * normCdf(d1);
            thetaYear = (-(s * discQ * pdf * sigma) / (2.0 * sqrtT)
                - riskFree * k * discR * normCdf(d2)
                + dividendYield * s * discQ * normCdf(d1));
            rho = k * t * discR * normCdf(d2) / 100.0;
            theoPrice = s * discQ * normCdf(d1) - k * discR * normCdf(d2);
            charmRaw = dividendYield * discQ * normCdf(d1)
                - discQ * pdf * (2 * (riskFree - dividendYield) * t - d2 * sigma * sqrtT) / (2 * t * sigma * sqrtT);
        }

        let optPrice = num(q.last);
        if (optPrice == null || optPrice <= 0) optPrice = num(q.mid);
        if (optPrice == null || optPrice <= 0) {
            const bid = num(q.bid);
            const ask = num(q.ask);
            if (bid != null && ask != null && bid > 0 && ask > 0) optPrice = (bid + ask) / 2;
        }
        if (optPrice == null || optPrice <= 0) optPrice = theoPrice;

        const lambda = optPrice > 0 ? (delta * s / optPrice) : 0;
        const vanna = -discQ * pdf * d2 / sigma / 100.0;
        const vegaRaw = s * discQ * pdf * sqrtT;
        const vomma = vegaRaw * d1 * d2 / sigma / 10000.0;
        const charm = charmRaw / 365.0;
        const speed = -gamma * (1.0 + d1 / (sigma * sqrtT)) / s;
        const zomma = gamma * (d1 * d2 - 1.0) / sigma / 100.0;
        const colorRaw = -gamma * (2 * dividendYield * t + 1.0
            + (2 * (riskFree - dividendYield) * t - d2 * sigma * sqrtT) * d1 / (sigma * sqrtT)) / (2 * t);
        const color = colorRaw / 365.0;

        const greeks: BsGreeks = {
            delta,
            gamma,
            theta: thetaYear / 365.0,
            vega,
            rho,
            lambda,
            vanna,
            vomma,
            charm,
            speed,
            zomma,
            color,
        };
        for (const k of Object.keys(greeks) as (keyof BsGreeks)[]) {
            if (!Number.isFinite(greeks[k])) return { greeks: null, reason: 'model_error' };
        }
        return { greeks, reason: null };
    } catch {
        return { greeks: null, reason: 'model_error' };
    }
}

export function hasFirstOrderGreeks(q: OptionQuote): boolean {
    return num(q.delta) != null && num(q.gamma) != null;
}

export function hasHigherOrderGreeks(q: OptionQuote): boolean {
    return HIGHER_ORDER_GREEK_KEYS.some((k) => num(q[k] as number | null | undefined) != null);
}

/**
 * Enrich one quote with model greeks without clobbering provider-supplied values.
 * - Already has 1st + higher-order → leave as-is (static cache pre-enrichment).
 * - Has 1st-order (CBOE/marketdata/DoltHub) → fill only missing ρ/λ/2nd/3rd.
 * - Has IV but no 1st-order (Yahoo) → fill full BS set, tag black-scholes.
 * - No IV and no 1st-order (NASDAQ) → leave empty with missing reason when useful.
 * - Futures-priced underlying (VIX/VXN, see FUTURES_PRICED_SYMBOLS) → NEVER
 *   compute BS higher-order greeks (the spot-based model is simply wrong for
 *   these); keep any provider-supplied 1st-order greeks untouched and tag the
 *   missing higher-order fields with reason 'futures_priced' instead of
 *   silently leaving them blank.
 *
 * NOTE: this function is only reached for a futures-priced symbol when the
 * caller (enrichQuotesWithModelGreeks) determined settings.vixFuturesPricing
 * is OFF. When it's ON, enrichQuotesWithModelGreeks dispatches to
 * enrichFuturesPricedQuotes (src/vix-pricing.ts) instead, which replaces the
 * 'futures_priced' suppression above with real per-expiration Black-76
 * greeks. This function and its `isFuturesPriced` suppression branch are
 * unchanged by that — they remain the exact toggle-off behavior.
 */
export function enrichQuoteWithModelGreeks(
    q: OptionQuote,
    spot: number | null,
    dividendYield: number = BS_DIVIDEND_YIELD,
    isFuturesPriced: boolean = false,
): OptionQuote {
    if (isFuturesPriced) {
        if (hasHigherOrderGreeks(q) || q.greeksMissingReason) return q;
        return { ...q, greeksMissingReason: 'futures_priced' };
    }
    if (spot == null || !(spot > 0)) {
        if (!hasFirstOrderGreeks(q) && !q.greeksMissingReason) {
            return { ...q, greeksMissingReason: 'missing_spot' };
        }
        return q;
    }
    if (hasFirstOrderGreeks(q) && hasHigherOrderGreeks(q)) return q;

    const { greeks: calc, reason } = blackScholesGreeks(q, spot, BS_RISK_FREE_RATE, dividendYield);
    if (!calc) {
        if (!hasFirstOrderGreeks(q) && !q.greeksMissingReason) {
            return { ...q, greeksMissingReason: reason };
        }
        return q;
    }

    if (hasFirstOrderGreeks(q)) {
        // Keep provider delta/gamma/theta/vega; only backfill missing fields.
        return {
            ...q,
            rho: q.rho ?? calc.rho,
            lambda: q.lambda ?? calc.lambda,
            vanna: q.vanna ?? calc.vanna,
            vomma: q.vomma ?? calc.vomma,
            charm: q.charm ?? calc.charm,
            speed: q.speed ?? calc.speed,
            zomma: q.zomma ?? calc.zomma,
            color: q.color ?? calc.color,
            greeksSource: q.greeksSource ?? 'black-scholes',
            greeksMissingReason: q.greeksMissingReason ?? null,
        };
    }

    return {
        ...q,
        delta: calc.delta,
        gamma: calc.gamma,
        theta: calc.theta,
        vega: calc.vega,
        rho: calc.rho,
        lambda: calc.lambda,
        vanna: calc.vanna,
        vomma: calc.vomma,
        charm: calc.charm,
        speed: calc.speed,
        zomma: calc.zomma,
        color: calc.color,
        greeksSource: 'black-scholes',
        greeksMissingReason: null,
    };
}

/** Resolve a usable spot for enrichment: explicit underlying, else parity estimate. */
export function resolveEnrichmentSpot(quotes: OptionQuote[], underlyingPrice: number | null | undefined): number | null {
    const s = num(underlyingPrice);
    if (s != null && s > 0) return s;
    const exps: string[] = [];
    const seen: Record<string, true> = {};
    for (const q of quotes) {
        if (q.expiration && !seen[q.expiration]) {
            seen[q.expiration] = true;
            exps.push(q.expiration);
        }
    }
    exps.sort();
    for (let i = 0; i < exps.length; i++) {
        const est = estimateSpot(quotes, exps[i]);
        if (est != null && est > 0) return est;
    }
    return null;
}

/**
 * Enrich an array of quotes; returns same array reference if nothing changed.
 *
 * `vixFuturesPricing` (default false, matching settings.vixFuturesPricing's
 * default) gates the ONLY branch point for futures-priced symbols (VIX/VXN):
 *   - off, or not a futures-priced symbol → the exact code path that shipped
 *     before this toggle existed (enrichQuoteWithModelGreeks per quote, one
 *     shared `spot` for the whole list). PROVABLY unchanged: this branch
 *     does not reference vixFuturesPricing or enrichFuturesPricedQuotes at
 *     all.
 *   - on AND futures-priced → enrichFuturesPricedQuotes (src/vix-pricing.ts),
 *     which resolves a SEPARATE Black-76 forward per expiration (never one
 *     shared spot — each VIX/VXN expiration has its own forward, research
 *     plan section 9) and never reaches the code below.
 */
export function enrichQuotesWithModelGreeks(
    quotes: OptionQuote[],
    underlyingPrice: number | null | undefined,
    symbol: string | null | undefined,
    vixFuturesPricing: boolean = false,
): OptionQuote[] {
    if (!quotes.length) return quotes;
    const isFuturesPriced = isFuturesPricedSymbol(symbol);
    if (vixFuturesPricing && isFuturesPriced) {
        return enrichFuturesPricedQuotes(quotes);
    }
    const spot = resolveEnrichmentSpot(quotes, underlyingPrice);
    const dividendYield = dividendYieldForSymbol(symbol);
    let changed = false;
    const out = quotes.map((q) => {
        const next = enrichQuoteWithModelGreeks(q, spot, dividendYield, isFuturesPriced);
        if (next !== q) changed = true;
        return next;
    });
    return changed ? out : quotes;
}

/**
 * Attach model greeks + a light summary onto a bulk ChainResult.
 * `vixFuturesPricing` is forwarded to enrichQuotesWithModelGreeks unchanged
 * (see its doc comment) — default false keeps every existing caller's
 * behavior identical.
 */
export function enrichChainResult(result: ChainResult, vixFuturesPricing: boolean = false): ChainResult {
    const quotes = enrichQuotesWithModelGreeks(result.quotes, result.underlyingPrice, result.symbol, vixFuturesPricing);
    if (quotes === result.quotes && result.greeks) return result;

    let computed = 0;
    let missing = 0;
    let providerFirst = 0;
    for (const q of quotes) {
        if (q.greeksSource === 'black-scholes' || q.greeksSource === 'black-76') computed += 1;
        else if (hasFirstOrderGreeks(q)) providerFirst += 1;
        if (!hasFirstOrderGreeks(q)) missing += 1;
    }
    const isVixPriced = vixFuturesPricing && isFuturesPricedSymbol(result.symbol);
    const greeks: GreeksSummary = {
        ...(result.greeks || {}),
        enabled: true,
        fallbackSource: result.greeks?.fallbackSource ?? (isVixPriced ? 'black-76' : 'black-scholes'),
        riskFreeRate: result.greeks?.riskFreeRate ?? BS_RISK_FREE_RATE,
        dividendYield: result.greeks?.dividendYield ?? dividendYieldForSymbol(result.symbol),
        total: quotes.length,
        computed: result.greeks?.computed ?? computed,
        missing: result.greeks?.missing ?? missing,
        // Preserve static-cache cboeMatched when present; else count non-BS first-order.
        cboeMatched: result.greeks?.cboeMatched ?? providerFirst,
    };
    return { ...result, quotes, greeks };
}
