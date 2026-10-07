import type { OptionQuote } from './types';
import {
    BS_RISK_FREE_RATE,
    type BsGreeks,
    hasFirstOrderGreeks,
    hasHigherOrderGreeks,
    normCdf,
    normPdf,
    yearsToExpiration,
} from './greeks';
import { estimateSpot, num } from './utils';

// ---------------------------------------------------------------------------
// Black-76 (options on futures) pricing.
// ---------------------------------------------------------------------------
// VIX/VXN (see FUTURES_PRICED_SYMBOLS in src/greeks.ts) are cash-settled
// volatility-index options priced off a futures curve per expiration, not the
// spot index level — the spot-based blackScholesGreeks in src/greeks.ts is
// simply the wrong model for them. This module implements the correct model
// (Black 1976) per .claude/docs/spec-vix-futures.md sections 6-7.
//
// PHASE 1 shipped the pure math below (black76Price/black76Greeks/
// impliedVolBlack76/impliedForward) with nothing wired into a live path.
// PHASE 2 adds enrichFuturesPricedQuotes, the per-expiration dispatch that
// src/greeks.ts' enrichQuotesWithModelGreeks calls when BOTH
// settings.vixFuturesPricing is on AND the symbol is futures-priced. When the
// toggle is off (the default) or the symbol isn't futures-priced, none of
// this file runs — the existing suppressed ('futures_priced') path in
// src/greeks.ts is untouched and the non-VIX path is unaffected.
//
// Conventions mirror blackScholesGreeks exactly: theta per calendar day, vega
// per 1 vol-point, rho per 1 percentage point of r (but see 6.2/6.3 below —
// rho has its OWN formula here, it is NOT the generalized-BS shortcut).
// ---------------------------------------------------------------------------

/**
 * Black-76 is mathematically identical to the generalized Black-Scholes model
 * (spot S, dividend yield q) when S = F and q = r — the (r - q) drift term in
 * d1 vanishes, leaving ln(F/K) + 0.5*sigma^2*T, and every expression in
 * blackScholesGreeks reduces to the Black-76 formula below for every greek
 * EXCEPT rho (which depends on how q is held fixed vs r; see 6.3 of the
 * research plan). That identity is this module's test oracle — see
 * src/vix-pricing.test.ts — but is NEVER used in production code: this file
 * implements Black-76 standalone so the VIX/VXN path never depends on the
 * equity/SPX function's internals, and so rho (which truly differs) is
 * correct rather than silently reusing the wrong formula.
 */

export type { BsGreeks };

/** Black-76 theoretical price for one side. No dividend-yield term — it is
 *  already embedded in the forward F. */
export function black76Price(side: 'call' | 'put', forward: number, strike: number, t: number, sigma: number, riskFree: number = BS_RISK_FREE_RATE): number {
    const sqrtT = Math.sqrt(t);
    const d1 = (Math.log(forward / strike) + 0.5 * sigma * sigma * t) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    const D = Math.exp(-riskFree * t);
    if (side === 'put') {
        return D * (strike * normCdf(-d2) - forward * normCdf(-d1));
    }
    return D * (forward * normCdf(d1) - strike * normCdf(d2));
}

/**
 * Black-76 greeks for one quote, given a per-expiration forward F (NOT spot).
 * Mirrors blackScholesGreeks' exact return shape and field set. `rho` here is
 * the Black-76-specific formula `rho = -T * V / 100` (V = this option's
 * model price, F held fixed — r only enters through the discount factor),
 * NOT the generalized-BS shortcut — see the module doc comment and research
 * plan section 6.2/6.3.
 */
