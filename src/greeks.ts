/// <reference lib="esnext" />
import type { ChainResult, GreeksSummary, OptionQuote } from './types';
import { estimateSpot, num } from './utils';
import { marketDate, zonedTimeToMs } from './backtest/snapshot';
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
// scripts/options-data.ts may attach provider Cboe 1st-order only. All model work
// (missing 1st-order + λ + 2nd/3rd-order) happens here after every provider
// fetch, including CACHE. Do not reintroduce BS in the fetcher — that duplicates this.
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
// Keep in sync with api/Indices.txt and SUPPORTED_INDEX_SYMBOLS in
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
// agentic-workspace docs/repos/gex/spec-vix-futures.md.
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

let valuationTime: number | null = null;

/**
 * Backtest ("As of" a snapshot): the moment the model greeks are valued at instead of now, in ms since the epoch
 * (snapshotValuationTime: a backup at its own minute, a day archive at the 16:00 close), or null for the real clock. This is
 * the only place the app reads the clock for pricing, so a past snapshot shows the greeks it showed at that time. Set when
 * the mode is entered and cleared when it is left.
 */
export function setValuationTime(ms: number | null): void {
    valuationTime = typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

/** "Now" for pricing: the valuation time of a backtest, else the real clock. */
function valuationNow(): Date {
    return valuationTime === null ? new Date() : new Date(valuationTime);
}

/** Options settle at 16:00 New York time on their expiration day (PM settlement; AM-settled monthlies are not told apart). */
export const SETTLEMENT_HOUR_ET = 16;
/** Smallest time to expiration the model uses: 15 minutes (GEX-M1), so gamma stays finite at and after the 16:00 settlement. */
export const MIN_MINUTES_TO_EXPIRATION = 15;
const YEAR_MS = 365 * 86_400_000;
const MIN_MS_TO_EXPIRATION = MIN_MINUTES_TO_EXPIRATION * 60_000;
const settlementMs = new Map<string, number>();
let todayCache: { minute: number; date: string } | null = null;

/** Market calendar date of `now`, cached per minute (yearsToExpiration runs for every quote). */
function marketToday(now: Date): string {
    const minute = Math.floor(now.getTime() / 60_000);
    if (todayCache?.minute !== minute) todayCache = { minute, date: marketDate(now) };
    return todayCache.date;
}

/**
 * Years to expiration (GEX-M1, owner-approved 2026-10-25): the real time from `now` to the 16:00 New York settlement of the
 * expiration day, as a share of a 365-day calendar year, never below 15 minutes. Null when the expiration day is before the
 * market (New York) calendar date of `now`; on the expiration day itself the 15-minute floor holds also after 16:00, so a
 * chain fetched or archived after the close still values its 0DTE. Replaces the "calendar days + 1" rule of the old Python
 * fetcher (0DTE was 1 day, 24x the real T at 15:00, its at-the-money gamma about 4.9x too low); the day is the New York one, not the
 * browser's local date (review GEX-L2).
 */
export function yearsToExpiration(expiration: string, now: Date = valuationNow()): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiration || ''));
    if (!m) return null;
    if (expiration < marketToday(now)) return null;
    let settle = settlementMs.get(expiration);
    if (settle === undefined) {
        settle = zonedTimeToMs(Number(m[1]), Number(m[2]), Number(m[3]), SETTLEMENT_HOUR_ET, 0);
        settlementMs.set(expiration, settle);
    }
    return Math.max(settle - now.getTime(), MIN_MS_TO_EXPIRATION) / YEAR_MS;
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

/**
 * Black-Scholes gamma alone (the same formula and defaults as blackScholesGreeks' `gamma`), for the IV inversion below
 * where only gamma is needed thousands of times. Null when an input is not usable.
 */
export function blackScholesGamma(
    spot: number,
    strike: number,
    years: number,
    sigma: number,
    riskFree: number = BS_RISK_FREE_RATE,
    dividendYield: number = BS_DIVIDEND_YIELD,
): number | null {
    if (!(spot > 0) || !(strike > 0) || !(years > 0) || !(sigma > 0)) return null;
    const sqrtT = Math.sqrt(years);
    const d1 = (Math.log(spot / strike) + (riskFree - dividendYield + 0.5 * sigma * sigma) * years) / (sigma * sqrtT);
    const g = Math.exp(-dividendYield * years) * normPdf(d1) / (spot * sigma * sqrtT);
    return Number.isFinite(g) ? g : null;
}

