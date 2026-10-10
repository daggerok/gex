#!/usr/bin/env bun
/**
 * =============================================================================
 * GEX - build-time options data fetcher (Bun TypeScript)
 * =============================================================================
 *
 * The only fetcher (the Python/yfinance version was removed 2026-10-10, history in
 * agentic-workspace docs/repos/gex/spec-ts-fetcher.md). Yahoo is reached with raw calls
 * (cookie + crumb, then v7 options and v8 chart), Cboe delayed greeks are overlaid.
 * Output files keep the byte layout the Python version wrote (key order, Python float
 * repr, ensure_ascii escapes), so existing data/options/*.json files stay valid.
 *
 * Keep this header in sync with behavior on every change.
 * Not part of the app bundle, never imported by src/ (tests import its helpers).
 *
 * CHANGELOG (newest first)
 *   t5 - Chart cache: after the options pass every cached ticker (SPY, SPX, QQQ, NDX first) gets
 *        data/charts/<SYM>.json with 1Y of daily bars from Yahoo v8 chart, so the Chart tab works
 *        without a proxy. Missing files first, then oldest, at most CHART_MAX_FETCHES per run.
 *   t4 - SPY, SPX, QQQ and NDX are always queued first (PRIORITY_SYMBOLS, unless fresh), before the
 *        coverage and refresh phases; with an explicit TICKERS list only those in the list.
 *   t3 - Python fetcher removed. Cboe requests share one throttle (CBOE_MIN_INTERVAL), a 429 pauses
 *        every worker (CBOE_BACKOFF, CBOE_RETRIES) and, once retries run out, fails the ticker so its
 *        file is not rewritten without greeks.
 *   t2 - Sibling-style console output ([ config   ] / [ queue    ] / one status line per
 *        ticker / [ done     ]) and CONCURRENCY workers, each with its own REQUEST_SLEEP lane.
 *        The legacy timestamped lines moved behind VERBOSE=1. Files are still written on every
 *        successful fetch (freshness reads `updated`); only the status label is new.
 *   t1 - Initial port of options-data.py v13:
 *        * No dependencies: Bun fetch only (no yfinance, no requests, no pandas).
 *        * Output files are byte-compatible with the Python ones: key order,
 *          Python float repr (1.0, 1e-05), ensure_ascii escapes, indent and
 *          separators, trailing newline in index.json.
 *        * No model greeks here (R1): Cboe delayed 1st-order greeks are passed
 *          through, higher-order greeks are computed only by the UI.
 *
 * WHAT IT DOES
 *   1. Builds a UNIVERSE of optionable US underlyings: TICKERS override, else
 *      the NASDAQ screener (market-cap order) merged with the Cboe optionable
 *      directory, else Cboe alone, else the tiny built-in list.
 *   2. Builds a WORK QUEUE: missing symbols first (universe order), then stale
 *      cached files oldest-updated first. The skiplist of no-options tickers is
 *      honored for SKIP_RECHECK_DAYS.
 *   3. Fetches the chain from Yahoo, overlays Cboe delayed greeks, open
 *      interest and volume by OCC symbol, writes data/options/{SYMBOL}.json.
 *      Stops at MAX_FETCHES writes or after RATE_LIMIT_HITS consecutive errors.
 *   4. Rewrites data/options/index.json only when the ticker set, names or
 *      skiplist changed.
 *
 * YAHOO ENDPOINT MAPPING (what yfinance did, now done directly)
 *   Ticker(sym).options        GET query2/v7/finance/options/{sym}?crumb=...
 *   Ticker.option_chain(date)  GET query2/v7/finance/options/{sym}?date={unix}&crumb=...
 *   _spot -> history("1d")     GET query2/v8/finance/chart/{sym}?range=1d&interval=1d
 *                              &includePrePost=false&events=div,splits,capitalGains
 *   cookie + crumb             GET fc.yahoo.com (Set-Cookie), then
 *                              GET query1/v1/test/getcrumb with that cookie
 *   NOTE: the Python _spot calls fast_info.get("last_price"), but FastInfo.get
 *   only knows camelCase keys, so it always returns None and the spot has always
 *   come from history(period="1d") (the auto-adjusted Close of the last daily
 *   bar, that is Yahoo's adjclose). This port does the same on purpose.
 *
 * USAGE
 *   ./scripts/options-data.ts                       # smart auto-universe run
 *   TICKERS="AAPL MSFT" ./scripts/options-data.ts   # only these
 *   MAX_FETCHES=50 MAX_EXPIRATIONS=8 ./scripts/options-data.ts
 *
 * TUNABLES (env, identical to the Python script)
 *   MAX_FETCHES        default 500       successful writes per run
 *   UNIVERSE_SIZE      default 6000      symbols considered
 *   MIN_MARKET_CAP     default 9000000   USD floor for NASDAQ rows
 *   NASDAQ_TIMEOUT     default 20        seconds before falling back to Cboe
 *   MAX_EXPIRATIONS    default 12        expirations stored per ticker
 *   RATE_LIMIT_HITS    default 3         consecutive errors that mean "blocked"
 *   REQUEST_SLEEP      default 0.6       seconds after each successful write
 *   SKIP_RECHECK_DAYS  default 30        days before a no-options ticker is retried
 *   CBOE_GREEKS        default 1         Cboe delayed greeks overlay
 *   CBOE_GREEKS_TIMEOUT default 10       seconds per Cboe request
 *   CBOE_MIN_INTERVAL  default 1         min seconds between Cboe requests, shared by all workers (0 = off)
 *   CBOE_BACKOFF       default 30        first pause after a Cboe 429, doubles per retry; all workers wait
 *   CBOE_RETRIES       default 3         retries of one Cboe request after 429; then the ticker fails
 *                                        (counts toward RATE_LIMIT_HITS and its file is NOT overwritten)
 *   SYMBOL_ALIASES     default ""        "SCREENER=YAHOO" pairs, comma separated
 *   TIMEZONE           default America/New_York   market tz for today / working days
 *   CHART_CACHE        default 1         also write data/charts/<SYM>.json (1Y of daily bars) after the options pass
 *   CHART_MAX_FETCHES  default 500       chart files written per run (missing first, then oldest)
 *   CONCURRENCY        default 1         parallel ticker workers (integer >= 1), 1 = old sequential run
 *   SOFT_DEADLINE_SECONDS default 0      stop starting new tickers after N seconds (0 = off)
 *   VERBOSE            default off       also print the legacy timestamped progress lines
 *   TICKERS / TICKER   explicit universe override
 * =============================================================================
 */

/// <reference types="node" />
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

// ---- Python-compatible number and JSON formatting ---------------------------

/** Marks a value that Python would print as an int (no ".0"). */
export class PyInt {
    constructor(public readonly value: number) {}
}

/** Python repr(float) for a finite JS number (1.0, 1e-05, 1e+16, 0.0001). */
export function pyFloatRepr(x: number): string {
    if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
    const neg = x < 0;
    const [mant, expStr] = Math.abs(x).toExponential().split("e"); // shortest digits
    const digits = mant.replace(".", "");
    const exp = Number(expStr); // decimal exponent of the first digit
    let out: string;
    if (exp < -4 || exp >= 16) {
        const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
        const e = Math.abs(exp);
        out = `${m}e${exp < 0 ? "-" : "+"}${e < 10 ? "0" : ""}${e}`;
    } else if (exp >= 0) {
        const intLen = exp + 1;
        out = digits.length <= intLen
            ? digits + "0".repeat(intLen - digits.length) + ".0"
            : `${digits.slice(0, intLen)}.${digits.slice(intLen)}`;
    } else {
        out = `0.${"0".repeat(-exp - 1)}${digits}`;
    }
    return neg ? `-${out}` : out;
}

/** json.dumps string escaping with ensure_ascii=True. */
export function pyJsonString(s: string): string {
    let out = '"';
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        const ch = s[i];
        if (ch === '"') out += '\\"';
        else if (ch === "\\") out += "\\\\";
        else if (c === 10) out += "\\n";
        else if (c === 13) out += "\\r";
        else if (c === 9) out += "\\t";
        else if (c === 8) out += "\\b";
        else if (c === 12) out += "\\f";
        else if (c < 0x20 || c > 0x7e) out += "\\u" + c.toString(16).padStart(4, "0");
        else out += ch;
    }
    return out + '"';
}

/**
 * Python json.dump equivalent. Plain JS numbers are floats (Python float repr),
 * PyInt values are ints. indent=undefined -> separators (",", ":"), indent=N ->
 * Python's default indented layout.
 */
export function pyJsonDumps(value: unknown, indent?: number, level = 0): string {
    if (value === null || value === undefined) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof PyInt) return String(value.value);
    if (typeof value === "number") return Number.isFinite(value) ? pyFloatRepr(value) : "null";
    if (typeof value === "string") return pyJsonString(value);
    const nl = indent === undefined ? "" : "\n" + " ".repeat(indent * (level + 1));
    const nlEnd = indent === undefined ? "" : "\n" + " ".repeat(indent * level);
    const sep = ",";
    if (Array.isArray(value)) {
        if (!value.length) return "[]";
        return "[" + nl + value.map((v) => pyJsonDumps(v, indent, level + 1)).join(sep + nl) + nlEnd + "]";
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return "{}";
    const kv = indent === undefined ? ":" : ": ";
    return "{" + nl + entries.map(([k, v]) => pyJsonString(k) + kv + pyJsonDumps(v, indent, level + 1)).join(sep + nl) + nlEnd + "}";
}

const PY_FLOAT_RE = /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan)$/i;

/** Python float(str) or null when Python would raise ValueError. */
export function pyParseFloat(text: string): number | null {
    const t = text.trim();
    if (!PY_FLOAT_RE.test(t)) return null;
    const low = t.toLowerCase().replace(/^[+-]/, "");
    if (low === "nan") return NaN;
    if (low.startsWith("inf")) return t.startsWith("-") ? -Infinity : Infinity;
    return Number(t);
}

/** Python int(str) or null when Python would raise ValueError. */
export function pyParseInt(text: string): number | null {
    const t = text.trim();
    if (!/^[+-]?\d+(?:_\d+)*$/.test(t)) return null;
    return Number(t.replace(/_/g, ""));
}