export function black76Greeks(
    q: Pick<OptionQuote, 'side' | 'strike' | 'expiration' | 'last' | 'mid' | 'bid' | 'ask'>,
    forward: number,
    sigma: number,
    riskFree: number = BS_RISK_FREE_RATE,
): { greeks: BsGreeks; reason: null } | { greeks: null; reason: string } {
    const f = num(forward);
    const k = num(q.strike);
    const s = num(sigma);
    if (f == null || f <= 0) return { greeks: null, reason: 'missing_forward' };
    if (k == null || k <= 0) return { greeks: null, reason: 'missing_strike' };
    if (s == null || s <= 0) return { greeks: null, reason: 'missing_iv' };
    const t = yearsToExpiration(q.expiration);
    if (t == null || t <= 0) return { greeks: null, reason: 'expired' };

    try {
        const sqrtT = Math.sqrt(t);
        const d1 = (Math.log(f / k) + 0.5 * s * s * t) / (s * sqrtT);
        const d2 = d1 - s * sqrtT;
        const D = Math.exp(-riskFree * t);
        const pdf = normPdf(d1);
        const isPut = q.side === 'put';

        const gamma = D * pdf / (f * s * sqrtT);
        const vega = f * D * pdf * sqrtT / 100.0;

        let delta: number;
        let theoPrice: number;
        let charmRaw: number;
        if (isPut) {
            delta = D * (normCdf(d1) - 1.0); // = -D * N(-d1)
            theoPrice = D * (k * normCdf(-d2) - f * normCdf(-d1));
            charmRaw = -riskFree * D * normCdf(-d1) + D * pdf * d2 / (2 * t);
        } else {
            delta = D * normCdf(d1);
            theoPrice = D * (f * normCdf(d1) - k * normCdf(d2));
            charmRaw = riskFree * D * normCdf(d1) + D * pdf * d2 / (2 * t);
        }

        // thetaYear holds F fixed (no drift term for F itself, a martingale
        // under the risk-neutral measure) — only the discounting of the
        // terminal payoff decays with time, hence `+ riskFree * theoPrice`.
        const thetaYear = -(f * D * pdf * s) / (2.0 * sqrtT) + riskFree * theoPrice;
        // rho: Black-76-specific formula (NOT the generalized-BS shortcut).
        // With F held fixed, r enters the price ONLY through the discount
        // factor D = exp(-rT), so d(price)/dr = -T * price exactly.
        const rho = -t * theoPrice / 100.0;

        let optPrice = num(q.last);
        if (optPrice == null || optPrice <= 0) optPrice = num(q.mid);
        if (optPrice == null || optPrice <= 0) {
            const bid = num(q.bid);
            const ask = num(q.ask);
            if (bid != null && ask != null && bid > 0 && ask > 0) optPrice = (bid + ask) / 2;
        }
        if (optPrice == null || optPrice <= 0) optPrice = theoPrice;

        const lambda = optPrice > 0 ? (delta * f / optPrice) : 0;
        const vanna = -D * pdf * d2 / s / 100.0;
        const vegaRaw = f * D * pdf * sqrtT;
        const vomma = vegaRaw * d1 * d2 / s / 10000.0;
        const charm = charmRaw / 365.0;
        const speed = -gamma * (1.0 + d1 / (s * sqrtT)) / f;
        const zomma = gamma * (d1 * d2 - 1.0) / s / 100.0;
        const colorRaw = -gamma * (2 * riskFree * t + 1.0 - d1 * d2) / (2 * t);
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
        for (const key of Object.keys(greeks) as (keyof BsGreeks)[]) {
            if (!Number.isFinite(greeks[key])) return { greeks: null, reason: 'model_error' };
        }
        return { greeks, reason: null };
    } catch {
        return { greeks: null, reason: 'model_error' };
    }
}

// ---------------------------------------------------------------------------
// Implied-vol solver (bisection — see research plan 6.4)
// ---------------------------------------------------------------------------
// Providers' IV is not reusable for VIX/VXN: Yahoo's is spot-based garbage
// (puts hit the 0.00001 floor, calls read 140-270%), so IV must be solved
// back from the option's market price using Black-76 against the forward.
// Black-76 price is monotone increasing in sigma (vega > 0 everywhere), so
// plain bisection is safe and has no Newton-on-tiny-vega failure mode — no
// existing IV solver pattern was found elsewhere in the repo to mirror.

