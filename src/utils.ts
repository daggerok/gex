/// <reference lib="esnext" />
import { backupStamp, marketDay, snapshotLabel } from './backtest/snapshot';
import { translate, type Language } from './i18n';
import type { DataProvider, OptionQuote } from './types';

// ============================================================================
// DEBUG SYSTEM
// ============================================================================

/**
 * Debug mode is controlled by the `?debug=true` URL parameter.
 * When active, verbose logs are emitted for boot-restore, fetch lifecycle, etc.
 * When inactive, `dbg()` is a no-op with effectively zero runtime cost.
 */
export const DEBUG_ENABLED: boolean = (() => {
    try {
        return new URLSearchParams(window.location.search).get('debug') === 'true';
    } catch { return false; }
})();

/** Conditional debug logger — no-op unless `?debug=true` is in the URL. */
export function dbg(...args: unknown[]): void {
    if (DEBUG_ENABLED) console.log('[DBG]', ...args);
}

if (DEBUG_ENABLED) {
    console.log(
        '%c[DEBUG MODE ACTIVE]%c Add ?debug=true to URL to enable. Remove to disable.',
        'color: #fff; background: #e11d48; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
        'color: #6b7280;',
    );
}

/** Error thrown/detected when a request is intentionally cancelled by the user. */
export function isAbortError(e: unknown): boolean {
    return e instanceof DOMException ? e.name === 'AbortError'
        : (e instanceof Error && e.name === 'AbortError');
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

/** Normalize a value that an API may return as either an array or a single
 *  object (Tradier does this for singletons) into a proper array. */
export function asArray<T>(v: T | T[] | null | undefined): T[] {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
}

/**
 * Parse an OCC-style option symbol into its components.
 * Format: ROOT + YYMMDD + (C|P) + STRIKE*1000 (8 digits, zero-padded).
 * Example: "AAPL260717C00110000" -> exp 2026-07-17, call, strike 110.
 * Returns null if the symbol does not match.
 */
export function parseOccSymbol(sym: string): { expiration: string; side: 'call' | 'put'; strike: number } | null {
    const m = /^[.\-A-Z0-9]*?(\d{6})([CP])(\d{8})$/.exec(sym);
    if (!m) return null;
    const [, yymmdd, cp, strikeRaw] = m;
    const yy = Number(yymmdd.slice(0, 2));
    const mm = yymmdd.slice(2, 4);
    const dd = yymmdd.slice(4, 6);
    // OCC dates are 21st-century; 2000 + yy is correct for the foreseeable future.
    const expiration = `20${String(yy).padStart(2, '0')}-${mm}-${dd}`;
    const side = cp === 'C' ? 'call' : 'put';
    const strike = Number(strikeRaw) / 1000;
    return { expiration, side, strike };
}

/** Compute a mid price from bid/ask when both are usable, else null. */
export function computeMid(bid: number | null, ask: number | null): number | null {
    if (bid == null || ask == null || bid <= 0 || ask <= 0) return null;
    return (bid + ask) / 2;
}

/** Coerce arbitrary JSON numbers to `number | null` (treats 0 as valid). */
export function num(v: unknown): number | null {
    const n = typeof v === 'string' ? Number(v) : (v as number);
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Format a number for display; missing data renders as an empty cell. */
// `Number#toLocaleString(undefined, options)` builds a new Intl.NumberFormat on EVERY call, which is slow: the Cursor card, the
// tables and the axis labels call these dozens of times for every mouse move over the GEX chart, and it was the single biggest
// cost of a move (measured with a CPU profile). One formatter per digit count, created once, gives exactly the same text.
const numberFormats = new Map<number, Intl.NumberFormat>();
function numberFormat(digits: number): Intl.NumberFormat {
    let f = numberFormats.get(digits);
    if (!f) {
        f = new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
        numberFormats.set(digits, f);
    }
    return f;
}
let integerFormat: Intl.NumberFormat | null = null;

export function fmt(v: number | null | undefined, digits = 2): string {
    if (v == null || !Number.isFinite(v)) return '';
    return numberFormat(digits).format(v);
}

/** Format an integer-ish value (volume / OI) with thousands separators. */
export function fmtInt(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '';
    return (integerFormat ??= new Intl.NumberFormat()).format(Math.round(v));
}

/** 2140000000 -> "2.14B" (absolute value, 2 decimals, K/M/B/T suffix). Used by the GEX and Board tabs. */
export function fmtCompact(v: number): string {
    const a = Math.abs(v);
    const [div, suffix] = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
    return (a / div).toFixed(2) + suffix;
}

/** Signed compact: +2.14B / -310.50M / 0.00. */
export function fmtSignedCompact(v: number): string {
    return (v > 0 ? '+' : v < 0 ? '-' : '') + fmtCompact(v);
}

/** Fractional days to an expiration (Sigma tooltip): 2 decimals below 1 day (0.17 = 4 hours), 1 decimal from there. */
export function fmtDays(days: number): string {
    if (!Number.isFinite(days)) return '';
    return days.toFixed(days < 1 ? 2 : 1);
}

/** How old the loaded cache data is (GEX-H4), from the file's `updated` stamp and trading day `date`. */
export interface DataAge {
    /** `YYYY-MM-DD HH:mm`, New York time, when the file was written */
    at: string;
    /** the trading day the data belongs to */
    day: string;
    /** calendar days from that trading day to the current one (0 = current) */
    daysOld: number;
    /** the data belongs to an earlier trading day than the current one */
    stale: boolean;
}

/**
 * Data age of a cache file, null without a readable `updated` (live providers). The trading day is the file's `date` (else
 * the trading day of `updated`), "current" is the trading day of `now` (marketDay: before 9:30 and on weekends still the
 * previous weekday, so Friday's close is not stale over the weekend).
 */
export function dataAge(updated: string | null | undefined, dataDate: string | null | undefined, now: Date = new Date()): DataAge | null {
    const t = updated ? Date.parse(updated) : NaN;
    if (!Number.isFinite(t)) return null;
    const at = new Date(t);
    const day = dataDate && /^\d{4}-\d{2}-\d{2}$/.test(dataDate) ? dataDate : marketDay(at);
    const today = marketDay(now);
    const daysOld = Math.max(0, Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000));
    return { at: snapshotLabel(backupStamp(at)), day, daysOld, stale: day < today };
}

/** An expiration's OI share (0..1) as the Expirations panel shows it: "6.4%", "12.3%", "100%"; empty when there is none. */
export function oiSharePct(share: number | null | undefined): string {
    if (typeof share !== 'number' || !Number.isFinite(share)) return '';
    return share >= 0.9995 ? '100%' : `${(share * 100).toFixed(1)}%`;
}

/** Format implied volatility (decimal) as a percentage string. */
export function fmtPct(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '';
    return `${(v * 100).toFixed(1)}%`;
}

/** Format greeks; missing values stay visually empty, while real zero prints as 0.0000. */
export function fmtGreek(v: number | null | undefined, digits = 4): string {
    if (v == null || !Number.isFinite(v)) return '';
    return v.toFixed(digits);
}

/** Convert a "YYYY-MM-DD" date to unix seconds (UTC midnight). */
export function isoToUnix(iso: string): number {
    return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 1000);
}