/** _num(): coerce to a finite float or null (NaN, inf and junk become null). */
export function num(v: unknown): number | null {
    let f: number;
    if (typeof v === "number") f = v;
    else if (typeof v === "boolean") f = v ? 1 : 0;
    else if (typeof v === "string") {
        const p = pyParseFloat(v);
        if (p === null) return null;
        f = p;
    } else return null;
    return Number.isFinite(f) ? f : null;
}

function envInt(name: string, def: string): number {
    const raw = process.env[name] ?? def;
    const v = pyParseInt(raw);
    if (v === null) throw new Error(`ValueError: invalid literal for int() with base 10: '${raw}' (${name})`);
    return v;
}

function envFloat(name: string, def: string): number {
    const raw = process.env[name] ?? def;
    const v = pyParseFloat(raw);
    if (v === null) throw new Error(`ValueError: could not convert string to float: '${raw}' (${name})`);
    return v;
}

/** Strict integer >= 1 (CONCURRENCY): invalid input is an error, never a silent fallback. */
function envPositiveInt(name: string, def: string): number {
    const v = envInt(name, def);
    if (v < 1) throw new Error(`${name} must be an integer >= 1, got ${v}`);
    return v;
}

/** Strict number >= 0 (SOFT_DEADLINE_SECONDS, 0 = off). */
function envNonNegativeFloat(name: string, def: string): number {
    const v = envFloat(name, def);
    if (!(v >= 0)) throw new Error(`${name} must be a number >= 0, got ${v}`);
    return v;
}

// ---- Market timezone ---------------------------------------------------------

const MARKET_TZ_NAME = process.env.TIMEZONE ?? "America/New_York";

function resolveTz(name: string): string {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: name });
        return name;
    } catch {
        console.error(`  ! unknown TIMEZONE=${JSON.stringify(name)}; falling back to UTC`);
        return "UTC";
    }
}

export const MARKET_TZ = resolveTz(MARKET_TZ_NAME);

export interface Wall {
    year: number;
    month: number; // 1-12
    day: number;
    hour: number;
    minute: number;
    second: number;
    ms: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock components of an instant in the given IANA timezone. */
export function wallClock(date: Date, tz: string = MARKET_TZ): Wall {
    let f = fmtCache.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat("en-US", {
            timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
            hour: "numeric", minute: "numeric", second: "numeric",
        });
        fmtCache.set(tz, f);
    }
    const p: Record<string, number> = {};
    for (const part of f.formatToParts(date)) if (part.type !== "literal") p[part.type] = Number(part.value);
    return {
        year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second,
        ms: ((date.getTime() % 1000) + 1000) % 1000,
    };
}

/** Wall clock as a UTC-epoch number, so wall times compare like Python's same-tzinfo aware datetimes. */
export function wallMs(w: Wall): number {
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, w.ms);
}

function pad(n: number, w = 2): string {
    return String(n).padStart(w, "0");
}

/** datetime.now(tz).isoformat() equivalent, with the offset (e.g. 2026-07-10T14:32:05.123000-04:00). */
export function isoWithOffset(date: Date = new Date(), tz: string = MARKET_TZ): string {
    const w = wallClock(date, tz);
    const offMin = Math.round((wallMs(w) - Math.floor(date.getTime() / 1000) * 1000 - w.ms) / 60000);
    const sign = offMin < 0 ? "-" : "+";
    const a = Math.abs(offMin);
    const frac = w.ms ? `.${pad(w.ms, 3)}000` : "";
    return `${w.year.toString().padStart(4, "0")}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${frac}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export interface CalDate {
    year: number;
    month: number;
    day: number;
}

export function todayDate(now: Date = new Date(), tz: string = MARKET_TZ): CalDate {
    const w = wallClock(now, tz);
    return { year: w.year, month: w.month, day: w.day };
}

export function dateIso(d: CalDate): string {
    return `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;
}

function calMs(d: CalDate): number {
    return Date.UTC(d.year, d.month - 1, d.day);
}

function addDays(d: CalDate, n: number): CalDate {
    const t = new Date(calMs(d) + n * 86400000);
    return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Python weekday(): Monday=0 ... Sunday=6. */
function weekday(d: CalDate): number {
    return (new Date(calMs(d)).getUTCDay() + 6) % 7;
}

function nowIso(): string {
    return isoWithOffset(new Date());
}

/** Presentation only: the legacy timestamped progress lines are printed when VERBOSE is on (the parity harness sets it). */
export function isVerbose(env: Record<string, string | undefined> = process.env): boolean {
    return /^(1|true|yes|on)$/i.test(env.VERBOSE ?? "");
}

function log(message: string): void {
    if (isVerbose()) console.log(`[${nowIso()}] ${message}`);
}

function logErr(message: string): void {
    console.error(`[${nowIso()}] ${message}`);
}

// ---- Configuration -----------------------------------------------------------

const REPO_ROOT = dirname(import.meta.dirname);
export const DATA_DIR = join(REPO_ROOT, "data", "options");
export const INDEX_PATH = join(DATA_DIR, "index.json");
const LEGACY_SKIP_PATH = join(import.meta.dirname, "no_options.json");

const cfg = {
    MAX_FETCHES: envInt("MAX_FETCHES", "500"),
    UNIVERSE_SIZE: envInt("UNIVERSE_SIZE", "6000"),
    MIN_MARKET_CAP: envFloat("MIN_MARKET_CAP", "9000000"),
    MAX_EXPIRATIONS: envInt("MAX_EXPIRATIONS", "12"),
    RATE_LIMIT_HITS: envInt("RATE_LIMIT_HITS", "3"),
    REQUEST_SLEEP: envFloat("REQUEST_SLEEP", "0.6"),
    NASDAQ_TIMEOUT: envFloat("NASDAQ_TIMEOUT", "20"),
    SKIP_RECHECK_DAYS: envInt("SKIP_RECHECK_DAYS", "30"),
    CBOE_GREEKS: !["0", "false", "no", "off"].includes((process.env.CBOE_GREEKS ?? "1").toLowerCase()),
    CBOE_GREEKS_TIMEOUT: envFloat("CBOE_GREEKS_TIMEOUT", "10"),
    CBOE_MIN_INTERVAL: envNonNegativeFloat("CBOE_MIN_INTERVAL", "1"),
    CBOE_BACKOFF: envNonNegativeFloat("CBOE_BACKOFF", "30"),
    CBOE_RETRIES: envInt("CBOE_RETRIES", "3"),
    CONCURRENCY: envPositiveInt("CONCURRENCY", "1"),
    CHART_MAX_FETCHES: envInt("CHART_MAX_FETCHES", "500"),
    CHART_CACHE: !["0", "false", "no", "off"].includes((process.env.CHART_CACHE ?? "1").toLowerCase()),
    SOFT_DEADLINE_SECONDS: envNonNegativeFloat("SOFT_DEADLINE_SECONDS", "0"),
};

// ---- Ticker symbol aliases ---------------------------------------------------

export const SYMBOL_ALIASES: Record<string, string> = {
    "BRK.B": "BRK-B",
    "BRK/B": "BRK-B",
    BRKB: "BRK-B",
    "BF.B": "BF-B",
    "BF/B": "BF-B",
    "HEI.A": "HEI-A",
    "LEN.B": "LEN-B",
};

/** Merge "SCREENER=YAHOO,FOO=BAR" style aliases (the SYMBOL_ALIASES env). */
export function mergeAliases(raw: string, into: Record<string, string> = SYMBOL_ALIASES): void {
    for (const pair of raw.split(",")) {
        const i = pair.indexOf("=");
        if (i < 0) continue;
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (k && v) into[k.toUpperCase()] = v.toUpperCase();
    }
}
mergeAliases(process.env.SYMBOL_ALIASES ?? "");

const CBOE_UNDERLYINGS_URL =
    "https://cdn.cboe.com/data/us/options/market_statistics/symbol_reference/opt-underlying.csv";

const FALLBACK_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "BRK.B", "AVGO",
    "JPM", "LLY", "V", "XOM", "UNH", "MA", "COST", "HD", "PG", "JNJ", "WMT",
    "NFLX", "BAC", "ORCL", "CRM", "AMD", "KO", "PEP", "TMUS", "ADBE", "CVX",
    "QQQ", "SPY", "IWM", "DIA",
];

/** TICKER -> human name, filled by universe discovery, persisted by writeIndex. */
export const SYMBOL_NAMES = new Map<string, string>();

export function canonical(sym: string, aliases: Record<string, string> = SYMBOL_ALIASES): string {
    const s = sym.toUpperCase().trim();
    if (Object.prototype.hasOwnProperty.call(aliases, s)) return aliases[s];
    return s.replaceAll(".", "-").replaceAll("/", "-");
}

export function cleanCompanyName(name: unknown): string {
    const text = String(name ?? "").trim().split(/[\s\x1c-\x1f\x85]+/).filter(Boolean).join(" ");
    return ["", "none", "null", "nan", "--", "n/a"].includes(text.toLowerCase()) ? "" : text;
}

function rememberSymbolName(sym: string, name: unknown): void {
    const symbol = canonical(sym);
    const company = cleanCompanyName(name);
    if (symbol && company) SYMBOL_NAMES.set(symbol, company);
}

export function dedupe<T>(seq: T[]): T[] {
    const seen = new Set<T>();
    const out: T[] = [];
    for (const s of seq) {
        if (s && !seen.has(s)) {
            seen.add(s);
            out.push(s);
        }
    }
    return out;
}

/** Candidate Yahoo spellings to try in order (dash, dot, slash, stripped, index forms). */
export function symbolVariants(sym: string): string[] {
    const raw = sym.toUpperCase().trim();
    const canon = canonical(raw);
    const base = raw.replaceAll(".", "").replaceAll("/", "").replaceAll("-", "");
    const variants: string[] = [canon];
    if (/[./-]/.test(raw)) {
        for (const sep of [".", "/", "-"]) {
            if (raw.includes(sep)) {
                const i = raw.indexOf(sep);
                const left = raw.slice(0, i);
                const right = raw.slice(i + 1);
                variants.push(`${left}-${right}`, `${left}.${right}`, `${left}/${right}`);
                break;
            }
        }
        variants.push(base);
    }
    variants.push(raw);
    variants.push(`^${base}`);
    variants.push(`^${raw}`);
    return dedupe(variants);
}

export function mid(bid: number | null, ask: number | null): number | null {
    if (bid !== null && ask !== null && bid > 0 && ask > 0) return (bid + ask) / 2.0;
    return null;
}