/** Bounds of the IV that gamma inversion may return (5% .. 300%): below 5% is the failed-solve range the repair replaces. */
export const GAMMA_INVERSION_MIN_IV = 0.05;
export const GAMMA_INVERSION_MAX_IV = 3;
/** Without an exact root, the closest volatility counts when its gamma is within this share of the target (25%). */
export const GAMMA_INVERSION_TOLERANCE = 0.25;
/** Log-spaced volatilities scanned for sign changes before each root is refined by bisection. */
const GAMMA_INVERSION_GRID = 64;

/**
 * The volatility whose Black-Scholes gamma at `spot` equals `gamma` (the provider's own gamma of the quote), within
 * GAMMA_INVERSION_MIN_IV .. GAMMA_INVERSION_MAX_IV. Our own repair for a quote whose provider IV is a failed solve while
 * its provider gamma is sane (CBOE, see gex.ts repairImpliedVols), not a published method.
 *
 * Gamma is not monotone in sigma: it rises to a peak at sigma * sqrt(T) ~ |ln(S/K)| and falls after it, so an
 * out-of-the-money strike can have TWO volatilities with the same gamma (a low one where the strike is far in standard
 * deviations, a high one where it is close). With `refVol` (the expiration's ATM IV) the root nearest to it in log terms
 * wins, since a smile stays far closer to the ATM level than the other root; without it the higher root wins (near the
 * money there is only that one).
 *
 * No exact root: the provider may value with its own underlying price or time (CBOE's SPX gamma of 2026-10-23 peaked at
 * 7650 with spot 7623.68), so a gamma a little above the Black-Scholes maximum for that strike happens. Then the volatility
 * that comes CLOSEST (the peak) is returned when it is within GAMMA_INVERSION_TOLERANCE of the target, else null.
 */
export function impliedVolFromGamma(spot: number, strike: number, years: number, gamma: number, refVol?: number | null): number | null {
    if (!(gamma > 0) || !(spot > 0) || !(strike > 0) || !(years > 0)) return null;
    const lnMin = Math.log(GAMMA_INVERSION_MIN_IV);
    const lnMax = Math.log(GAMMA_INVERSION_MAX_IV);
    const f = (lnSigma: number) => (blackScholesGamma(spot, strike, years, Math.exp(lnSigma)) ?? 0) - gamma;
    const roots: number[] = [];
    let prevX = lnMin;
    let prevF = f(prevX);
    if (prevF === 0) roots.push(prevX);
    for (let i = 1; i < GAMMA_INVERSION_GRID; i++) {
        const x = lnMin + ((lnMax - lnMin) * i) / (GAMMA_INVERSION_GRID - 1);
        const fx = f(x);
        if (fx === 0) roots.push(x);
        else if (prevF !== 0 && Math.sign(fx) !== Math.sign(prevF)) {
            let a = prevX;
            let b = x;
            let fa = prevF;
            for (let k = 0; k < 50; k++) {
                const m = (a + b) / 2;
                const fm = f(m);
                if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else b = m;
            }
            roots.push((a + b) / 2);
        }
        prevX = x;
        prevF = fx;
    }
    if (roots.length === 0) {
        // the closest volatility: the best grid point, refined by a ternary search between its neighbours
        const step = (lnMax - lnMin) / (GAMMA_INVERSION_GRID - 1);
        let bestX = lnMin;
        for (let i = 0; i < GAMMA_INVERSION_GRID; i++) {
            const x = lnMin + step * i;
            if (Math.abs(f(x)) < Math.abs(f(bestX))) bestX = x;
        }
        let a = Math.max(lnMin, bestX - step);
        let b = Math.min(lnMax, bestX + step);
        for (let k = 0; k < 60; k++) {
            const m1 = a + (b - a) / 3;
            const m2 = b - (b - a) / 3;
            if (Math.abs(f(m1)) <= Math.abs(f(m2))) b = m2; else a = m1;
        }
        const x = (a + b) / 2;
        return Math.abs(f(x)) <= GAMMA_INVERSION_TOLERANCE * gamma ? Math.exp(x) : null;
    }
    const ref = refVol != null && refVol > 0 ? Math.log(refVol) : null;
    let best = roots[roots.length - 1];
    if (ref !== null) for (const r of roots) if (Math.abs(r - ref) < Math.abs(best - ref)) best = r;
    return Math.exp(best);
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