const IV_MIN = 0.01;
const IV_MAX = 10.0; // VIX IVs of 300%+ are real on near weeklies (research plan 5.1)
const IV_TOLERANCE = 1e-6;
const IV_MAX_ITER = 100;

/**
 * Solve Black-76 implied vol from a market price. Returns null (not NaN) when
 * `price` is outside the no-arbitrage bounds for the given side, or inputs are
 * invalid — callers should treat null as "no IV, mark greeksMissingReason".
 */
export function impliedVolBlack76(
    side: 'call' | 'put',
    price: number,
    forward: number,
    strike: number,
    t: number,
    riskFree: number = BS_RISK_FREE_RATE,
): number | null {
    const p = num(price);
    const f = num(forward);
    const k = num(strike);
    if (p == null || p <= 0) return null;
    if (f == null || f <= 0) return null;
    if (k == null || k <= 0) return null;
    if (t == null || !(t > 0)) return null;

    const D = Math.exp(-riskFree * t);
    const intrinsic = side === 'put' ? D * Math.max(k - f, 0) : D * Math.max(f - k, 0);
    const upperBound = side === 'put' ? D * k : D * f;
    // Strict no-arbitrage bounds (research plan 6.4): intrinsic < P < upperBound.
    if (!(p > intrinsic) || !(p < upperBound)) return null;

    let lo = IV_MIN;
    let hi = IV_MAX;
    const priceAt = (sigma: number) => black76Price(side, f, k, t, sigma, riskFree);

    let loErr = priceAt(lo) - p;
    let hiErr = priceAt(hi) - p;
    // Both bounds are monotone in sigma; if price at the edges doesn't bracket
    // the target (can happen right at the numerical edge of the bounds check
    // above), there's no solvable IV in range.
    if (loErr > 0 || hiErr < 0) return null;

    let mid = (lo + hi) / 2;
    for (let i = 0; i < IV_MAX_ITER; i++) {
        mid = (lo + hi) / 2;
        const err = priceAt(mid) - p;
        if (Math.abs(err) < IV_TOLERANCE) return mid;
        if (err > 0) hi = mid; else lo = mid;
        if (hi - lo < 1e-9) break;
    }
    return mid;
}

// ---------------------------------------------------------------------------
// Per-expiration forward via put-call parity (research plan section 7)
// ---------------------------------------------------------------------------
// For European options on the same expiration: C - P = D * (F - K), so
// F = K + (C - P) / D. The existing estimateSpot (src/utils.ts) already does
// an un-discounted version of this (picks the single strike with the
// smallest |C - P|, no discounting, falls back to last trade). This function
// is the Black-76-flavored sibling: it discounts by D = exp(-rT), restricts
// to strikes with two-sided live quotes (bid > 0 and ask > 0 on both legs,
// spread capped), and uses the MEDIAN of the 3-5 best (smallest |C-P|)
// strikes rather than a single strike, per research plan 7.1/7.2.
// estimateSpot is deliberately left unchanged for its existing callers.

/**
 * Per-expiration forward estimate for a futures-priced underlying (VIX/VXN),
 * via put-call parity, discounted at `riskFree`. Returns null if no strike in
 * `expiration` has two-sided (bid>0 and ask>0) quotes on both legs within the
 * spread filter. Phase 2 is expected to fall back to estimateSpot when this
 * returns null (research plan 7.1 step 4) — that wiring is out of scope here.
 */