// ---- Working-day / freshness helpers -----------------------------------------

export const US_MARKET_HOLIDAYS = new Set([
    "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
    "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
    "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

export function isTradingDay(d: CalDate): boolean {
    if (weekday(d) >= 5) return false;
    return !US_MARKET_HOLIDAYS.has(dateIso(d));
}

export function lastTradingDay(ref: CalDate): CalDate {
    let d = ref;
    for (let i = 0; i < 10; i++) {
        if (isTradingDay(d)) return d;
        d = addDays(d, -1);
    }
    return d;
}

/** Parse a stored `updated` ISO string (date, datetime, optional offset or Z) to an instant, or null. */
export function parseIsoInstant(text: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?)?(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2})?)?)?$/.exec(
        text.trim(),
    );
    if (!m) return null;
    const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "", off] = m;
    const ms = frac ? Number(frac.padEnd(3, "0").slice(0, 3)) : 0;
    let t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
    if (Number.isNaN(t) || Number(mo) > 12 || Number(mo) < 1 || Number(d) > 31) return null;
    if (off && off !== "Z") {
        const sign = off[0] === "-" ? -1 : 1;
        const digits = off.slice(1).replace(/:/g, "");
        const oh = Number(digits.slice(0, 2));
        const om = Number(digits.slice(2, 4) || "0");
        const os = Number(digits.slice(4, 6) || "0");
        t -= sign * ((oh * 60 + om) * 60 + os) * 1000;
    }
    return new Date(t);
}

/** The Python _file_is_fresh rule (kept for parity, unused by the queue). */
export function fileIsFresh(updatedIso: string, now: Date = new Date(), tz: string = MARKET_TZ): boolean {
    const day = String(updatedIso).slice(0, 10);
    if (!day) return false;
    const today = todayDate(now, tz);
    if (day === dateIso(today)) return true;
    if (!isTradingDay(today)) return day >= dateIso(lastTradingDay(today));
    return false;
}

/**
 * Weekend dead zone rule (is_fresh): everything is stale except between Friday
 * 20:00 and Sunday 18:00 market time, when a file updated after Friday 20:00 is fresh.
 * `updatedStr` is the stored ISO string, naive values are taken as UTC.
 */
export function isFreshAt(updatedStr: string, now: Date = new Date(), tz: string = MARKET_TZ): boolean {
    if (!updatedStr) return false;
    const inst = parseIsoInstant(updatedStr);
    if (!inst) return false;
    const updatedWall = wallMs(wallClock(inst, tz));
    const nowWall = wallClock(now, tz);
    const today: CalDate = { year: nowWall.year, month: nowWall.month, day: nowWall.day };
    const friOffset = 4 - weekday(today);
    const fri = addDays(today, friOffset);
    const dzStart = Date.UTC(fri.year, fri.month - 1, fri.day, 20, 0, 0, 0);
    const dzEnd = dzStart + (2 * 24 - 2) * 3600 * 1000;
    const nowMs = wallMs(nowWall);
    if (dzStart <= nowMs && nowMs < dzEnd) {
        if (updatedWall >= dzStart) return true;
    }
    return false;
}

/** strptime("%Y-%m-%d") of the first 10 chars, or null. */
function parseDay(text: string): CalDate | null {
    const s = String(text).slice(0, 10);
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) return null;
    const d: CalDate = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    const t = new Date(calMs(d));
    if (t.getUTCFullYear() !== d.year || t.getUTCMonth() + 1 !== d.month || t.getUTCDate() !== d.day) return null;
    return d;
}

/** True while a skiplist entry is inside its re-check window. */
export function skipIsActive(lastChecked: unknown, recheckDays: number = cfg.SKIP_RECHECK_DAYS, now: Date = new Date()): boolean {
    const d = parseDay(String(lastChecked));
    if (!d) return false;
    const age = Math.round((calMs(todayDate(now)) - calMs(d)) / 86400000);
    return age < recheckDays;
}

// ---- Yahoo access (replaces yfinance) -----------------------------------------

const YAHOO_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const YAHOO_BASE = "https://query2.finance.yahoo.com";

export class YahooRateLimitError extends Error {
    constructor() {
        super("Too Many Requests. Rate limited. Try after a while.");
    }
}

interface YahooSession {
    cookie: string;
    crumb: string | null;
}
let yahooSession: YahooSession | null = null;

function cookieHeader(res: Response): string {
    const h = res.headers as unknown as { getSetCookie?: () => string[] };
    const list = h.getSetCookie?.() ?? [];
    const single = res.headers.get("set-cookie");
    const all = list.length ? list : single ? [single] : [];
    return all.map((c) => c.split(";")[0]).join("; ");
}

