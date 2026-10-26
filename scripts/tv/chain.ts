/// <reference types="node" />
/// <reference types="bun" />
/**
 * TradingView futures options (ES, NQ, YM, RTY and the micros) as gex cache files, made on the owner's machine from the
 * owner's own TradingView session (never in CI); the files are committed by hand and published with the site (owner 2026-10-25). Pure helpers of `bun run tv:futures` (futures.ts):
 * which option symbols to watch, the scanner request for the greeks, and the cache file in exactly the schema
 * scripts/options-data.ts writes (its own Payload / Quote types and its Python-compatible JSON writer).
 *
 * R1: no model math here. The spot written as `underlyingPrice` is the put-call parity forward from src/vix-pricing.ts
 * `impliedForward` (nearest expiration that resolves), else the futures mid / last; greeks are TradingView's own.
 */
import { join } from 'node:path';
import { impliedForward } from '../../src/vix-pricing';
import type { OptionQuote } from '../../src/types';
import { isoWithOffset, marketDay, mid, PyInt, pyJsonDumps, type GreeksStats, type Payload, type Quote } from '../options-data';
import { cookieHeader, redact, type TvSession, UA } from './env';

/** Where the files go: api/futures/<ROOT>.json (committed by hand). `api/options/ES.json` is the Eversource stock, so not there. */
export const FUTURES_DIR = join(__dirname, '..', '..', 'api', 'futures');
/** The dev server (`bun run start` -> preserve -> ncp api dist/api, then parcel) serves dist/, so the files go there too. */
export const DIST_FUTURES_DIR = join(__dirname, '..', '..', 'dist', 'api', 'futures');

/** Strike window around the forward, each side (owner: at least 5%; Net GEX+ / - need 3% beyond the walls). */
export const WINDOW_PCT = 0.06;
/**
 * Fallback only: the nearest expiration dates kept per root when no monthly (3rd Friday) series is listed on the front
 * contract. The normal coverage is every expiration up to and including the nearest monthly (owner 2026-10-25), see
 * pickSeries.
 */
export const MAX_EXPIRATIONS = 4;
/**
 * Symbols one quote session holds. Measured 2026-10-25: a session answers about 3,500 symbols, every further one comes
 * back as an error; the window through the nearest monthly is about 5,200 ES options, so a root spreads them over
 * several sessions of this size on the same websocket (a second session took the rest with 0 errors).
 */
export const QUOTE_SESSION_LIMIT = 3000;
/** Scanner rows per request; a larger window is read in pages of this size (the scanner caps `range` at 5,000 rows). */
export const SCAN_PAGE = 5000;
/** At most this many scanner pages per root and refresh (a guard, about 25,000 options). */
export const SCAN_MAX_PAGES = 5;
/** Option symbols per quote_add_symbols message. */
export const WS_BATCH = 50;
/** Pause between two quote_add_symbols messages, to stay at a human request rate. */
export const WS_BATCH_PAUSE_MS = 500;
/** Give up waiting for one batch to complete after this long. */
export const WS_BATCH_TIMEOUT_MS = 15000;
/** Max bid / ask spread (fraction of the price) for the futures mid to be used instead of the last price. */
export const MAX_FUTURES_SPREAD = 0.005;
/** Quote fields the quote session asks for (continuous future, front future and options alike). */
export const QUOTE_FIELDS = ['front_contract', 'options-info', 'lp', 'bid', 'ask', 'update_mode', 'oi', 'volume'];

export interface TvRoot {
    /** TradingView continuous symbol of the front month, e.g. CME_MINI:ES1! */
    continuous: string;
}

/** The futures roots, keyed by the gex root (the app ticker is `/ES` or `ES1!`, the file api/futures/ES.json). */
export const TV_ROOTS: Readonly<Record<string, TvRoot>> = {
    ES: { continuous: 'CME_MINI:ES1!' },
    NQ: { continuous: 'CME_MINI:NQ1!' },
    YM: { continuous: 'CBOT_MINI:YM1!' },
    RTY: { continuous: 'CME_MINI:RTY1!' },
    MES: { continuous: 'CME_MINI:MES1!' },
    MNQ: { continuous: 'CME_MINI:MNQ1!' },
    MYM: { continuous: 'CBOT_MINI:MYM1!' },
    M2K: { continuous: 'CME_MINI:M2K1!' },
};
export const DEFAULT_ROOTS: readonly string[] = ['ES', 'NQ', 'YM', 'RTY'];
export const MICRO_ROOTS: readonly string[] = ['MES', 'MNQ', 'MYM', 'M2K'];

export interface Series {
    exp: number;
    expTime: string;
    root: string;
    strikes: number[];
    underlying: string;
}