export function impliedForward(quotes: OptionQuote[], expiration: string, riskFree: number = BS_RISK_FREE_RATE): number | null {
    const t = yearsToExpiration(expiration);
    if (t == null || t <= 0) return null;
    const D = Math.exp(-riskFree * t);

    const byStrike = new Map<number, { call?: OptionQuote; put?: OptionQuote }>();
    for (const q of quotes) {
        if (q.expiration !== expiration) continue;
        const slot = byStrike.get(q.strike) ?? {};
        if (q.side === 'call') slot.call = q; else slot.put = q;
        byStrike.set(q.strike, slot);
    }

    type Candidate = { strike: number; diff: number; forward: number };
    const candidates: Candidate[] = [];
    byStrike.forEach(({ call, put }, strike) => {
        if (!call || !put) return;
        const cBid = num(call.bid), cAsk = num(call.ask);
        const pBid = num(put.bid), pAsk = num(put.ask);
        if (cBid == null || cAsk == null || cBid <= 0 || cAsk <= 0) return;
        if (pBid == null || pAsk == null || pBid <= 0 || pAsk <= 0) return;
        const cMid = (cBid + cAsk) / 2;
        const pMid = (pBid + pAsk) / 2;
        const cSpread = cAsk - cBid;
        const pSpread = pAsk - pBid;
        const cMaxSpread = Math.max(0.50, 0.25 * cMid);
        const pMaxSpread = Math.max(0.50, 0.25 * pMid);
        if (cSpread > cMaxSpread || pSpread > pMaxSpread) return;
        const diff = Math.abs(cMid - pMid);
        const forward = strike + (cMid - pMid) / D;
        candidates.push({ strike, diff, forward });
    });

    if (!candidates.length) return null;
    candidates.sort((a, b) => a.diff - b.diff);
    const best = candidates.slice(0, Math.min(5, candidates.length));
    const forwards = best.map((c) => c.forward).sort((a, b) => a - b);
    const mid = Math.floor(forwards.length / 2);
    const median = forwards.length % 2 === 1
        ? forwards[mid]
        : (forwards[mid - 1] + forwards[mid]) / 2;
    return median;
}

// ---------------------------------------------------------------------------
// Per-expiration Black-76 enrichment dispatch (research plan sections 7-8) —
// PHASE 2.
// ---------------------------------------------------------------------------
// Each VIX/VXN expiration has its OWN forward (research plan section 9), so
// unlike enrichQuotesWithModelGreeks (one shared spot for every quote), this
// function groups quotes by expiration, resolves a forward per group
// (impliedForward first, falling back to the existing estimateSpot when
// impliedForward can't find enough two-sided liquid strikes — section 7.1
// step 4), and enriches every quote in a group with THAT group's forward.
// Expirations where neither resolves a forward fall back to the existing
// suppressed 'futures_priced' behavior rather than guessing.

/** Resolve the Black-76 forward for one expiration's quotes: parity first,
 *  else the existing single-strike parity estimator, else null. */
function resolveExpirationForward(groupQuotes: OptionQuote[], expiration: string, riskFree: number): number | null {
    const parity = impliedForward(groupQuotes, expiration, riskFree);
    if (parity != null && parity > 0) return parity;
    const fallback = estimateSpot(groupQuotes, expiration);
    return fallback != null && fallback > 0 ? fallback : null;
}

/**
 * Enrich one futures-priced quote against its expiration's own forward.
 * Mirrors enrichQuoteWithModelGreeks's branching exactly (CBOE 1st-order
 * present → fill only missing ρ/λ/2nd-3rd; no 1st-order → fill the full set)
 * but with Black-76 internals and a freshly solved IV — provider-supplied
 * `iv` is never trusted for these symbols (see this module's doc comment and
 * research plan 5.6), so `iv` is always overwritten once a model price solves.
 * `forward` is null when neither impliedForward nor the estimateSpot fallback
 * could resolve a forward for this expiration — that quote keeps today's
 * suppressed behavior (greeksMissingReason 'futures_priced').
 */