async function newYahooSession(): Promise<YahooSession> {
    let cookie = "";
    const seed = await fetch("https://fc.yahoo.com/", {
        headers: { "User-Agent": YAHOO_UA, Accept: "text/html" },
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    if (seed) cookie = cookieHeader(seed);
    if (!cookie) {
        const seed2 = await fetch("https://finance.yahoo.com/", {
            headers: { "User-Agent": YAHOO_UA, Accept: "text/html" },
            redirect: "manual",
            signal: AbortSignal.timeout(30000),
        }).catch(() => null);
        if (seed2) cookie = cookieHeader(seed2);
    }
    const res = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
        headers: { "User-Agent": YAHOO_UA, Cookie: cookie, Accept: "text/plain" },
        signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (res.status === 429 || text.includes("Too Many Requests")) throw new YahooRateLimitError();
    const crumb = text && !text.includes("<html>") ? text : null;
    return { cookie, crumb };
}

let yahooSessionFlight: Promise<YahooSession> | null = null;

/**
 * Shared crumb/cookie session. `stale` is the session a caller just saw fail: when another worker already replaced it
 * the current one is returned, and concurrent refreshes share one in-flight request (no thundering herd).
 * `onRateLimit` maps a 429 on the crumb request to the degraded session instead of an error.
 */
async function ensureYahooSession(stale: YahooSession | null, onRateLimit: (old: YahooSession | null) => YahooSession): Promise<YahooSession> {
    if (yahooSession && yahooSession !== stale) return yahooSession;
    if (!yahooSessionFlight) {
        const old = yahooSession;
        yahooSessionFlight = (async () => {
            try {
                yahooSession = await newYahooSession();
            } catch (e) {
                if (!(e instanceof YahooRateLimitError)) throw e;
                yahooSession = onRateLimit(old);
            }
            return yahooSession;
        })().finally(() => {
            yahooSessionFlight = null;
        });
    }
    return yahooSessionFlight;
}

/** yfinance YfData.get: crumb + cookie, one retry with a fresh session on HTTP >= 400, 429 -> error. */
export async function yahooGet(url: string, timeoutMs = 30000): Promise<{ status: number; text: string }> {
    const first = await ensureYahooSession(null, () => ({ cookie: "", crumb: null }));
    const withCrumb = (s: YahooSession) =>
        s.crumb ? `${url}${url.includes("?") ? "&" : "?"}crumb=${encodeURIComponent(s.crumb)}` : url;
    const doGet = async (s: YahooSession) => {
        const res = await fetch(withCrumb(s), {
            headers: { "User-Agent": YAHOO_UA, Cookie: s.cookie, Accept: "*/*" },
            signal: AbortSignal.timeout(timeoutMs),
        });
        return { status: res.status, text: await res.text() };
    };
    let r = await doGet(first);
    if (r.status >= 400) {
        const fresh = await ensureYahooSession(first, (old) => ({ cookie: old?.cookie ?? "", crumb: null }));
        r = await doGet(fresh);
        if (r.status === 429) throw new YahooRateLimitError();
    }
    return r;
}

/** Test hook: lets the fixture harness drop the cached session. */
export function resetYahooSession(): void {
    yahooSession = null;
    yahooSessionFlight = null;
}

/** pd.Timestamp(exp, unit="s").strftime("%Y-%m-%d") */
export function expirationLabel(unix: number): string {
    return new Date(unix * 1000).toISOString().slice(0, 10);
}

interface YahooOptionsResponse {
    optionChain?: { result?: Array<Record<string, unknown>> | null } | null;
}

/** One Yahoo ticker handle, mirrors the parts of yfinance.Ticker the fetcher used. */
export class YahooTicker {
    /** label (YYYY-MM-DD) -> unix expiration, insertion-ordered like yfinance. */
    readonly expirations = new Map<string, number>();

    constructor(public readonly ticker: string) {}

    private async downloadOptions(date?: number): Promise<Record<string, unknown>> {
        const url = date === undefined
            ? `${YAHOO_BASE}/v7/finance/options/${this.ticker}`
            : `${YAHOO_BASE}/v7/finance/options/${this.ticker}?date=${date}`;
        const r = await yahooGet(url);
        const j = JSON.parse(r.text) as YahooOptionsResponse;
        const oc = j.optionChain === undefined ? {} : j.optionChain;
        if (oc === null) throw new TypeError("'NoneType' object has no attribute 'get'");
        const result = oc.result === undefined ? [] : oc.result;
        if (result === null) throw new TypeError("object of type 'NoneType' has no len()");
        if (result.length > 0) {
            const first = result[0];
            for (const exp of first.expirationDates as number[]) this.expirations.set(expirationLabel(exp), exp);
            const underlying = (first.quote as Record<string, unknown> | undefined) ?? {};
            const opt = (first.options as Array<Record<string, unknown>> | undefined) ?? [];
            return opt.length > 0 ? { ...opt[0], underlying } : {};
        }
        return {};
    }

    /** Ticker.options */
    async options(): Promise<string[]> {
        if (this.expirations.size === 0) await this.downloadOptions();
        return [...this.expirations.keys()];
    }

    /** Ticker.option_chain(date): raw contract rows, or null frames like yfinance when Yahoo returns nothing. */
    async optionChain(date: string): Promise<{ calls: Array<Record<string, unknown>> | null; puts: Array<Record<string, unknown>> | null }> {
        if (this.expirations.size === 0) await this.downloadOptions();
        if (!this.expirations.has(date)) {
            throw new Error(
                `Expiration \`${date}\` cannot be found. Available expirations are: [${[...this.expirations.keys()].join(", ")}]`,
            );
        }
        const options = await this.downloadOptions(this.expirations.get(date));
        if (Object.keys(options).length === 0) return { calls: null, puts: null };
        const calls = options.calls as Array<Record<string, unknown>> | undefined;
        const puts = options.puts as Array<Record<string, unknown>> | undefined;
        if (calls === undefined) throw new Error("'calls'");
        if (puts === undefined) throw new Error("'puts'");
        return { calls, puts };
    }

    /** history(period="1d") last Close, see parseChartLastClose. Never throws. */
    async lastClose(): Promise<number | null> {
        try {
            const url =
                `${YAHOO_BASE}/v8/finance/chart/${this.ticker}` +
                `?range=1d&interval=1d&includePrePost=false&events=div%2Csplits%2CcapitalGains`;
            const r = await yahooGet(url, 10000);
            return parseChartLastClose(JSON.parse(r.text));
        } catch {
            return null;
        }
    }
}

type Nullable = number | null | undefined;

/**
 * Reproduces yfinance history(period="1d") (auto_adjust, keepna=False) and returns
 * _num(hist["Close"].iloc[-1]): the adjclose of the last non-empty daily bar.
 */
export function parseChartLastClose(data: unknown): number | null {
    const chart = (data as { chart?: { result?: unknown[] | null; error?: unknown } } | null)?.chart;
    if (!chart || chart.error || !chart.result || !chart.result.length) return null;
    const res = chart.result[0] as {
        meta?: { exchangeTimezoneName?: string };
        timestamp?: number[];
        indicators?: { quote?: Array<Record<string, Nullable[]>>; adjclose?: Array<{ adjclose?: Nullable[] }> };
    };
    const q = res.indicators?.quote?.[0];
    if (!q || Object.keys(q).length === 0) return null;
    const ts = res.timestamp ?? [];
    const nan = (v: Nullable) => (v === null || v === undefined ? NaN : v);
    interface Row { t: number; o: number; h: number; l: number; c: number; a: number; v: number }
    let rows: Row[] = ts.map((t, i) => ({
        t,
        o: nan(q.open?.[i]),
        h: nan(q.high?.[i]),
        l: nan(q.low?.[i]),
        c: nan(q.close?.[i]),
        a: nan((res.indicators?.adjclose?.[0]?.adjclose ?? q.close)?.[i]),
        v: nan(q.volume?.[i]),
    }));
    rows.sort((x, y) => x.t - y.t); // stable like pandas sort_index
    const tz = res.meta?.exchangeTimezoneName ?? "UTC";
    const dayOf = (t: number) => dateIso(todayDate(new Date(t * 1000), tz));
    // fix_Yahoo_returning_live_separate (1d): last two rows on one day -> drop the second to last
    if (rows.length > 1 && dayOf(rows[rows.length - 1].t) === dayOf(rows[rows.length - 2].t)) {
        rows = [...rows.slice(0, -2), rows[rows.length - 1]];
    }
    // df[~df.index.duplicated(keep="first")] on the localized day
    const seen = new Set<string>();
    rows = rows.filter((r) => {
        const d = dayOf(r.t);
        if (seen.has(d)) return false;
        seen.add(d);
        return true;
    });
    // auto_adjust: Open/High/Low scale by adjclose/close, Close becomes adjclose
    const kept = rows.filter((r) => {
        const ratio = r.a / r.c;
        const vals = [r.o * ratio, r.h * ratio, r.l * ratio, r.a, Number.isNaN(r.v) ? 0 : Math.trunc(r.v), 0, 0, 0];
        return !vals.every((x) => Number.isNaN(x) || x === 0);
    });
    if (!kept.length) return null;
    return num(kept[kept.length - 1].a);
}

// ---- Quote rows --------------------------------------------------------------

export interface Quote {
    symbol: string;
    expiration: string;
    side: "call" | "put";
    strike: number | PyInt;
    bid: number | null;
    ask: number | null;
    mid: number | null;
    last: number | null;
    volume: number | null;
    openInterest: number | null;
    iv: number | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    rho: number | null;
    greeksSource: string | null;
    greeksMissingReason: string | null;
}

/** Python str() of a pandas cell for contractSymbol (a missing value is NaN -> "nan"). */
function cellStr(v: unknown): string {
    return v === null || v === undefined ? "nan" : String(v);
}

export function rowsFromChain(rows: Array<Record<string, unknown>>, expiration: string, side: "call" | "put"): Quote[] {
    return rows.map((r) => {
        const bid = num(r.bid);
        const ask = num(r.ask);
        return {
            symbol: cellStr(r.contractSymbol),
            expiration,
            side,
            strike: num(r.strike) || new PyInt(0),
            bid,
            ask,
            mid: mid(bid, ask),
            last: num(r.lastPrice),
            volume: num(r.volume),
            openInterest: num(r.openInterest),
            iv: num(r.impliedVolatility),
            delta: null,
            gamma: null,
            theta: null,
            vega: null,
            rho: null,
            greeksSource: null,
            greeksMissingReason: "not_enriched",
        };
    });
}

// ---- Cboe greeks overlay ------------------------------------------------------

const CBOE_OPTIONS_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/{symbol}.json";
const CBOE_INDEX_SET = new Set(["SPX", "VIX", "NDX", "RUT", "DJX", "XSP", "OEX", "VXN"]);
const CBOE_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; GexBot/1.0)", Accept: "application/json,*/*" };

/** urllib.parse.quote(s, safe="") */
export function pyQuote(s: string): string {
    return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export function cboeSymbolCandidates(symbol: string, matched?: string | null): string[] {
    const raw = String(symbol ?? "").toUpperCase().trim().replaceAll("^", "");
    const m = String(matched ?? "").toUpperCase().trim().replaceAll("^", "");
    const bases = dedupe([raw, m, raw.replaceAll("-", "."), raw.replaceAll("-", "/"), raw.replaceAll("-", "")]);
    const out: string[] = [];
    for (const b of bases) {
        if (!b) continue;
        out.push(CBOE_INDEX_SET.has(b) ? `_${b}` : b);
        out.push(b);
    }
    return dedupe(out);
}

/** requests' raise_for_status() message, e.g. "403 Client Error: Forbidden for url: ...". */
function httpErrorText(r: Response, url: string): string {
    return `${r.status} ${r.status < 500 ? "Client" : "Server"} Error: ${r.statusText} for url: ${url}`;
}

type CboeRow = Record<string, unknown>;

/** Cboe kept answering 429 after every retry: the ticker must fail instead of being written without greeks. */
export class CboeRateLimitError extends Error {}

// One throttle shared by every worker: Cboe limits per IP by request rate (~80-90 per minute), not by concurrency.
let cboeNextSlot = 0;
let cboeCooldownUntil = 0;

/** Wait for the next free Cboe slot (>= CBOE_MIN_INTERVAL after the previous one) and for any active 429 cooldown. */
async function cboeAcquire(): Promise<void> {
    for (;;) {
        const now = Date.now();
        const at = Math.max(now, cboeNextSlot, cboeCooldownUntil);
        cboeNextSlot = at + cfg.CBOE_MIN_INTERVAL * 1000;
        if (at > now) await sleep(at - now);
        if (Date.now() >= cboeCooldownUntil) return;
    }
}

function cboeCooldown(ms: number): void {
    cboeCooldownUntil = Math.max(cboeCooldownUntil, Date.now() + ms);
}

export async function fetchCboeGreeks(symbol: string, matched?: string | null): Promise<Map<string, CboeRow>> {
    if (!cfg.CBOE_GREEKS) return new Map();
    for (const cand of cboeSymbolCandidates(symbol, matched)) {
        const url = CBOE_OPTIONS_URL.replace("{symbol}", pyQuote(cand));
        for (let attempt = 0; ; attempt++) {
            try {
                await cboeAcquire();
                const r = await fetch(url, { headers: CBOE_HEADERS, signal: AbortSignal.timeout(cfg.CBOE_GREEKS_TIMEOUT * 1000) });
                if (r.status === 404) break;
                if (r.status === 429) {
                    const retryAfter = Number(r.headers.get("retry-after"));
                    const waitMs = Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, cfg.CBOE_BACKOFF * 1000 * 2 ** attempt);
                    if (attempt >= cfg.CBOE_RETRIES) throw new CboeRateLimitError(httpErrorText(r, url));
                    cboeCooldown(waitMs);
                    log(`GREEKS ${symbol}: Cboe 429 for '${cand}', all workers pause ${Math.round(waitMs / 1000)}s (retry ${attempt + 1}/${cfg.CBOE_RETRIES})`);
                    continue;
                }
                if (r.status >= 400) throw new Error(httpErrorText(r, url));
                const j = (await r.json()) as { data?: { options?: CboeRow[] } | null };
                const rows = j.data?.options || [];
                if (!rows.length) break;
                if (cand !== symbol) log(`GREEKS ${symbol}: using Cboe symbol '${cand}'`);
                const map = new Map<string, CboeRow>();
                for (const o of rows) if (o.option) map.set(String(o.option).toUpperCase(), o);
                return map;
            } catch (e) {
                if (e instanceof CboeRateLimitError) throw e;
                logErr(`GREEKS ${symbol}: Cboe candidate '${cand}' failed: ${e instanceof Error ? e.message : e}`);
                break;
            }
        }
    }
    return new Map();
}

export interface GreeksStats {
    enabled: boolean;
    primarySource: string | null;
    fallbackSource: string;
    riskFreeRate: null;
    dividendYield: null;
    total: PyInt;
    cboeMatched: PyInt;
    computed: PyInt;
    missing: PyInt;
    cboeContracts: PyInt;
}

/**
 * Attach Cboe 1st-order greeks plus open interest and volume when Cboe has a
 * match (yfinance often reports 0 for index options). R1: no model math here.
 */
export function applyCboeRows(quotes: Quote[], cboeRows: Map<string, CboeRow>, enabled: boolean): GreeksStats {
    let matched = 0;
    let missing = 0;
    for (const q of quotes) {
        const c = cboeRows.get(q.symbol.toUpperCase());
        if (c) {
            const oi = num(c.open_interest);
            if (oi !== null) q.openInterest = oi;
            const vol = num(c.volume);
            if (vol !== null) q.volume = vol;
            for (const field of ["delta", "gamma", "theta", "vega", "rho"] as const) {
                const val = num(c[field]);
                if (val !== null) q[field] = val;
            }
            if (q.delta !== null && q.gamma !== null) {
                q.greeksSource = "cboe";
                q.greeksMissingReason = null;
                matched++;
                continue;
            }
        }
        q.greeksSource = null;
        q.greeksMissingReason = cboeRows.size ? "cboe_unmatched" : !enabled ? "cboe_disabled" : "cboe_unavailable";
        missing++;
    }
    return {
        enabled,
        primarySource: enabled ? "cboe" : null,
        fallbackSource: "client-black-scholes",
        riskFreeRate: null,
        dividendYield: null,
        total: new PyInt(quotes.length),
        cboeMatched: new PyInt(matched),
        computed: new PyInt(0),
        missing: new PyInt(missing),
        cboeContracts: new PyInt(cboeRows.size),
    };
}

// ---- Universe discovery -------------------------------------------------------

const UNIVERSE_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; GexBot/1.0)" };