/**
 * Build a proxied URL from the user's proxy template.
 * The template must contain "{url}", which is replaced by the URL-encoded target.
 */
export function proxied(target: string, template: string): string {
    if (!template || !template.includes('{url}')) return target;
    return template.replace('{url}', encodeURIComponent(target));
}

/**
 * Estimate the underlying spot via put-call parity for providers that do not
 * return it. At the strike where |callMid - putMid| is smallest, the underlying
 * is approximately: S ≈ K + (callMid - putMid). Returns null if not derivable.
 */
export function estimateSpot(quotes: OptionQuote[], expiration: string): number | null {
    const byStrike = new Map<number, { c?: number; p?: number }>();
    for (const q of quotes) {
        if (q.expiration !== expiration) continue;
        const mid = q.mid ?? q.last;
        if (mid == null) continue;
        const slot = byStrike.get(q.strike) ?? {};
        if (q.side === 'call') slot.c = mid; else slot.p = mid;
        byStrike.set(q.strike, slot);
    }
    let bestDiff = Infinity;
    let bestSpot: number | null = null;
    // NOTE: use Map.prototype.forEach rather than `for...of byStrike` (or even
    // `for...of byStrike.entries()` / `Array.from(byStrike.entries())`). Any form
    // that ITERATES a Map goes through the iteration protocol, which TypeScript
    // rejects with TS2802 unless the consuming tsconfig has `target` >= ES2015 or
    // the `downlevelIteration` flag. `forEach` is a plain method call — no
    // iteration protocol — so it type-checks under ANY target/tsconfig.
    byStrike.forEach(({ c, p }, strike) => {
        if (c == null || p == null) return;
        const diff = Math.abs(c - p);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestSpot = strike + (c - p); // put-call parity approximation
        }
    });
    dbg('estimateSpot', { expiration, bestSpot });
    return bestSpot;
}

/**
 * An error the user reads: its text is an i18n key with params (GEX-H8), so it shows in the app language wherever it is
 * displayed (friendlyError, errorText). `message` is the English text, for logs and tests.
 */
export class UiError extends Error {
    readonly key: string;
    readonly params?: Record<string, string | number>;
    constructor(key: string, params?: Record<string, string | number>) {
        super(translate(key, 'en', params));
        this.name = 'UiError';
        this.key = key;
        this.params = params;
    }
}

/** The text of any error in `lang`: a UiError translated, anything else its message. */
export function errorText(e: unknown, lang: Language): string {
    if (e instanceof UiError) return translate(e.key, lang, e.params);
    return e instanceof Error ? e.message : String(e);
}

/**
 * Map raw fetch/parse failures to a friendly, actionable message.
 * Keeps the UI human-readable instead of leaking stack traces or JSON parse
 * errors like "Unexpected token '<'".
 */
export function friendlyError(e: unknown, provider: DataProvider, lang: Language): string {
    if (e instanceof UiError) return errorText(e, lang);
    const msg = (e instanceof Error ? e.message : String(e)) || '';
    if (/^[A-Z].*[.?!]$/.test(msg) && msg.length < 240 && !msg.includes('Unexpected token')) {
        return msg;
    }
    if (msg.includes('Failed to fetch') || msg.toLowerCase().includes('networkerror')) {
        if (provider.needsProxyBase) {
            return translate('error.friendly.networkProxy', lang);
        }
        return provider.needsProxy
            ? translate('error.friendly.networkCors', lang)
            : translate('error.friendly.networkGeneric', lang);
    }
    if (msg.includes('Unexpected token') || msg.toLowerCase().includes('json')) {
        return translate('error.friendly.unexpectedJson', lang);
    }
    return msg || translate('error.friendly.generic', lang);
}