function enrichFuturesPricedQuote(q: OptionQuote, forward: number | null, riskFree: number): OptionQuote {
    if (forward == null) {
        if (hasHigherOrderGreeks(q) || q.greeksMissingReason) return q;
        return { ...q, greeksMissingReason: 'futures_priced' };
    }
    // Already solved against THIS forward (idempotent re-enrichment from
    // cache) — skip recompute; avoids churn on every cache read.
    if (hasFirstOrderGreeks(q) && hasHigherOrderGreeks(q) && q.greeksSource === 'black-76' && q.forward === forward) {
        return q;
    }

    const t = yearsToExpiration(q.expiration);
    if (t == null || t <= 0) {
        if (!hasFirstOrderGreeks(q) && !q.greeksMissingReason) return { ...q, forward, greeksMissingReason: 'expired' };
        return q.forward === forward ? q : { ...q, forward };
    }

    // Research plan 6.4: solve on the mid only when both sides are live
    // (bid > 0 and ask > 0) — never on a possibly-stale last trade.
    const bid = num(q.bid);
    const ask = num(q.ask);
    const price = (bid != null && ask != null && bid > 0 && ask > 0) ? (bid + ask) / 2 : null;
    const sigma = price != null ? impliedVolBlack76(q.side, price, forward, q.strike, t, riskFree) : null;
    if (sigma == null) {
        if (!hasFirstOrderGreeks(q) && !q.greeksMissingReason) {
            return { ...q, forward, greeksMissingReason: price == null ? 'missing_mid' : 'price_out_of_bounds' };
        }
        return q.forward === forward ? q : { ...q, forward };
    }

    const { greeks: calc, reason } = black76Greeks(q, forward, sigma, riskFree);
    if (!calc) {
        if (!hasFirstOrderGreeks(q) && !q.greeksMissingReason) return { ...q, forward, greeksMissingReason: reason };
        return q.forward === forward ? q : { ...q, forward };
    }

    if (hasFirstOrderGreeks(q)) {
        // Keep provider delta/gamma/theta/vega; only backfill missing fields.
        // iv is always replaced — see doc comment above.
        return {
            ...q,
            iv: sigma,
            forward,
            rho: q.rho ?? calc.rho,
            lambda: q.lambda ?? calc.lambda,
            vanna: q.vanna ?? calc.vanna,
            vomma: q.vomma ?? calc.vomma,
            charm: q.charm ?? calc.charm,
            speed: q.speed ?? calc.speed,
            zomma: q.zomma ?? calc.zomma,
            color: q.color ?? calc.color,
            greeksSource: q.greeksSource ?? 'black-76',
            greeksMissingReason: q.greeksMissingReason ?? null,
        };
    }

    return {
        ...q,
        iv: sigma,
        forward,
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
        greeksSource: 'black-76',
        greeksMissingReason: null,
    };
}

/**
 * Enrich a futures-priced (VIX/VXN) quote list with per-expiration Black-76
 * greeks. Called from enrichQuotesWithModelGreeks ONLY when
 * settings.vixFuturesPricing is on and the symbol is futures-priced — the
 * caller is responsible for that gating (see src/greeks.ts). Groups quotes by
 * expiration, resolves ONE forward per expiration (never one shared forward
 * across expirations — research plan section 9), and enriches each group
 * against its own forward. Returns the same array reference when nothing
 * changed, matching enrichQuotesWithModelGreeks's contract.
 */
export function enrichFuturesPricedQuotes(quotes: OptionQuote[], riskFree: number = BS_RISK_FREE_RATE): OptionQuote[] {
    if (!quotes.length) return quotes;

    const groups = new Map<string, OptionQuote[]>();
    for (const q of quotes) {
        const arr = groups.get(q.expiration);
        if (arr) arr.push(q); else groups.set(q.expiration, [q]);
    }

    const forwardByExpiration = new Map<string, number | null>();
    groups.forEach((groupQuotes, expiration) => {
        forwardByExpiration.set(expiration, resolveExpirationForward(groupQuotes, expiration, riskFree));
    });

    let changed = false;
    const out = quotes.map((q) => {
        const forward = forwardByExpiration.get(q.expiration) ?? null;
        const next = enrichFuturesPricedQuote(q, forward, riskFree);
        if (next !== q) changed = true;
        return next;
    });
    return changed ? out : quotes;
}