/** Python csv.DictReader over text (excel dialect): array of header-keyed rows. */
export function parseCsvDicts(text: string): Array<Record<string, string>> {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuotes = false;
    let sawAny = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else inQuotes = false;
            } else field += c;
        } else if (c === '"' && field === "") {
            inQuotes = true;
            sawAny = true;
        } else if (c === ",") {
            row.push(field);
            field = "";
            sawAny = true;
        } else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            if (sawAny || field !== "") {
                row.push(field);
                rows.push(row);
            }
            row = [];
            field = "";
            sawAny = false;
        } else {
            field += c;
            sawAny = true;
        }
    }
    if (sawAny || field !== "") {
        row.push(field);
        rows.push(row);
    }
    const header = rows.shift() ?? [];
    return rows.map((r) => {
        const o: Record<string, string> = {};
        header.forEach((h, i) => {
            if (i < r.length) o[h] = r[i];
        });
        return o;
    });
}

async function liveCboeUniverse(): Promise<string[]> {
    try {
        log("universe/cboe: downloading optionable-underlying CSV...");
        const r = await fetch(CBOE_UNDERLYINGS_URL, {
            headers: { ...UNIVERSE_HEADERS, Accept: "text/csv,*/*" },
            signal: AbortSignal.timeout(20000),
        });
        if (r.status >= 400) throw new Error(httpErrorText(r, CBOE_UNDERLYINGS_URL));
        // requests decodes text/* without a charset as ISO-8859-1
        const text = Buffer.from(await r.arrayBuffer()).toString("latin1");
        let syms: string[] = [];
        for (const row of parseCsvDicts(text)) {
            const sym = (row["Symbol"] || "").trim();
            if (!sym) continue;
            if (sym.includes("^")) continue;
            syms.push(canonical(sym));
            rememberSymbolName(sym, row["Company"]);
        }
        syms = dedupe(syms);
        log(`universe/cboe: loaded ${syms.length} optionable symbols`);
        return syms;
    } catch (e) {
        logErr(`universe/cboe: failed (${e instanceof Error ? e.message : e})`);
        return [];
    }
}

/** float(str(v).replace(",", "") or 0), ValueError -> 0.0 */
export function screenerCap(row: { marketCap?: unknown }): number {
    const t = String(row.marketCap === undefined ? "0" : row.marketCap === null ? "None" : row.marketCap).replaceAll(",", "") || "0";
    const v = pyParseFloat(t);
    return v === null ? 0 : v;
}

async function liveNasdaqUniverse(): Promise<string[]> {
    const url = "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25000&download=true";
    const headers = {
        ...UNIVERSE_HEADERS,
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://www.nasdaq.com",
        Referer: "https://www.nasdaq.com/market-activity/stocks/screener",
    };
    try {
        log(`universe/nasdaq: downloading market-cap screener (timeout=${pyFloatRepr(cfg.NASDAQ_TIMEOUT)}s)...`);
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(cfg.NASDAQ_TIMEOUT * 1000) });
        if (r.status >= 400) throw new Error(httpErrorText(r, url));
        const body = (await r.json()) as { data?: { rows?: Array<Record<string, unknown>> } | null };
        const rows = body.data?.rows || [];
        const clean = rows.filter(
            (x) => x.symbol && !String(x.symbol).includes("^") && screenerCap(x) >= cfg.MIN_MARKET_CAP,
        );
        // stable descending sort like list.sort(key=cap, reverse=True)
        const indexed = clean.map((x, i) => ({ x, i, c: screenerCap(x) }));
        indexed.sort((a, b) => (a.c < b.c ? 1 : a.c > b.c ? -1 : a.i - b.i));
        const sorted = indexed.map((e) => e.x);
        const syms = dedupe(sorted.map((x) => canonical(String(x.symbol))));
        for (const row of sorted) rememberSymbolName(String(row.symbol), row.name);
        if (syms.length) {
            const tier = (c: number) =>
                c >= 176e9 ? "Mega" : c >= 36e9 ? "Large" : c >= 6e9 ? "Mid" : c >= 2e9 ? "Small" : "Micro";
            const counts: Record<string, number> = { Mega: 0, Large: 0, Mid: 0, Small: 0, Micro: 0 };
            for (const x of sorted) counts[tier(screenerCap(x))]++;
            log(
                `universe/nasdaq: loaded ${syms.length} symbols (>= $${Math.round(cfg.MIN_MARKET_CAP).toLocaleString("en-US")}); ` +
                    `tiers={'Mega':${counts.Mega}, 'Large':${counts.Large}, 'Mid':${counts.Mid}, 'Small':${counts.Small}, 'Micro':${counts.Micro}}; ` +
                    `top: ${syms.slice(0, 5).join(", ")}`,
            );
        }
        return syms;
    } catch (e) {
        logErr(`universe/nasdaq: failed (${e instanceof Error ? e.message : e})`);
        return [];
    }
}

/** Explicit TICKERS/TICKER env override, or null when unset or empty. */
export function tickersOverride(env: Record<string, string | undefined> = process.env): string[] | null {
    const override = env.TICKERS || env.TICKER;
    if (!override) return null;
    return dedupe(override.replaceAll(",", " ").split(/\s+/).filter((t) => t.trim()).map((t) => canonical(t)));
}

/** Merge rule of load_universe for the two live sources (pure, for tests). */
export function mergeUniverse(nasdaq: string[], cboe: string[], size: number): string[] {
    if (nasdaq.length && cboe.length) {
        const optionable = new Set(cboe);
        return dedupe([...nasdaq.filter((s) => optionable.has(s)), ...cboe]).slice(0, size);
    }
    if (nasdaq.length) return nasdaq.slice(0, size);
    if (cboe.length) return dedupe([...FALLBACK_UNIVERSE.map((s) => canonical(s)), ...cboe]).slice(0, size);
    return dedupe(FALLBACK_UNIVERSE.map((s) => canonical(s))).slice(0, size);
}

async function loadUniverse(): Promise<{ symbols: string[]; source: string }> {
    const override = tickersOverride();
    if (override) {
        const preview = override.slice(0, 20).join(", ") + (override.length > 20 ? `, ... (+${override.length - 20} more)` : "");
        log(`universe/override: using ${override.length} symbols from TICKERS/TICKER env: ${preview}`);
        return { symbols: override, source: "TICKERS override" };
    }
    const cboe = await liveCboeUniverse();
    const nasdaq = await liveNasdaqUniverse();
    const full = mergeUniverse(nasdaq, cboe, Infinity);
    const syms = full.slice(0, cfg.UNIVERSE_SIZE);
    const source =
        nasdaq.length && cboe.length ? "NASDAQ market-cap order + Cboe optionable" : nasdaq.length ? "NASDAQ only" : cboe.length ? "Cboe only" : "built-in fallback";
    if (nasdaq.length && cboe.length) {
        log(`universe/final: ${full.length} optionable symbols (NASDAQ market-cap ordered + Cboe append); top: ${syms.slice(0, 5).join(", ")}`);
    } else if (nasdaq.length) {
        log(`universe/final: ${nasdaq.length} symbols from NASDAQ only; top: ${nasdaq.slice(0, 5).join(", ")}`);
    } else if (cboe.length) {
        log(`universe/final: ${full.length} optionable symbols from Cboe (NASDAQ unavailable); top: ${syms.slice(0, 5).join(", ")}`);
    } else {
        logErr("universe/fallback: all live universe sources failed; using tiny built-in fallback");
    }
    return { symbols: syms, source };
}

// ---- Per-ticker fetch -----------------------------------------------------------

async function resolveOptions(symbol: string): Promise<{ t: YahooTicker; exps: string[]; matched: string } | null> {
    const variants = symbolVariants(symbol);
    for (const cand of variants) {
        const t = new YahooTicker(cand);
        const exps = await t.options();
        if (exps.length) {
            if (cand !== variants[0]) log(`RESOLVE ${symbol}: using Yahoo variant '${cand}'`);
            return { t, exps, matched: cand };
        }
    }
    return null;
}

export interface Payload {
    symbol: string;
    updated: string;
    underlyingPrice: number | null;
    greeks: GreeksStats;
    expirations: string[];
    quotes: Quote[];
}

/** Full (capped) normalized chain for one ticker, or null when it has no options. Throws on source errors. */
export async function fetchTicker(symbolIn: string): Promise<Payload | null> {
    const symbol = symbolIn.toUpperCase().trim();
    const resolved = await resolveOptions(symbol);
    if (!resolved) return null;
    const { t, matched } = resolved;
    const exps = resolved.exps.slice(0, cfg.MAX_EXPIRATIONS);

    const quotes: Quote[] = [];
    for (const exp of exps) {
        let ch;
        try {
            ch = await t.optionChain(exp);
        } catch (e) {
            logErr(`SKIP_EXPIRATION ${symbol} ${exp}: ${e instanceof Error ? e.message : e}`);
            continue;
        }
        if (!ch.calls) throw new Error("'NoneType' object has no attribute 'iterrows'");
        quotes.push(...rowsFromChain(ch.calls, exp, "call"));
        quotes.push(...rowsFromChain(ch.puts!, exp, "put"));
    }
    if (!quotes.length) return null;

    const spot = await t.lastClose();
    const cboeRows = await fetchCboeGreeks(symbol, matched);
    const greeks = applyCboeRows(quotes, cboeRows, cfg.CBOE_GREEKS);

    return { symbol, updated: nowIso(), underlyingPrice: spot, greeks, expirations: exps, quotes };
}

// ---- Cache files, freshness and skiplist ------------------------------------------

function fileUpdated(path: string): string {
    try {
        const j = JSON.parse(readFileSync(path, "utf8"));
        const val = j && typeof j === "object" && !Array.isArray(j) ? String(j.updated || "") : "";
        if (val) return val;
    } catch {
        // fall through to mtime
    }
    try {
        return isoWithOffset(new Date(statSync(path).mtimeMs));
    } catch {
        return "";
    }
}