export interface Family {
    name: string;
    prefix: string;
    exercise?: string;
    description?: string;
    series: Series[];
}

export type QuoteValues = Record<string, unknown>;

/** One option the session watches. */
export interface WantedOption {
    /** full TradingView symbol, e.g. CME_MINI:E4A261026C7630 */
    symbol: string;
    root: string;
    exp: number;
    side: 'call' | 'put';
    strike: number;
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 20261026 -> "2026-10-26" */
export function isoDate(yyyymmdd: number): string {
    const s = String(yyyymmdd);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** TradingView option symbol: <prefix>:<root><YYMMDD><C|P><strike>, e.g. CME_MINI:E4A261026C7630 */
export function optionSymbol(prefix: string, root: string, exp: number, side: 'call' | 'put', strike: number): string {
    return `${prefix}:${root}${String(exp).slice(2)}${side === 'call' ? 'C' : 'P'}${strike}`;
}

/** Strikes within +/- `pct` of `center`, ascending. */
export function strikesInWindow(strikes: readonly number[], center: number, pct: number = WINDOW_PCT): number[] {
    const lo = center * (1 - pct);
    const hi = center * (1 + pct);
    return strikes.filter((k) => k >= lo && k <= hi).sort((a, b) => a - b);
}

/** True when the YYYYMMDD date is the third Friday of its month (the standard monthly expiration day). */
export function isThirdFriday(yyyymmdd: number): boolean {
    const y = Math.floor(yyyymmdd / 10000);
    const m = Math.floor(yyyymmdd / 100) % 100;
    const d = yyyymmdd % 100;
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 5 && d >= 15 && d <= 21;
}

/**
 * The series (still open at `now`) that underlie `underlying`, every family of a picked date. With `max`: the nearest
 * `max` dates. Without it (owner 2026-10-25, futures PR answer 3): every date up to and including the NEAREST MONTHLY
 * expiration, the first open third-Friday date on that contract (EW3 / QN3 / YM3 in a serial month, the quarterly
 * ES / NQ / OYM in March, June, September, December; the EOM series of the last business day are not "the monthly"); when
 * the contract lists no third-Friday date, the nearest MAX_EXPIRATIONS dates.
 */
export function pickSeries(families: readonly Family[], underlying: string, now: Date, max?: number): { family: Family; series: Series }[] {
    const all: { family: Family; series: Series }[] = [];
    for (const family of families) {
        for (const series of family.series) {
            if (series.underlying !== underlying) continue;
            if (!(new Date(series.expTime).getTime() > now.getTime())) continue;
            all.push({ family, series });
        }
    }
    const open = all.map((x) => x.series.exp).filter((d, i, arr) => arr.indexOf(d) === i).sort((a, b) => a - b);
    const monthly = open.find(isThirdFriday);
    const dates = max != null ? open.slice(0, max) : monthly != null ? open.filter((d) => d <= monthly) : open.slice(0, MAX_EXPIRATIONS);
    return all.filter((x) => dates.indexOf(x.series.exp) >= 0).sort((a, b) => a.series.exp - b.series.exp || a.series.root.localeCompare(b.series.root));
}

/** The option symbols to watch: calls and puts of every picked series within the window around `center`. */
export function wantedOptions(families: readonly Family[], front: string, center: number, now: Date, opts: { maxExpirations?: number; windowPct?: number } = {}): WantedOption[] {
    const out: WantedOption[] = [];
    for (const { family, series } of pickSeries(families, front, now, opts.maxExpirations)) {
        for (const strike of strikesInWindow(series.strikes, center, opts.windowPct ?? WINDOW_PCT)) {
            out.push({ symbol: optionSymbol(family.prefix, series.root, series.exp, 'call', strike), root: series.root, exp: series.exp, side: 'call', strike });
            out.push({ symbol: optionSymbol(family.prefix, series.root, series.exp, 'put', strike), root: series.root, exp: series.exp, side: 'put', strike });
        }
    }
    return out;
}

/**
 * Which quote session takes each of `n` new symbols: index into `counts` (the symbols each session holds now), filling
 * the sessions in order up to `limit`; an index >= counts.length means a new session (counts.length = the first new
 * one, and so on).
 */
export function allocateSessions(counts: readonly number[], n: number, limit: number = QUOTE_SESSION_LIMIT): number[] {
    const load = counts.slice();
    const out: number[] = [];
    let i = 0;
    for (let k = 0; k < n; k++) {
        while (i < load.length && load[i] >= limit) i++;
        if (i === load.length) load.push(0);
        load[i]++;
        out.push(i);
    }
    return out;
}

/** The futures price: the mid when the spread is tight, else the last price; null without either. */
export function futuresPrice(v: QuoteValues): { price: number; source: 'mid' | 'last' } | null {
    const bid = numOrNull(v.bid);
    const ask = numOrNull(v.ask);
    const lp = numOrNull(v.lp);
    if (bid != null && ask != null && bid > 0 && ask >= bid) {
        const m = (bid + ask) / 2;
        if ((ask - bid) / m <= MAX_FUTURES_SPREAD) return { price: Math.round(m * 1e6) / 1e6, source: 'mid' };
    }
    return lp != null && lp > 0 ? { price: lp, source: 'last' } : null;
}

/** The option families of a continuous future's `options-info` quote field ([] when it is missing or malformed). */
export function familiesOf(v: QuoteValues | undefined): Family[] {
    const info = v?.['options-info'] as { families?: unknown } | undefined;
    return Array.isArray(info?.families) ? (info.families as Family[]) : [];
}

// ---- scanner (greeks) ------------------------------------------------------------------------------------------------

export const SCAN_URL = 'https://scanner.tradingview.com/options/scan2?label-product=options-builder';
/** Where scanGreeks posts. Mutable for tests only (a local fake server). */
export const TV_SCAN = { url: SCAN_URL };
export const SCAN_COLUMNS = ['name', 'option-type', 'strike', 'expiration', 'root', 'iv', 'delta', 'gamma', 'theta', 'vega', 'rho'];

export interface ScanRow {
    /** symbol without the exchange prefix, e.g. E4A261026C7630 */
    name: string;
    iv: number | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    rho: number | null;
}

/** One scanner request for every watched option of a front contract (`in_range` takes exactly two values, so ranges). */
export function scanBody(front: string, wanted: readonly WantedOption[], offset: number = 0): Record<string, unknown> {
    const exps = wanted.map((w) => w.exp);
    const strikes = wanted.map((w) => w.strike);
    return {
        columns: SCAN_COLUMNS,
        filter: [
            { left: 'type', operation: 'equal', right: 'option' },
            { left: 'expiration', operation: 'in_range', right: [Math.min(...exps), Math.max(...exps)] },
            { left: 'strike', operation: 'in_range', right: [Math.min(...strikes), Math.max(...strikes)] },
        ],
        ignore_unknown_fields: false,
        index_filters: [{ name: 'underlying_symbol', values: [front] }],
        sort: { sortBy: 'strike', sortOrder: 'asc' },
        range: [offset, offset + SCAN_PAGE],
    };
}

/** Scanner rows by name; rows of other roots in the same date range are kept too, the caller looks up its own names. */
export function parseScan(json: unknown): Map<string, ScanRow> {
    const out = new Map<string, ScanRow>();
    const rows = (json as { symbols?: { f?: unknown[] }[] } | null)?.symbols;
    if (!Array.isArray(rows)) return out;
    for (const row of rows) {
        const f = Array.isArray(row?.f) ? row.f : [];
        const name = typeof f[0] === 'string' ? f[0] : '';
        if (!name) continue;
        out.set(name, { name, iv: numOrNull(f[5]), delta: numOrNull(f[6]), gamma: numOrNull(f[7]), theta: numOrNull(f[8]), vega: numOrNull(f[9]), rho: numOrNull(f[10]) });
    }
    return out;
}

/** A scanner answer that must stop requests for a while (429, or 403 = captcha or block). */
export class TvRateLimitError extends Error {}

/** POST the scanner once for `wanted`. Throws TvRateLimitError on 429 / 403, Error on anything else that is not ok. */
export async function scanGreeks(front: string, wanted: readonly WantedOption[], session: TvSession | null): Promise<Map<string, ScanRow>> {
    const out = new Map<string, ScanRow>();
    if (!wanted.length) return out;
    const headers: Record<string, string> = { 'User-Agent': UA, 'Content-Type': 'application/json', Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' };
    if (session) headers.Cookie = cookieHeader(session);
    // pages of SCAN_PAGE rows (sorted by strike, so the pages do not overlap) until a short page
    for (let page = 0; page < SCAN_MAX_PAGES; page++) {
        const res = await fetch(TV_SCAN.url, { method: 'POST', headers, body: JSON.stringify(scanBody(front, wanted, page * SCAN_PAGE)) });
        if (res.status === 429 || res.status === 403) throw new TvRateLimitError(`scanner answered ${res.status}`);
        const text = await res.text();
        if (!res.ok) throw new Error(`scanner ${res.status}: ${redact(text, session).slice(0, 200)}`);
        const rows = parseScan(JSON.parse(text));
        rows.forEach((v, k) => out.set(k, v));
        if (rows.size < SCAN_PAGE) break;
    }
    return out;
}

// ---- the cache file --------------------------------------------------------------------------------------------------

export interface FileInput {
    root: string;
    wanted: readonly WantedOption[];
    /** latest websocket values per full symbol */
    values: ReadonlyMap<string, QuoteValues>;
    /** symbols the session answered with an error (not listed): left out */
    failed: ReadonlySet<string>;
    /** symbols whose first answer is complete: a missing `oi` there means 0 (never traded) */
    completed: ReadonlySet<string>;
    greeks: ReadonlyMap<string, ScanRow>;
    /** the futures price (mid or last), the fallback of the parity forward */
    futures: { price: number; source: 'mid' | 'last' } | null;
    now: Date;
}

export interface FileStats {
    quotes: number;
    withOi: number;
    withGamma: number;
    expirations: number;
    spot: number | null;
    spotSource: 'parity' | 'mid' | 'last' | 'none';
}

/**
 * The cache file of one root in exactly the fetcher's schema (scripts/options-data.ts Payload, written with its
 * pyJsonDumps): `underlyingPrice` = the put-call parity forward of the nearest expiration that resolves (impliedForward),
 * else the futures price; no `forward` field, so every level of the app, the Gamma Flip included, treats it as the spot.
 */
export function buildPayload(input: FileInput): { payload: Payload; stats: FileStats } {
    const quotes: Quote[] = [];
    const forParity: OptionQuote[] = [];
    let withOi = 0;
    let withGamma = 0;
    for (const w of input.wanted) {
        if (input.failed.has(w.symbol)) continue;
        const v = input.values.get(w.symbol);
        const name = w.symbol.slice(w.symbol.indexOf(':') + 1);
        const g = input.greeks.get(name);
        if (!v && !g) continue; // nothing known yet
        const bid = numOrNull(v?.bid);
        const ask = numOrNull(v?.ask);
        const oiValue = numOrNull((v?.oi as { value?: unknown } | undefined)?.value);
        const openInterest = oiValue ?? (input.completed.has(w.symbol) ? 0 : null);
        if (oiValue != null) withOi++;
        if (g?.gamma != null) withGamma++;
        const expiration = isoDate(w.exp);
        const q: Quote = {
            symbol: name,
            expiration,
            side: w.side,
            strike: w.strike,
            bid,
            ask,
            mid: mid(bid, ask),
            last: numOrNull(v?.lp),
            volume: numOrNull(v?.volume),
            openInterest,
            iv: g?.iv ?? null,
            delta: g?.delta ?? null,
            gamma: g?.gamma ?? null,
            theta: g?.theta ?? null,
            vega: g?.vega ?? null,
            rho: g?.rho ?? null,
            greeksSource: g && g.delta != null && g.gamma != null ? 'tradingview' : null,
            greeksMissingReason: g && g.delta != null && g.gamma != null ? null : 'tradingview_missing',
        };
        quotes.push(q);
        forParity.push({ symbol: name, expiration, side: w.side, strike: w.strike, bid, ask, mid: q.mid, last: q.last, volume: q.volume, openInterest, iv: q.iv, delta: q.delta, gamma: q.gamma, theta: q.theta, vega: q.vega });
    }
    quotes.sort((a, b) => (a.expiration < b.expiration ? -1 : a.expiration > b.expiration ? 1 : 0) || Number(a.strike) - Number(b.strike) || (a.side === b.side ? 0 : a.side === 'call' ? -1 : 1));
    const expirations = quotes.map((q) => q.expiration).filter((e, i, arr) => arr.indexOf(e) === i).sort();
    let spot: number | null = null;
    let spotSource: FileStats['spotSource'] = 'none';
    for (const e of expirations) {
        const f = impliedForward(forParity, e);
        if (f != null && Number.isFinite(f) && f > 0) {
            spot = Math.round(f * 100) / 100;
            spotSource = 'parity';
            break;
        }
    }
    if (spot == null && input.futures) {
        spot = input.futures.price;
        spotSource = input.futures.source;
    }
    const missing = quotes.filter((q) => q.greeksSource === null).length;
    const greeks: GreeksStats = {
        enabled: true,
        primarySource: 'tradingview',
        fallbackSource: 'client-black-scholes',
        riskFreeRate: null,
        dividendYield: null,
        total: new PyInt(quotes.length),
        cboeMatched: new PyInt(0),
        computed: new PyInt(0),
        missing: new PyInt(missing),
        cboeContracts: new PyInt(0),
    };
    const payload: Payload = { symbol: input.root, updated: isoWithOffset(input.now), date: marketDay(input.now), underlyingPrice: spot, greeks, expirations, quotes };
    return { payload, stats: { quotes: quotes.length, withOi, withGamma, expirations: expirations.length, spot, spotSource } };
}

/** The file text, byte for byte the way the fetcher writes its files. */
export function payloadText(payload: Payload): string {
    return pyJsonDumps(payload);
}