function isFresh(path: string): boolean {
    if (!existsSync(path)) return false;
    return isFreshAt(fileUpdated(path));
}

type IndexDoc = Record<string, unknown>;

function readIndexDoc(): IndexDoc {
    try {
        const d = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
        return d && typeof d === "object" && !Array.isArray(d) ? (d as IndexDoc) : {};
    } catch {
        return {};
    }
}

export function sortedNoOptions(skip: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of Object.keys(skip).sort()) out[k] = skip[k];
    return out;
}

function loadSkiplist(): Record<string, string> {
    const d = readIndexDoc().no_options;
    if (d && typeof d === "object" && !Array.isArray(d) && Object.keys(d).length) return { ...(d as Record<string, string>) };
    try {
        const legacy = JSON.parse(readFileSync(LEGACY_SKIP_PATH, "utf8"));
        if (legacy && typeof legacy === "object" && !Array.isArray(legacy) && Object.keys(legacy).length) {
            log(`skiplist: migrating ${Object.keys(legacy).length} entries from scripts/no_options.json -> data/options/index.json`);
            return { ...legacy };
        }
    } catch {
        // no legacy file
    }
    return {};
}

/** Accept legacy {TICKER: updatedISO} maps or plain ticker lists -> sorted list. */
export function normalizeFilesList(raw: unknown): string[] {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return Object.keys(raw).filter(Boolean).sort();
    if (Array.isArray(raw)) return [...new Set(raw.filter(Boolean).map(String))].sort();
    return [];
}

function cachedSymbols(): string[] {
    return readdirSync(DATA_DIR)
        .filter((f) => f.endsWith(".json") && f !== "index.json")
        .map((f) => f.slice(0, -5));
}

/** Always fetched first (when not fresh), before coverage and refresh: the four most used chains. */
export const PRIORITY_SYMBOLS = ["SPY", "SPX", "QQQ", "NDX"];

export interface WorkQueue {
    queue: string[];
    /** Leading priority entries of `queue` (not counted in nMissing or nStale). */
    nPriority: number;
    nMissing: number;
    nStale: number;
    nFresh: number;
}

export interface QueueDeps {
    cached: string[];
    skip: Record<string, string>;
    explicit: boolean;
    isFresh: (sym: string) => boolean;
    updatedOf: (sym: string) => string;
    skipActive: (last: unknown) => boolean;
    /** Symbols queued first; defaults to PRIORITY_SYMBOLS. */
    priority?: string[];
}

/**
 * Priority symbols first (SPY, SPX, QQQ, NDX unless fresh; with an explicit TICKERS list only those in it),
 * then missing (universe order), then stale oldest-updated first.
 */
export function buildQueue(universe: string[], d: QueueDeps): WorkQueue {
    const cachedSet = new Set(d.cached);
    const blocked = (s: string) => Object.prototype.hasOwnProperty.call(d.skip, s) && d.skipActive(d.skip[s]);
    const prioritySet = new Set((d.priority ?? PRIORITY_SYMBOLS).filter((s) => !d.explicit || universe.includes(s)));
    const missing = universe.filter((s) => !cachedSet.has(s) && !blocked(s) && !prioritySet.has(s));
    const missingSet = new Set(missing);
    // The Python script iterates a set here (random order for equal timestamps); sorted is deterministic.
    const candidates = d.explicit ? universe : [...d.cached].sort();
    const stale: Array<[string, string]> = [];
    let freshSkipped = 0;
    for (const sym of candidates) {
        if (d.isFresh(sym)) {
            freshSkipped++;
            continue;
        }
        if (missingSet.has(sym) || prioritySet.has(sym)) continue;
        stale.push([sym, d.updatedOf(sym)]);
    }
    stale.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)); // stable, plain string order
    const priority = [...prioritySet].filter((s) => !d.isFresh(s));
    return { queue: [...priority, ...missing, ...stale.map(([s]) => s)], nPriority: priority.length, nMissing: missing.length, nStale: stale.length, nFresh: freshSkipped };
}

function buildWorkQueue(universe: string[]): WorkQueue {
    return buildQueue(universe, {
        cached: cachedSymbols(),
        skip: loadSkiplist(),
        explicit: Boolean(process.env.TICKERS || process.env.TICKER),
        isFresh: (s) => isFresh(join(DATA_DIR, `${s}.json`)),
        updatedOf: (s) => fileUpdated(join(DATA_DIR, `${s}.json`)),
        skipActive: (last) => skipIsActive(last),
    });
}

// ---- Index manifest -------------------------------------------------------------

export interface IndexPayload {
    files: string[];
    count: PyInt;
    names: Record<string, string>;
    no_options: Record<string, string>;
}

function sameStringMap(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/**
 * Pure core of write_index: returns the payload to write, or null when nothing
 * changed (ticker set, names and skiplist equal, and not the legacy shape).
 */
export function planIndex(
    files: string[],
    prev: IndexDoc,
    skip: Record<string, string> | null,
    symbolNames: Map<string, string>,
): IndexPayload | null {
    const sortedFiles = [...files].sort();
    const noOptions = skip === null
        ? prev.no_options && typeof prev.no_options === "object" && !Array.isArray(prev.no_options)
            ? sortedNoOptions(prev.no_options as Record<string, string>)
            : {}
        : sortedNoOptions(skip);
    const prevNamesRaw = prev.names;
    const prevNames = prevNamesRaw && typeof prevNamesRaw === "object" && !Array.isArray(prevNamesRaw)
        ? (prevNamesRaw as Record<string, unknown>)
        : {};
    const wanted = [...new Set([...sortedFiles, ...Object.keys(noOptions)])].sort();
    const names: Record<string, string> = {};
    for (const sym of wanted) {
        const name = cleanCompanyName(symbolNames.get(sym) || (prevNames[sym] as string | undefined));
        if (name) names[sym] = name;
    }
    const prevFiles = normalizeFilesList(prev.files);
    const prevSkip = prev.no_options && typeof prev.no_options === "object" && !Array.isArray(prev.no_options)
        ? sortedNoOptions(prev.no_options as Record<string, string>)
        : {};
    const legacy = "generated" in prev || (prev.files !== null && typeof prev.files === "object" && !Array.isArray(prev.files));
    if (
        prevFiles.length === sortedFiles.length &&
        prevFiles.every((f, i) => f === sortedFiles[i]) &&
        sameStringMap(prevNames, names) &&
        sameStringMap(prevSkip, noOptions) &&
        !legacy
    ) {
        return null;
    }
    return { files: sortedFiles, count: new PyInt(sortedFiles.length), names, no_options: noOptions };
}

function writeIndex(skip: Record<string, string> | null): boolean {
    const payload = planIndex(cachedSymbols(), readIndexDoc(), skip, SYMBOL_NAMES);
    if (!payload) return false;
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(INDEX_PATH, pyJsonDumps(payload, 2) + "\n");
    return true;
}

// ---- Console presentation (no effect on requests, files or freshness) ------------

const outputClean = (value: unknown): string => String(value ?? "null").replace(/[\r\n\t]+/g, " ");

/** Bracketed label, 9 characters wide like the sibling updaters: "[ config   ]". */
export const outputLabel = (label: string): string => `[ ${label.padEnd(9)}]`;

/** Effective env knobs, canonical names, one per entry. */
export function outputConfigEntries(
    c: typeof cfg = cfg,
    env: Record<string, string | undefined> = process.env,
): Array<[string, string]> {
    return [
        ["MAX_FETCHES", String(c.MAX_FETCHES)],
        ["REQUEST_SLEEP", pyFloatRepr(c.REQUEST_SLEEP)],
        ["CONCURRENCY", String(c.CONCURRENCY)],
        ["CHART_CACHE", String(c.CHART_CACHE)],
        ["CHART_MAX_FETCHES", String(c.CHART_MAX_FETCHES)],
        ["SOFT_DEADLINE_SECONDS", pyFloatRepr(c.SOFT_DEADLINE_SECONDS)],
        ["RATE_LIMIT_HITS", String(c.RATE_LIMIT_HITS)],
        ["MAX_EXPIRATIONS", String(c.MAX_EXPIRATIONS)],
        ["UNIVERSE_SIZE", String(c.UNIVERSE_SIZE)],
        ["MIN_MARKET_CAP", pyFloatRepr(c.MIN_MARKET_CAP)],
        ["NASDAQ_TIMEOUT", pyFloatRepr(c.NASDAQ_TIMEOUT)],
        ["SKIP_RECHECK_DAYS", String(c.SKIP_RECHECK_DAYS)],
        ["CBOE_GREEKS", String(c.CBOE_GREEKS)],
        ["CBOE_GREEKS_TIMEOUT", pyFloatRepr(c.CBOE_GREEKS_TIMEOUT)],
        ["CBOE_MIN_INTERVAL", pyFloatRepr(c.CBOE_MIN_INTERVAL)],
        ["CBOE_BACKOFF", pyFloatRepr(c.CBOE_BACKOFF)],
        ["CBOE_RETRIES", String(c.CBOE_RETRIES)],
        ["SYMBOL_ALIASES", env.SYMBOL_ALIASES ?? ""],
        ["TIMEZONE", env.TIMEZONE ?? "America/New_York"],
        ["TICKERS", env.TICKERS ?? env.TICKER ?? ""],
        ["VERBOSE", String(isVerbose(env))],
    ];
}

const SECRET_KEY_RE = /TOKEN|PASSWORD|SECRET|COOKIE|API_?KEY|^SEC_UA$/i;

/** The `[ config   ]` block; values of secret-looking knobs are replaced by <redacted>. */
export function outputConfigBlock(entries: Array<[string, string]>, brand = "GEX"): string {
    const rows = entries.map(([k, v]) => `              ${k}=${SECRET_KEY_RE.test(k) ? "<redacted>" : outputClean(v) || "(unset)"}`);
    return `${outputLabel("config")} ${brand} updater:\n${rows.join("\n")}`;
}

export type TickerStatus = "new" | "updated" | "unchanged" | "no-options" | "failed";

function stableForCompare(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableForCompare);
    if (value && typeof value === "object") {
        const o = value as Record<string, unknown>;
        return Object.fromEntries(Object.keys(o).sort().map((k) => [k, stableForCompare(o[k])]));
    }
    return value;
}

/**
 * new = no previous file, unchanged = same content ignoring the top-level `updated` stamp (stable key order),
 * updated = anything else (an unreadable previous file counts as updated). Both texts are the JSON file contents.
 */
export function classifyPayload(previousText: string | null, nextText: string): "new" | "updated" | "unchanged" {
    if (previousText === null) return "new";
    try {
        const strip = (t: string) => {
            const o = JSON.parse(t) as Record<string, unknown>;
            delete o.updated;
            return JSON.stringify(stableForCompare(o));
        };
        return strip(previousText) === strip(nextText) ? "unchanged" : "updated";
    } catch {
        return "updated";
    }
}

/** `[ 03/25  ] SPY   updated   expirations=32 quotes=10307 cboe=9800/10307 spot=589.12 in=2.1s` */
export function outputTickerLine(
    position: number,
    total: number,
    sym: string,
    status: TickerStatus,
    detail: { payload?: Payload | null; elapsed?: number; reason?: string } = {},
): string {
    const width = Math.max(2, String(total).length);
    const p = detail.payload;
    const parts: string[] = [];
    if (p) {
        parts.push(`expirations=${p.expirations.length}`, `quotes=${p.quotes.length}`, `cboe=${p.greeks.cboeMatched.value}/${p.quotes.length}`);
        if (p.underlyingPrice !== null) parts.push(`spot=${p.underlyingPrice.toFixed(2)}`);
    }
    if (detail.elapsed !== undefined) parts.push(`in=${pyFixed1(detail.elapsed)}s`);
    if (detail.reason) parts.push(`reason=${outputClean(detail.reason)}`);
    return `[ ${String(position).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(sym).padEnd(5)} ${status.padEnd(9)}${parts.length ? ` ${parts.join(" ")}` : ""}`;
}

export interface RunCounts {
    new: number;
    updated: number;
    unchanged: number;
    "no-options": number;
    failed: number;
}

export function outputDoneLine(counts: RunCounts, elapsedSeconds: number, stopped: StopReason | null): string {
    const tail = stopped ? ` stopped=${stopped}` : "";
    return `${outputLabel("done")} new=${counts.new} updated=${counts.updated} unchanged=${counts.unchanged} no-options=${counts["no-options"]} failed=${counts.failed} elapsed=${pyFixed1(elapsedSeconds)}s${tail}`;
}

// ---- Worker pool -----------------------------------------------------------------

export type StopReason = "max-fetches" | "rate-limit" | "deadline";

export interface PoolResult {
    kind: "written" | "no-options" | "failed";
}

export interface PoolOptions<R extends PoolResult> {
    queue: string[];
    concurrency: number;
    /** Successful-write budget, never exceeded: slots are reserved when a ticker starts. */
    maxFetches: number;
    /** Consecutive failures (shared by all workers) that stop the run. */
    rateLimitHits: number;
    requestSleepMs: number;
    /** 0 = off. No new ticker is started after this many ms; running ones finish. */
    softDeadlineMs: number;
    /** Does the work for one ticker (including the file write). A throw counts as a failure. */
    work: (sym: string, position: number, state: { fetched: number }) => Promise<R>;
    /** Called synchronously when a ticker finishes, after the shared counters were updated. */
    onDone?: (position: number, sym: string, result: R, state: { fetched: number; failStreak: number }) => void;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

export interface PoolSummary<R extends PoolResult> {
    /** Indexed by queue position - 1, in queue order whatever the finish order was; undefined = never started. */
    results: Array<R | undefined>;
    fetched: number;
    failStreak: number;
    stopped: StopReason | null;
    /** Number of tickers that were never started. */
    notStarted: number;
}

/**
 * CONCURRENCY workers over one queue. Each worker is its own request lane: after a successful write it waits
 * REQUEST_SLEEP before it takes the next ticker, so the request rate scales with the worker count the way the sibling
 * updaters do. With one worker this is exactly the old sequential loop.
 */
export async function runPool<R extends PoolResult>(o: PoolOptions<R>): Promise<PoolSummary<R>> {
    const sleepFn = o.sleep ?? sleep;
    const now = o.now ?? (() => Date.now());
    const startedAt = now();
    const results: Array<R | undefined> = new Array(o.queue.length).fill(undefined);
    const state = { fetched: 0, failStreak: 0 };
    let next = 0;
    let inflight = 0;
    let stopped: StopReason | null = null;
    let waiters: Array<() => void> = [];
    const wakeAll = () => {
        const w = waiters;
        waiters = [];
        for (const f of w) f();
    };
    const halt = (reason: StopReason) => {
        stopped ??= reason;
        wakeAll();
    };

    const worker = async (): Promise<void> => {
        for (;;) {
            if (stopped || next >= o.queue.length) return;
            if (o.softDeadlineMs > 0 && now() - startedAt >= o.softDeadlineMs) return halt("deadline");
            if (state.fetched >= o.maxFetches) return halt("max-fetches");
            if (state.fetched + inflight >= o.maxFetches) {
                // Every remaining slot belongs to a ticker in flight: wait to see whether it is written or released.
                await new Promise<void>((resolve) => waiters.push(resolve));
                continue;
            }
            const index = next++;
            inflight++;
            let result: R;
            try {
                result = await o.work(o.queue[index], index + 1, { fetched: state.fetched });
            } catch (e) {
                result = { kind: "failed", reason: e instanceof Error ? e.message : String(e) } as unknown as R;
            }
            inflight--;
            results[index] = result;
            if (result.kind === "failed") state.failStreak++;
            else state.failStreak = 0;
            if (result.kind === "written") state.fetched++;
            o.onDone?.(index + 1, o.queue[index], result, state);
            if (result.kind === "failed" && state.failStreak >= o.rateLimitHits) halt("rate-limit");
            wakeAll();
            if (result.kind === "written") await sleepFn(o.requestSleepMs);
        }
    };

    const n = Math.max(1, Math.min(o.concurrency, o.queue.length));
    await Promise.all(Array.from({ length: n }, () => worker()));
    return {
        results,
        fetched: state.fetched,
        failStreak: state.failStreak,
        stopped,
        notStarted: results.filter((r) => r === undefined).length,
    };
}

// ---- Main loop ------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function pyFixed1(n: number): string {
    return n.toFixed(1);
}

interface TickerResult extends PoolResult {
    status: TickerStatus;
    payload?: Payload | null;
    elapsed: number;
    reason?: string;
    path?: string;
}

// ---- Chart cache: data/charts/<SYM>.json ----------------------------------------------

export const CHARTS_DIR = join(REPO_ROOT, "data", "charts");
const CHART_RANGE = "1y";

/** Yahoo symbols to try for a chart: cash indices only exist in caret form (^SPX). */
export function yahooChartCandidates(symbol: string): string[] {
    const s = symbol.toUpperCase();
    return CBOE_INDEX_SET.has(s) ? [`^${s}`, s] : [s];
}

export interface ChartFile {
    symbol: string;
    updated: string;
    /** Exchange offset in seconds, the app needs it to put daily bars on the exchange-local date. */
    gmtoffset: number;
    timestamp: number[];
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: Array<number | null>;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Compact chart file from a Yahoo v8 chart body, or null when it has no complete OHLC rows. */
export function buildChartFile(symbol: string, updated: string, body: unknown): ChartFile | null {
    const result = (body as { chart?: { result?: unknown[] | null; error?: unknown } } | null)?.chart?.result?.[0] as
        | { meta?: { gmtoffset?: unknown }; timestamp?: unknown[]; indicators?: { quote?: Array<Record<string, unknown[]>> } }
        | undefined;
    if (!result) return null;
    const q = result.indicators?.quote?.[0] ?? {};
    const gmtoffset = result.meta?.gmtoffset;
    const out: ChartFile = {
        symbol,
        updated,
        gmtoffset: finite(gmtoffset) ? gmtoffset : 0,
        timestamp: [],
        open: [],
        high: [],
        low: [],
        close: [],
        volume: [],
    };
    (result.timestamp ?? []).forEach((ts, i) => {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
        if (!finite(ts) || !finite(o) || !finite(h) || !finite(l) || !finite(c)) return;
        out.timestamp.push(ts);
        out.open.push(round4(o));
        out.high.push(round4(h));
        out.low.push(round4(l));
        out.close.push(round4(c));
        out.volume.push(finite(v) ? v : null);
    });
    return out.timestamp.length ? out : null;
}

export interface ChartQueueDeps {
    /** Symbols that have an options file. */
    cached: string[];
    explicit: boolean;
    /** Chart file exists. */
    hasChart: (sym: string) => boolean;
    isFresh: (sym: string) => boolean;
    updatedOf: (sym: string) => string;
    priority?: string[];
}

/** Priority symbols, then tickers without a chart file (universe order), then stale ones oldest first. Fresh ones are skipped. */
export function buildChartQueue(universe: string[], d: ChartQueueDeps): string[] {
    const cachedSet = new Set(d.cached);
    const priority = (d.priority ?? PRIORITY_SYMBOLS).filter((s) => !d.explicit || universe.includes(s));
    const candidates = d.explicit
        ? dedupe([...priority, ...universe])
        : dedupe([...priority, ...universe.filter((s) => cachedSet.has(s)), ...[...d.cached].sort()]);
    const todo = candidates.filter((s) => !d.isFresh(s));
    const prioritySet = new Set(priority);
    const head = todo.filter((s) => prioritySet.has(s));
    const rest = todo.filter((s) => !prioritySet.has(s));
    const missing = rest.filter((s) => !d.hasChart(s));
    const stale = rest.filter((s) => d.hasChart(s)).map((s): [string, string] => [s, d.updatedOf(s)]).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return [...head, ...missing, ...stale.map(([s]) => s)];
}

export async function fetchChartFile(symbol: string): Promise<ChartFile | null> {
    for (const cand of yahooChartCandidates(symbol)) {
        const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(cand)}?range=${CHART_RANGE}&interval=1d&includePrePost=false`;
        const r = await yahooGet(url, 15000);
        if (r.status >= 400) continue;
        let body: unknown;
        try {
            body = JSON.parse(r.text);
        } catch {
            continue;
        }
        const file = buildChartFile(symbol, nowIso(), body);
        if (file) return file;
    }
    return null;
}

/** Writes data/charts/<SYM>.json for the queue with CONCURRENCY workers. A streak of RATE_LIMIT_HITS failures stops the pass. */
async function runChartPass(queue: string[]): Promise<{ written: number; failed: number; stopped: boolean }> {
    mkdirSync(CHARTS_DIR, { recursive: true });
    let next = 0, reserved = 0, written = 0, failed = 0, streak = 0, stopped = false;
    const worker = async () => {
        for (;;) {
            if (stopped || next >= queue.length || reserved >= cfg.CHART_MAX_FETCHES) return;
            const index = next++;
            const sym = queue[index];
            reserved++;
            const started = performance.now();
            let file: ChartFile | null = null;
            let reason = "";
            try {
                file = await fetchChartFile(sym);
                if (!file) reason = "no chart data";
            } catch (e) {
                reason = e instanceof Error ? e.message : String(e);
            }
            const secs = pyFixed1((performance.now() - started) / 1000);
            const pos = `${String(index + 1).padStart(4)}/${queue.length}`;
            if (file) {
                writeFileSync(join(CHARTS_DIR, `${sym}.json`), JSON.stringify(file));
                written++;
                streak = 0;
                console.log(`${outputLabel("chart")} ${pos} ${sym.padEnd(5)} written    bars=${file.timestamp.length} in=${secs}s`);
                await sleep(cfg.REQUEST_SLEEP * 1000);
            } else {
                reserved--;
                failed++;
                streak++;
                console.log(`${outputLabel("chart")} ${pos} ${sym.padEnd(5)} failed     ${reason} in=${secs}s`);
                if (streak >= cfg.RATE_LIMIT_HITS) stopped = true;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(cfg.CONCURRENCY, queue.length)) }, worker));
    return { written, failed, stopped };
}

export async function main(): Promise<void> {
    const runStarted = performance.now();
    mkdirSync(DATA_DIR, { recursive: true });
    console.log(outputConfigBlock(outputConfigEntries()));
    const { symbols: universe, source: universeSource } = await loadUniverse();

    const { queue, nPriority, nMissing, nStale, nFresh } = buildWorkQueue(universe);
    const skip = loadSkiplist();

    const noOptionSyms: string[] = [];
    const rel = (p: string) => relative(dirname(DATA_DIR), p);
    const counts: RunCounts = { new: 0, updated: 0, unchanged: 0, "no-options": 0, failed: 0 };
    const newTickers: string[] = [];

    if (tickersOverride()) console.log(`${outputLabel("filter")} TICKERS override: ${universe.length} symbols`);
    console.log(`${outputLabel("universe")} ${universe.length} symbols (${universeSource}), today=${dateIso(todayDate())}, timezone=${MARKET_TZ_NAME}`);
    console.log(
        `${outputLabel("queue")} ${queue.length} queued = ${nMissing} missing + ${nStale} stale (oldest first); ${nFresh} fresh skipped; ` +
            `${Object.keys(skip).length} on no-options skiplist; budget=${cfg.MAX_FETCHES} writes, concurrency=${cfg.CONCURRENCY}`,
    );
    log(`Smart fetch v11: budget=${cfg.MAX_FETCHES} successful writes, universe=${universe.length}, today=${dateIso(todayDate())}, timezone=${MARKET_TZ_NAME}`);
    log(
        `queue: ${nMissing} missing (coverage) + ${nStale} stale (refresh, oldest-first); ${nFresh} fresh skipped; ` +
            `${Object.keys(skip).length} on no-options skiplist; total queued=${queue.length}`,
    );
    if (nMissing === 0 && nStale) log("coverage complete - cycling oldest files for refresh");

    const work = async (sym: string, position: number, st: { fetched: number }): Promise<TickerResult> => {
        const path = join(DATA_DIR, `${sym}.json`);
        const phase = position <= nPriority ? "priority" : position <= nPriority + nMissing ? "coverage" : "refresh";
        const started = performance.now();
        log(`FETCH [${position}/${queue.length}] ${phase} ${sym}: fetching option chain (writes=${st.fetched}/${cfg.MAX_FETCHES}, file=data/options/${sym}.json)`);
        let previousText: string | null = null;
        try {
            previousText = readFileSync(path, "utf8");
        } catch {
            previousText = null;
        }
        let payload: Payload | null;
        try {
            payload = await fetchTicker(sym);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            logErr(`ERROR [${position}/${queue.length}] ${phase} ${sym}: ${reason}`);
            return { kind: "failed", status: "failed", elapsed: (performance.now() - started) / 1000, reason };
        }
        const elapsed = (performance.now() - started) / 1000;
        if (payload === null) return { kind: "no-options", status: "no-options", elapsed };
        // The file is written on every successful fetch even when nothing but `updated` moved: freshness reads it.
        const text = pyJsonDumps(payload);
        const status = classifyPayload(previousText, text);
        writeFileSync(path, text);
        return { kind: "written", status, payload, elapsed, path };
    };

    const pool = await runPool<TickerResult>({
        queue,
        concurrency: cfg.CONCURRENCY,
        maxFetches: cfg.MAX_FETCHES,
        rateLimitHits: cfg.RATE_LIMIT_HITS,
        requestSleepMs: cfg.REQUEST_SLEEP * 1000,
        softDeadlineMs: cfg.SOFT_DEADLINE_SECONDS * 1000,
        work,
        onDone: (position, sym, r, st) => {
            const phase = position <= nMissing ? "coverage" : "refresh";
            counts[r.status]++;
            if (r.kind === "written") {
                delete skip[sym];
                if (r.status === "new") newTickers.push(sym);
            } else if (r.kind === "no-options") {
                skip[sym] = dateIso(todayDate());
                noOptionSyms.push(sym);
                log(`NO_OPTIONS [${position}/${queue.length}] ${phase} ${sym}: checked in ${pyFixed1(r.elapsed)}s; added to skiplist (re-check in ${cfg.SKIP_RECHECK_DAYS}d)`);
            } else {
                log(`ERROR [${position}/${queue.length}] ${phase} ${sym}: fetch failed after ${pyFixed1(r.elapsed)}s (fail streak ${st.failStreak}/${cfg.RATE_LIMIT_HITS})`);
            }
            console.log(outputTickerLine(position, queue.length, sym, r.status, { payload: r.payload, elapsed: r.elapsed, reason: r.reason }));
        },
    });
    if (pool.stopped === "max-fetches") {
        log(`STOP: reached MAX_FETCHES=${cfg.MAX_FETCHES}; stopping (resume next run)`);
        console.log(`${outputLabel("stop")} reached MAX_FETCHES=${cfg.MAX_FETCHES}, ${pool.notStarted} ticker(s) left for the next run`);
    } else if (pool.stopped === "rate-limit") {
        log(`STOP: ${cfg.RATE_LIMIT_HITS} consecutive errors - assuming rate-limited/blocked; will resume next run`);
        console.log(`${outputLabel("stop")} ${cfg.RATE_LIMIT_HITS} consecutive errors, assuming rate-limited or blocked, ${pool.notStarted} ticker(s) left for the next run`);
    } else if (pool.stopped === "deadline") {
        log(`STOP: soft deadline of ${cfg.SOFT_DEADLINE_SECONDS}s reached`);
        console.log(`${outputLabel("deadline")} soft deadline of ${Math.round(cfg.SOFT_DEADLINE_SECONDS)}s reached, ${pool.notStarted} ticker(s) not started, the index is still written`);
    }
    const fetched = pool.fetched;
    // Queue order whatever the finish order was.
    const updatedFiles: string[] = pool.results.flatMap((r) => (r?.kind === "written" && r.path ? [rel(r.path)] : []));

    log(`skiplist: saving ${Object.keys(skip).length} entries to data/options/index.json (no_options)`);
    log("index: rebuilding data/options/index.json manifest if files/names/skiplist changed");
    const indexChanged = writeIndex(skip);
    if (indexChanged && existsSync(LEGACY_SKIP_PATH)) {
        try {
            unlinkSync(LEGACY_SKIP_PATH);
            log("skiplist: removed legacy scripts/no_options.json");
        } catch (e) {
            logErr(`skiplist: could not remove legacy scripts/no_options.json: ${e instanceof Error ? e.message : e}`);
        }
    }
    if (indexChanged) {
        updatedFiles.push(rel(INDEX_PATH));
        log("index: wrote data/options/index.json");
    } else {
        log("index: unchanged; data/options/index.json was not rewritten");
    }

    const total = cachedSymbols().length;
    log(`DONE RUN: writes=${fetched}, missing_left_estimate=${Math.max(0, nMissing - fetched)}, no_options_added=${noOptionSyms.length}, total_cached=${total}`);
    console.log(`${outputDoneLine(counts, (performance.now() - runStarted) / 1000, pool.stopped)} total_cached=${total}`);

    if (newTickers.length) {
        const line = `NEW TICKERS (${newTickers.length}): ${newTickers.join(", ")}`;
        console.log(line);
        const summary = process.env.GITHUB_STEP_SUMMARY;
        if (summary) {
            try {
                appendFileSync(summary, `${line}\n`);
            } catch (e) {
                logErr(`could not append to GITHUB_STEP_SUMMARY: ${e instanceof Error ? e.message : e}`);
            }
        }
    }

    if (cfg.CHART_CACHE && pool.stopped !== "rate-limit") {
        const chartQueue = buildChartQueue(universe, {
            cached: cachedSymbols(),
            explicit: Boolean(process.env.TICKERS || process.env.TICKER),
            hasChart: (s) => existsSync(join(CHARTS_DIR, `${s}.json`)),
            isFresh: (s) => isFresh(join(CHARTS_DIR, `${s}.json`)),
            updatedOf: (s) => fileUpdated(join(CHARTS_DIR, `${s}.json`)),
        });
        console.log(`${outputLabel("charts")} ${chartQueue.length} queued, budget=${cfg.CHART_MAX_FETCHES} writes`);
        const charts = await runChartPass(chartQueue);
        console.log(`${outputLabel("charts")} written=${charts.written} failed=${charts.failed}${charts.stopped ? " (stopped: consecutive failures)" : ""}`);
    }

    console.log("\n=== UPDATED FILES (copy & replace these) ===");
    if (updatedFiles.length) {
        for (const p of updatedFiles) console.log(`  * ${p}`);
        console.log(`  (${updatedFiles.length} file(s) written this run)`);
    } else {
        console.log("  (none - everything was already fresh / skiplisted)");
    }
}

if (import.meta.main) {
    await main();
}
