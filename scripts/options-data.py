#!/usr/bin/env python3
# =============================================================================
# AGENTIC AI ENFORCED SPECIFICATION & GUIDELINES (CRITICAL)
# =============================================================================
# 1. KEEP DOCUMENTATION USEFUL: Preserve accurate docs, but correct or remove
#    stale comments instead of carrying misleading history forward.
# 2. AGENT READ-WRITE RULE: Keep this header synchronized with behavior on every
#    change (mirrors the main.tsx / index.css agentic-guide convention).
# 3. This file is INFRASTRUCTURE for the "build-time static cache" strategy. It
#    is NOT part of the 3-file app source (index.html / index.css / main.tsx).
# =============================================================================
#
# PROJECT: Options Desk — SMART build-time data fetcher
#
# CHANGELOG (append newest at top; keep history accurate):
#   v13 - Index manifest without timestamp churn:
#        * data/options/index.json `files` is now a sorted ticker LIST (not
#          {TICKER: updatedISO}). Dropped global `generated`.
#        * Freshness / oldest-first refresh use filesystem mtime and the
#          optional in-file `updated` field (weekend dead-zone rule unchanged).
#        * write_index() rewrites only when ticker set, names, or no_options
#          change (or once when migrating off the legacy timestamp shape), so
#          scheduled no-op runs no longer create git commits that only bump
#          datetimes.
#   v12 - No model greeks in the fetcher (single source of truth = UI runtime):
#        * Removed Black-Scholes / higher-order greek computation from this script.
#          Non-standard greeks (λ, vanna, vomma, charm, speed, zomma, color) and
#          full BS fallback for missing 1st-order are computed ONLY in the browser
#          (src/main.tsx → blackScholesGreeks / enrichQuotesWithModelGreeks).
#        * Fetcher still attaches provider-supplied Cboe delayed 1st-order greeks
#          (delta/gamma/theta/vega/rho) when available. No duplicate model math.
#        * Env BLACK_SCHOLES_GREEKS / GREEKS_RISK_FREE_RATE / GREEKS_DIVIDEND_YIELD
#          removed (no-ops if still set in old workflows).
#   v11 - Static-cache greeks enrichment:
#        * fetch_ticker() enriches yfinance chains with free Cboe delayed
#          greeks (delta/gamma/theta/vega/rho) by OCC contract symbol when available.
#        * (superseded by v12) previously also computed Black-Scholes in Python.
#        * Each cache payload includes a top-level `greeks` summary.
#   v10 - Local-index company names for ticker suggestions:
#        * data/options/index.json now also carries `names: { TICKER: companyName }` for
#          cached tickers and no-options skiplist entries whenever live universe
#          discovery can resolve a human-readable name. The app uses this to show
#          local suggestions like provider-native suggestions (company/fund/index
#          name instead of a generic "Ticker from local index") and to support
#          name-based local search.
#        * Name metadata is collected from the NASDAQ screener (preferred display
#          names such as "Apple Inc. Common Stock") and Cboe optionable-underlying
#          CSV (fallback), then preserved across no-op runs to avoid churn.
#   v9 - No-options skiplist lives in data/options/index.json:
#        * scripts/no_options.json is REMOVED. The skiplist is now stored as the
#          `no_options` field on data/options/index.json (alongside `files` / `count` /
#          `generated`), so one manifest tracks both cached tickers and the
#          tickers known to have no listed options.
#        * load_skiplist / save_skiplist / write_index all share data/options/index.json.
#          A one-shot migration still reads a leftover scripts/no_options.json if
#          present, then deletes it after a successful write.
#        * GitHub Actions only needs to `git add data/` (no separate skiplist path).
#          Note: v10+ app code surfaces this field in ticker suggestions as
#          `(no options)`.
#   v8 - Human-visible CI progress logging:
#        * Adds timestamped, flush-on-every-line log helpers so GitHub Actions
#          shows progress immediately instead of buffering output.
#        * Each queued symbol now emits a START line before yfinance is called
#          and a DONE/NO_OPTIONS/ERROR line with elapsed seconds, phase, queue
#          position, quote count, and budget progress. Universe loading and
#          index writing also log clear progress messages.
#   v7 - Reliable optionable universe fallback/merge:
#        * Adds the Cboe optionable-underlying CSV as a broad universe source.
#          If the NASDAQ screener is blocked/slow/unreachable, the fetcher now
#          still sees thousands of optionable underlyings instead of falling back
#          to the tiny built-in mega-cap seed list. When both sources work, the
#          Cboe list is used to keep the NASDAQ market-cap ordering focused on
#          symbols that actually list options, with Cboe-only names appended.
#        * Adds NASDAQ_TIMEOUT (default 20s) so a blocked NASDAQ API does not
#          stall every CI run for 45 seconds before the script can grow cache.
#   v6 - Market timezone + robust symbol-variant resolution:
#        * All "today" / working-day freshness logic now runs in a MARKET timezone
#          (TIMEZONE env, default America/New_York) instead of UTC, so "fetched
#          today" matches the actual NYSE/NASDAQ session (UTC rolls the day over
#          mid-evening in NY). `updated` is now stored with the tz offset. Set
#          TIMEZONE=UTC to restore the old behavior.
#        * fetch_ticker() now TRIES multiple symbol spellings via _symbol_variants
#          — dash / dot / slash AND the separator-stripped form (BRK-B, BRK.B,
#          BRK/B, BRKB) — returning the first that actually lists options, so a
#          wrong class-share separator can't cause a false "no options".
#   v5 - Class-share symbols + no-options skiplist + updated-file report:
#        * SYMBOL ALIASES / canonicalization (_canonical): the NASDAQ screener
#          spells class shares "BRK.B" / "BRK/B" but Yahoo/yfinance wants the DASH
#          form "BRK-B". Symbols are now canonicalized everywhere (universe, file
#          name, index key, skiplist) so BRK.B & co. actually fetch. Explicit
#          SYMBOL_ALIASES map (+ SYMBOL_ALIASES env) covers irregular cases; the
#          class-share "^"-only filter no longer drops "." / "/" tickers.
#        * NO-OPTIONS SKIPLIST (data/options/index.json → no_options; was scripts/no_options.json
#          before v9): a ticker that genuinely
#          returns no chain is recorded with the date checked and SKIPPED on
#          future runs (re-checked after SKIP_RECHECK_DAYS, default 30), so we
#          stop wasting the budget re-fetching dead tickers. A real network/source
#          ERROR is distinguished from "no options" (only errors count toward the
#          rate-limit streak; only true no-option results are skiplisted). A
#          symbol that later lists options is auto-removed from the skiplist.
#        * index.json no longer churns: it is rewritten ONLY when the per-ticker
#          `files` map actually changes (so `generated` isn't bumped on no-op runs).
#        * The run now PRINTS the exact list of files it wrote ("UPDATED FILES")
#          so you know precisely what to copy & replace.
#   v4 - Missing-first then oldest-first rotation, per-ticker index (see below).
#
# WHAT IT DOES (v13 — index has no timestamps/generated; v12 — Cboe 1st-order only; model greeks in UI; v10 names; v9 skiplist; v8 logged Cboe universe; v5/v4 queue + index):
#   1. Builds a UNIVERSE of optionable US underlyings. Preferred path: pull the
#      NASDAQ screener (no key), sort DESC by market cap, and keep/merge symbols
#      that appear in Cboe's optionable-underlying directory so the queue mostly
#      walks liquid optionable names first. If NASDAQ is unreachable, use the
#      broad Cboe directory directly (thousands of underlyings) instead of the
#      tiny built-in seed list. Filters NASDAQ rows to the Microcap floor
#      (>= $10M) so it walks the tiers Mega(176B+) -> Large(36B+) -> Mid(6B+) ->
#      Small(2B+) -> Micro(10M+). Falls back to the small built-in list only if
#      BOTH live universe sources fail.
#   2. Builds a WORK QUEUE in two phases (this is the v4 change — see below):
#        PHASE 1 (COVERAGE): every universe symbol that has NO cached file yet,
#          in market-cap order (Mega -> Micro). The #1 goal is to get data for
#          ALL possible tickers FIRST, resuming DOWN the list where the previous
#          run stopped — NOT re-looping the top-cap names over and over.
#        PHASE 2 (REFRESH): once nothing is missing, refresh EXISTING files that
#          are STALE (per the working-day rules), OLDEST-UPDATED FIRST, so the
#          cache rotates evenly and the least-fresh data is always updated next.
#      Files that are still FRESH today are skipped in both phases.
#   3. Fetches the full option chain via yfinance, enriches greeks from Cboe
#      delayed 1st-order quotes (model greeks left to the UI), then WRITES/OVERWRITES
#      data/options/{SYMBOL}.json. Stops when EITHER we hit the per-run budget
#      (MAX_FETCHES) OR the source appears to rate-limit us (a streak of
#      empty/error responses). Each run does NEW work; the next run resumes.
#   4. Rewrites data/options/index.json as a per-ticker manifest that records EACH
#      ticker's own `updated` timestamp (see OUTPUT SHAPE) so freshness is
#      visible without opening every file. It is regenerated from the files on
#      disk (each file's real `updated`), so unchanged tickers keep their old
#      timestamp — the manifest no longer churns a single global `updated`.
#      The same file also stores the no-options skiplist under `no_options`.
#
# FRESHNESS RULES (see _file_is_fresh): a cached file is SKIPPED when...
#   * it was updated TODAY (any day); OR
#   * TODAY is NOT a trading day (weekend/holiday) AND it was updated on the LAST
#     trading day (or later) — that's the freshest data that exists.
#   ...and it is RE-FETCHED (stale) when TODAY is a trading day (Mon-Fri, not a
#   holiday) and the file is from an earlier day. So across a week the cache ends
#   up fully refreshed, and yesterday's files get updated today.
#
# WHY THIS DESIGN:
#   - No hand-maintained ticker list (user request): the universe is discovered.
#   - COVERAGE-FIRST, then ROTATING REFRESH: the previous version re-walked the
#     universe top-down every run, so if it never got past the mega-caps it kept
#     re-fetching the SAME first tickers and never reached the rest. v4 fixes that
#     by doing all MISSING tickers first (so every ticker eventually gets cached),
#     then cycling the OLDEST existing files so refreshes spread across the whole
#     cache instead of piling on the top names.
#   - Idempotent + resumable: safe to run many times/day from GitHub Actions.
#
# OUTPUT SHAPE (matches the "Static cache" provider in main.tsx):
#   data/options/index.json        -> { "files": ["<TICKER>", ...],
#                               "count": N,
#                               "names": { "<TICKER>": "Company Name", ... },
#                               "no_options": { "<TICKER>": "YYYY-MM-DD", ... } }
#                             (v13: `files` is a sorted ticker LIST — no per-ticker
#                             timestamps and no global `generated`. Freshness uses
#                             data/options/{TICKER}.json mtime (+ in-file `updated` for the
#                             weekend dead-zone rule). Legacy map shape still read.
#                             v9: `no_options` skiplist. v10: `names` for suggestions.)

#   data/options/{TICKER}.json     -> { symbol, updated (ISO), underlyingPrice,
#                               greeks{...}, expirations[], quotes[] }
#                             quotes keep bid/ask/last/volume/OI/IV from yfinance,
#                             then fill delta/gamma/theta/vega/rho from Cboe delayed
#                             data when available. Model / higher-order greeks are
#                             NOT computed here — the UI (src/main.tsx) does that
#                             at runtime for ALL providers including CACHE.
#                             Per-quote `greeksSource` is `cboe` or null;
#                             `greeksMissingReason` explains remaining gaps.
#
# USAGE:
#   pip install yfinance requests
#   python scripts/options-data.py                 # smart auto-universe run
#   MAX_FETCHES=50 python scripts/options-data.py  # cap how many NEW fetches
#   UNIVERSE_SIZE=500 python scripts/options-data.py  # how deep the ranked list is
#   MAX_EXPIRATIONS=8 python scripts/options-data.py  # cap expirations per ticker
#   TICKERS="AAPL MSFT" python scripts/options-data.py # override: only these
#
# TUNABLES (env):
#   MAX_FETCHES      default 500        NEW (non-skipped) fetches per run.
#   UNIVERSE_SIZE    default 6000       how many top-market-cap/optionable symbols to consider.
#   MIN_MARKET_CAP   default 90000000   Microcap floor in USD for NASDAQ rows (drops nano-caps).
#   NASDAQ_TIMEOUT   default 20         seconds to wait for NASDAQ before using Cboe fallback.
#   MAX_EXPIRATIONS  default 12         expirations stored per ticker (keeps JSON small)
#   RATE_LIMIT_HITS  default 3          consecutive ERRORS that mean "we're blocked".
#   REQUEST_SLEEP    default 0.6        seconds between fetches (be polite to Yahoo).
#   SKIP_RECHECK_DAYS default 30        days before a no-options ticker is re-checked.
#   CBOE_GREEKS default 1               enrich static cache with Cboe delayed 1st-order greeks.
#                                       (Model/higher-order greeks: UI only — do not re-add here.)
#   SYMBOL_ALIASES   default ""         extra "SCREENER=YAHOO" aliases, comma-separated
#                                       (e.g. "BRK.B=BRK-B,FOO=BAR"). Class shares are
#                                       auto-canonicalized ("."/"/" -> "-") regardless.
#   TIMEZONE  default America/New_York  market tz for "today"/working-day rules.
#                                       Set TIMEZONE=UTC for the old UTC behavior.
# =============================================================================

import csv
import io
import json
import os
import sys
import math
import time
from datetime import datetime, timezone, timedelta
from urllib.parse import quote

# ---- Timezone ---------------------------------------------------------------
# All freshness / "today" logic runs in a MARKET timezone, defaulting to US
# Eastern (America/New_York) — the timezone the NYSE/NASDAQ session runs in — so
# "fetched today" and the working-day rules line up with actual trading days
# rather than UTC (which rolls over mid-evening in New York). Override with the
# TIMEZONE env var, exactly like MAX_FETCHES / MARKET_CAP etc. Set TIMEZONE=UTC
# to restore the old behavior. Falls back to UTC if zoneinfo/the tz db is
# unavailable (e.g. a minimal container without tzdata).
try:
    from zoneinfo import ZoneInfo
except ImportError:  # Python < 3.9; our CI uses 3.13 so this is just a guard.
    ZoneInfo = None

MARKET_TZ_NAME = os.environ.get("TIMEZONE", "America/New_York")


def _market_tz():
    """Return the configured market tzinfo (America/New_York by default).
    Degrades to UTC if the name is unknown or zoneinfo is missing."""
    if ZoneInfo is None:
        return timezone.utc
    try:
        return ZoneInfo(MARKET_TZ_NAME)
    except Exception:
        print(f"  ! unknown TIMEZONE={MARKET_TZ_NAME!r}; falling back to UTC",
              file=sys.stderr, flush=True)
        return timezone.utc


MARKET_TZ = _market_tz()

try:
    import yfinance as yf
except ImportError:
    print("ERROR: yfinance not installed. Run: pip install yfinance", file=sys.stderr, flush=True)
    sys.exit(1)

try:
    import requests
except ImportError:
    requests = None  # only needed for the live universe; we degrade gracefully

# ---- Paths & configuration --------------------------------------------------
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "options")
INDEX_PATH = os.path.join(DATA_DIR, "index.json")
# Legacy location of the no-options skiplist (pre-v9). Still read once for
# migration, then deleted after the skiplist is written into INDEX_PATH.
LEGACY_SKIP_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "no_options.json")
MAX_FETCHES = int(os.environ.get("MAX_FETCHES", "500"))
# How deep the market-cap-ranked universe goes. The NASDAQ screener returns
# ~7k US tickers across NASDAQ/NYSE/AMEX/Arca; the whole optionable universe is a
# few thousand, so a high default lets the resumable runs eventually cache them
# ALL (Mega -> Micro), a chunk per run.
UNIVERSE_SIZE = int(os.environ.get("UNIVERSE_SIZE", "6000"))
# Minimum market cap to include (USD). Default $10M = Microcap floor; anything
# smaller (nano-caps) is dropped — they rarely have listed options.
MIN_MARKET_CAP = float(os.environ.get("MIN_MARKET_CAP", "9000000"))
MAX_EXPIRATIONS = int(os.environ.get("MAX_EXPIRATIONS", "12"))
RATE_LIMIT_HITS = int(os.environ.get("RATE_LIMIT_HITS", "3"))
REQUEST_SLEEP = float(os.environ.get("REQUEST_SLEEP", "0.6"))
NASDAQ_TIMEOUT = float(os.environ.get("NASDAQ_TIMEOUT", "20"))
# Days before a symbol on the "no options" skiplist is re-checked. A ticker that
# yields no chain is remembered so we DON'T keep re-fetching it every run, but we
# re-try after this many days in case it later lists options (self-healing).
SKIP_RECHECK_DAYS = int(os.environ.get("SKIP_RECHECK_DAYS", "30"))
# Greeks enrichment: provider-supplied Cboe delayed 1st-order ONLY.
# Higher-order + full Black-Scholes fallback live exclusively in the browser
# (src/main.tsx). Do not reintroduce model math here — that would duplicate the UI.
CBOE_GREEKS = os.environ.get("CBOE_GREEKS", "1").lower() not in ("0", "false", "no", "off")
CBOE_GREEKS_TIMEOUT = float(os.environ.get("CBOE_GREEKS_TIMEOUT", "10"))

# ---- Ticker symbol aliases --------------------------------------------------
# Some data sources use a different symbol spelling than the NASDAQ screener.
# yfinance/Yahoo uses a DASH for class shares (e.g. screener "BRK.B" -> Yahoo
# "BRK-B"). Explicit aliases below win; otherwise _canonical() rewrites any "."
# or "/" separator to "-". As an EXTRA safety net, fetch_ticker() also TRIES
# multiple spellings via _symbol_variants (dash, dot, slash, AND the separator-
# stripped form "BRKB") until one actually lists options — so even if a given
# separator doesn't work we still find the chain. Extend via the SYMBOL_ALIASES
# env: "BRK.B=BRK-B,FOO=BAR".
SYMBOL_ALIASES = {
    "BRK.B": "BRK-B",
    "BRK/B": "BRK-B",
    "BRKB":  "BRK-B",
    "BF.B":  "BF-B",
    "BF/B":  "BF-B",
    "HEI.A": "HEI-A",
    "LEN.B": "LEN-B",
}
# Merge any user-provided aliases from the environment.
for _pair in os.environ.get("SYMBOL_ALIASES", "").split(","):
    if "=" in _pair:
        _k, _v = _pair.split("=", 1)
        if _k.strip() and _v.strip():
            SYMBOL_ALIASES[_k.strip().upper()] = _v.strip().upper()

# Broad Cboe directory of optionable underlyings. This is much more reliable for
# cache growth than the NASDAQ screener alone: if NASDAQ is blocked/slow in CI,
# this endpoint still gives us thousands of symbols that should have listed
# options, so the coverage queue can continue beyond the tiny seed list.
CBOE_UNDERLYINGS_URL = (
    "https://cdn.cboe.com/data/us/options/market_statistics/"
    "symbol_reference/opt-underlying.csv"
)

# Small, dependable seed/final fallback universe (already market-cap-ish ordered)
# used to front-load liquid names and as a last resort if all live universe
# sources fail.
FALLBACK_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "BRK.B", "AVGO",
    "JPM", "LLY", "V", "XOM", "UNH", "MA", "COST", "HD", "PG", "JNJ", "WMT",
    "NFLX", "BAC", "ORCL", "CRM", "AMD", "KO", "PEP", "TMUS", "ADBE", "CVX",
    "QQQ", "SPY", "IWM", "DIA",  # popular ETFs traders watch
]

# v10: live universe discovery fills this TICKER -> human name map. write_index()
# persists the subset relevant to cached/no-options symbols into data/options/index.json.
SYMBOL_NAMES = {}


def _canonical(sym):
    """
    Normalize a screener/user symbol to the spelling the data source (Yahoo)
    expects, so we don't fail on class-share tickers like BRK.B.
      * Explicit SYMBOL_ALIASES win (e.g. BRK.B -> BRK-B).
      * Otherwise class-share separators are converted: NASDAQ screener uses "."
        or "/" for share classes (BRK.B, BRK/B) while Yahoo uses "-" (BRK-B).
    The canonical form is used EVERYWHERE (universe, file name, index key,
    missing-check) so a ticker is fetched, named, and skipped consistently.
    """
    sym = sym.upper().strip()
    if sym in SYMBOL_ALIASES:
        return SYMBOL_ALIASES[sym]
    return sym.replace(".", "-").replace("/", "-")


def _clean_company_name(name):
    """Normalize a provider company/fund/index name for stable index.json output."""
    text = " ".join(str(name or "").strip().split())
    return "" if text.lower() in ("", "none", "null", "nan", "--", "n/a") else text


def _remember_symbol_name(sym, name):
    """Remember a display name for a canonical symbol (NASDAQ overwrites Cboe)."""
    symbol = _canonical(sym)
    company = _clean_company_name(name)
    if symbol and company:
        SYMBOL_NAMES[symbol] = company


def _symbol_variants(sym):
    """
    Candidate spellings to TRY (in order) for a symbol whose class-share
    separator we can't be 100% sure about. Yahoo usually wants the DASH form
    (BRK-B), but to be robust we also try dot, slash, and the SEPARATOR-STRIPPED
    form just in case (BRK-B -> BRKB). Order:
      1. the canonical form (explicit alias or "."/"/" -> "-")
      2. dash / dot / slash variants of the base
      3. the fully-stripped form (no separator at all)
      4. the raw input as given
    De-duplicated, order-preserving. For a plain ticker (AAPL) this is just
    ["AAPL"], so there's zero extra work for the common case.
    """
    raw = sym.upper().strip()
    canon = _canonical(raw)
    # Base without any separator so we can rebuild each variant consistently.
    base = raw.replace(".", "").replace("/", "").replace("-", "")
    variants = [canon]
    if any(c in raw for c in "./-"):
        # Only bother generating separator variants for class-share-looking syms.
        # Split on the FIRST separator to preserve e.g. "BRK" + "B".
        for sep in (".", "/", "-"):
            if sep in raw:
                left, right = raw.split(sep, 1)
                variants += [f"{left}-{right}", f"{left}.{right}", f"{left}/{right}"]
                break
        variants.append(base)  # BRKB (stripped)
    variants.append(raw)
    # Smart fallback: if the raw/base symbol lacks options, it might be an index.
    variants.append(f"^{base}")
    variants.append(f"^{raw}")
    return _dedupe(variants)


def _dedupe(seq):
    """Order-preserving de-duplication (canonicalization can collapse dupes)."""
    seen = set()
    out = []
    for s in seq:
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _num(v):
    """Coerce to a JSON-safe float or None (NaN/inf -> None)."""
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _mid(bid, ask):
    """Mid = (bid+ask)/2 when both are positive, else None."""
    if bid is not None and ask is not None and bid > 0 and ask > 0:
        return (bid + ask) / 2.0
    return None


def _today():
    """Today's date in the configured MARKET timezone (NY by default)."""
    return datetime.now(MARKET_TZ).date()


def _today_iso():
    return _today().strftime("%Y-%m-%d")


def _now_iso():
    """Current instant as an ISO-8601 string WITH the market-tz offset (e.g.
    '2026-07-10T14:32:05-04:00'). Keeping the offset makes the stored `updated`
    unambiguous and JS `new Date(...)` parses it correctly for local display."""
    return datetime.now(MARKET_TZ).isoformat()


def _log(message):
    """Print one timestamped progress line and flush immediately for CI logs."""
    print(f"[{_now_iso()}] {message}", flush=True)


def _log_err(message):
    """Print one timestamped error/progress line to stderr and flush immediately."""
    print(f"[{_now_iso()}] {message}", file=sys.stderr, flush=True)


# ---- Working-day / freshness helpers ----------------------------------------
# US market holidays (NYSE/NASDAQ full-day closures). Extend yearly as needed.
US_MARKET_HOLIDAYS = {
    # 2025
    "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
    "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    # 2026
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    # 2027
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
    "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
}


def _is_trading_day(d):
    """True if date `d` is a US market trading day (Mon-Fri and not a holiday)."""
    if d.weekday() >= 5:              # Sat=5, Sun=6
        return False
    return d.strftime("%Y-%m-%d") not in US_MARKET_HOLIDAYS


def _last_trading_day(ref):
    """The most recent trading day on or BEFORE `ref` (a date)."""
    d = ref
    for _ in range(10):              # walk back at most ~10 days
        if _is_trading_day(d):
            return d
        d = d - timedelta(days=1)
    return d


def _file_is_fresh(updated_iso):
    """
    Decide whether a cached file's `updated` date is still FRESH (skip) given the
    business rules:
      * Fetched TODAY (any day)                       -> fresh (skip).
      * TODAY is NOT a trading day (weekend/holiday), and the file was updated on
        the LAST trading day (or later)               -> fresh (skip).
      * TODAY IS a trading day and the file was updated on an earlier day (i.e.
        before today)                                 -> STALE (re-fetch).
    `updated_iso` is the stored "YYYY-MM-DD..." string; returns True to SKIP.
    """
    day = str(updated_iso)[:10]
    if not day:
        return False
    today = _today()
    today_str = today.strftime("%Y-%m-%d")

    if day == today_str:
        return True  # already refreshed today

    if not _is_trading_day(today):
        # Market closed today: data from the last trading day is the freshest
        # available, so anything updated on/after that day is still current.
        ltd = _last_trading_day(today).strftime("%Y-%m-%d")
        return day >= ltd

    # Today is a trading day but the file is from a previous day -> stale.
    return False


# ---- Universe discovery ------------------------------------------------------

def _live_cboe_universe():
    """
    Return Cboe's broad list of optionable underlyings (Equity/ETF/etc.).

    This is intentionally separate from the NASDAQ screener. NASDAQ gives useful
    market-cap ordering when it works, but it is not reliable in CI (timeouts /
    bot blocking are common). Cboe's CSV is smaller, plain static content, and is
    already restricted to underlyings with listed options, so it is the right
    fallback for a cache whose main job is to GROW coverage.
    """
    if requests is None:
        return []

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; OptionsDeskBot/1.0)",
        "Accept": "text/csv,*/*",
    }
    try:
        _log("universe/cboe: downloading optionable-underlying CSV...")
        r = requests.get(CBOE_UNDERLYINGS_URL, headers=headers, timeout=20)
        r.raise_for_status()
        rows = csv.DictReader(io.StringIO(r.text))
        syms = []
        for row in rows:
            sym = (row.get("Symbol") or "").strip()
            if not sym:
                continue
            # Ignore adjusted/odd OCC-style symbols when present; keep class
            # shares because _canonical() rewrites BRK.B/BRK/B to BRK-B.
            if "^" in sym:
                continue
            syms.append(_canonical(sym))
            # v10: keep the human-readable company/fund name for local ticker
            # suggestions. NASDAQ names (loaded afterward) may overwrite these
            # Cboe names with nicer "Common Stock" style labels.
            _remember_symbol_name(sym, row.get("Company"))
        syms = _dedupe(syms)
        _log(f"universe/cboe: loaded {len(syms)} optionable symbols")
        return syms
    except Exception as e:
        _log_err(f"universe/cboe: failed ({e})")
        return []


def _live_nasdaq_marketcap_universe():
    """
    Return NASDAQ screener symbols sorted DESC by market cap, or [] if the
    screener is unavailable. This source is nice-to-have for ordering; it must
    NOT be the only way to discover work, because it often times out/blocks bots.
    """
    if requests is None:
        return []

    # The unfiltered NASDAQ screener already spans ALL US exchanges
    # (NASDAQ / NYSE / NYSE American / NYSE Arca) in one response (~7k rows).
    url = ("https://api.nasdaq.com/api/screener/stocks"
           "?tableonly=true&limit=25000&download=true")
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; OptionsDeskBot/1.0)",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://www.nasdaq.com",
        "Referer": "https://www.nasdaq.com/market-activity/stocks/screener",
    }
    try:
        _log(f"universe/nasdaq: downloading market-cap screener (timeout={NASDAQ_TIMEOUT}s)...")
        r = requests.get(url, headers=headers, timeout=NASDAQ_TIMEOUT)
        r.raise_for_status()
        rows = r.json().get("data", {}).get("rows", []) or []

        def cap(row):
            try:
                return float(str(row.get("marketCap", "0")).replace(",", "") or 0)
            except ValueError:
                return 0.0

        # Keep real, optionable-looking tickers and enforce the Microcap floor
        # (>= MIN_MARKET_CAP). We DROP warrant/preferred rows carrying "^", but we
        # KEEP class shares (BRK.B / BRK/B): _canonical() rewrites their separator
        # to the Yahoo dash form (BRK-B) so yfinance can actually fetch them.
        # Sort DESC by cap so runs walk Mega -> Large -> Mid -> Small -> Micro.
        clean = [x for x in rows if x.get("symbol")
                 and "^" not in x["symbol"]
                 and cap(x) >= MIN_MARKET_CAP]
        clean.sort(key=cap, reverse=True)
        syms = _dedupe([_canonical(x["symbol"]) for x in clean])
        # v10: NASDAQ provides the nicer display names users expect in the
        # suggestion menu (e.g. "Apple Inc. Common Stock"). Because NASDAQ loads
        # after Cboe, these overwrite the rougher Cboe CSV company labels.
        for row in clean:
            _remember_symbol_name(row.get("symbol"), row.get("name"))

        if syms:
            # Tier breakdown (Mega 176B+, Large 36B+, Mid 6B+, Small 2B+, Micro 10M+).
            def tier(c):
                return ('Mega' if c >= 176e9 else 'Large' if c >= 36e9 else
                        'Mid' if c >= 6e9 else 'Small' if c >= 2e9 else 'Micro')
            from collections import Counter
            counts = Counter(tier(cap(x)) for x in clean)
            _log(f"universe/nasdaq: loaded {len(syms)} symbols "
                 f"(>= ${MIN_MARKET_CAP:,.0f}); "
                 f"tiers={{'Mega':{counts['Mega']}, 'Large':{counts['Large']}, "
                 f"'Mid':{counts['Mid']}, 'Small':{counts['Small']}, "
                 f"'Micro':{counts['Micro']}}}; top: {', '.join(syms[:5])}")
        return syms
    except Exception as e:
        _log_err(f"universe/nasdaq: failed ({e})")
        return []


def load_universe():
    """
    Return the symbols to consider this run.

    Order is:
      1. explicit TICKERS env override;
      2. NASDAQ market-cap order, filtered/extended by Cboe optionable symbols
         when Cboe is available;
      3. broad Cboe optionable list (seeded with mega-cap FALLBACK_UNIVERSE) if
         NASDAQ is unavailable;
      4. tiny built-in fallback only if live sources fail.
    """
    # Explicit override wins (kept for convenience / testing).
    override = os.environ.get("TICKERS") or os.environ.get("TICKER")
    if override:
        syms = _dedupe([_canonical(t) for t in override.replace(",", " ").split() if t.strip()])
        _log(f"universe/override: using {len(syms)} symbols from TICKERS/TICKER env: {', '.join(syms[:20])}")
        return syms

    if requests is None:
        _log("universe/fallback: requests not installed; using built-in fallback universe")
        return _dedupe([_canonical(s) for s in FALLBACK_UNIVERSE])[:UNIVERSE_SIZE]

    cboe = _live_cboe_universe()
    nasdaq = _live_nasdaq_marketcap_universe()

    if nasdaq and cboe:
        # Keep NASDAQ's market-cap ordering, but avoid wasting the queue on the
        # thousands of equities that have no listed options. Append Cboe-only
        # names afterward so class ETFs/new listings not present in NASDAQ still
        # become eligible for coverage.
        optionable = set(cboe)
        syms = _dedupe([s for s in nasdaq if s in optionable] + cboe)
        _log(f"universe/final: {len(syms)} optionable symbols "
             f"(NASDAQ market-cap ordered + Cboe append); top: {', '.join(syms[:5])}")
        return syms[:UNIVERSE_SIZE]

    if nasdaq:
        # Better than Cboe if it is the only live source because it preserves the
        # original market-cap walk; no-options skiplist will prune non-optionable
        # names over time.
        _log(f"universe/final: {len(nasdaq)} symbols from NASDAQ only; "
             f"top: {', '.join(nasdaq[:5])}")
        return nasdaq[:UNIVERSE_SIZE]

    if cboe:
        syms = _dedupe([_canonical(s) for s in FALLBACK_UNIVERSE] + cboe)
        _log(f"universe/final: {len(syms)} optionable symbols from Cboe "
             f"(NASDAQ unavailable); top: {', '.join(syms[:5])}")
        return syms[:UNIVERSE_SIZE]

    _log_err("universe/fallback: all live universe sources failed; using tiny built-in fallback")
    return _dedupe([_canonical(s) for s in FALLBACK_UNIVERSE])[:UNIVERSE_SIZE]


# ---- Per-ticker fetch -------------------------------------------------------

def _spot(ticker):
    try:
        p = ticker.fast_info.get("last_price")
        if p:
            return _num(p)
    except Exception:
        pass
    try:
        hist = ticker.history(period="1d")
        if not hist.empty:
            return _num(hist["Close"].iloc[-1])
    except Exception:
        pass
    return None


def _rows_from_frame(frame, expiration, side):
    out = []
    for _, r in frame.iterrows():
        bid = _num(r.get("bid"))
        ask = _num(r.get("ask"))
        out.append({
            "symbol": str(r.get("contractSymbol", "")),
            "expiration": expiration,
            "side": side,
            "strike": _num(r.get("strike")) or 0,
            "bid": bid,
            "ask": ask,
            "mid": _mid(bid, ask),
            "last": _num(r.get("lastPrice")),
            "volume": _num(r.get("volume")),
            "openInterest": _num(r.get("openInterest")),
            "iv": _num(r.get("impliedVolatility")),  # decimal (0.25 = 25%)
            # 1st-order filled from Cboe when available; higher-order / model = UI only.
            "delta": None, "gamma": None, "theta": None, "vega": None, "rho": None,
            "greeksSource": None,
            "greeksMissingReason": "not_enriched",
        })
    return out


# ---- Greeks enrichment ------------------------------------------------------
# Provider-supplied Cboe delayed 1st-order greeks only (delta/gamma/theta/vega/rho).
# Higher-order (λ/vanna/vomma/charm/speed/zomma/color) and full Black-Scholes
# fallback for missing 1st-order are computed at RUNTIME in src/main.tsx so we
# never maintain two copies of the model. Do not re-add BS math here.
CBOE_OPTIONS_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/{symbol}.json"
CBOE_INDEX_SET = {"SPX", "VIX", "NDX", "RUT", "DJX", "XSP", "OEX", "VXN"}


def _cboe_symbol_candidates(symbol, matched_symbol=None):
    raw = str(symbol or "").upper().strip().replace("^", "")
    matched = str(matched_symbol or "").upper().strip().replace("^", "")
    bases = _dedupe([raw, matched, raw.replace("-", "."), raw.replace("-", "/"), raw.replace("-", "")])
    out = []
    for b in bases:
        if not b:
            continue
        out.append(f"_{b}" if b in CBOE_INDEX_SET else b)
        out.append(b)
    return _dedupe(out)


def _fetch_cboe_greeks(symbol, matched_symbol=None):
    """Return OCC option symbol -> Cboe option row, or {} if Cboe is unavailable."""
    if not CBOE_GREEKS or requests is None:
        return {}
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; OptionsDeskBot/1.0)",
        "Accept": "application/json,*/*",
    }
    for cand in _cboe_symbol_candidates(symbol, matched_symbol):
        url = CBOE_OPTIONS_URL.format(symbol=quote(cand, safe=""))
        try:
            r = requests.get(url, headers=headers, timeout=CBOE_GREEKS_TIMEOUT)
            if r.status_code == 404:
                continue
            r.raise_for_status()
            j = r.json()
            rows = (j.get("data") or {}).get("options") or []
            if not rows:
                continue
            if cand != symbol:
                _log(f"GREEKS {symbol}: using Cboe symbol '{cand}'")
            return {str(o.get("option", "")).upper(): o for o in rows if o.get("option")}
        except Exception as e:
            _log_err(f"GREEKS {symbol}: Cboe candidate '{cand}' failed: {e}")
            continue
    return {}


def _has_delta_gamma(q):
    return _num(q.get("delta")) is not None and _num(q.get("gamma")) is not None


def _apply_greeks_enrichment(symbol, matched_symbol, spot, quotes):
    """Attach Cboe 1st-order greeks only. `spot` kept for API compatibility / future use."""
    del spot  # unused — model greeks live in the UI
    total = len(quotes)
    cboe_rows = _fetch_cboe_greeks(symbol, matched_symbol)
    stats = {
        "enabled": bool(CBOE_GREEKS),
        "primarySource": "cboe" if CBOE_GREEKS else None,
        # Model fallback is client-side only (src/main.tsx).
        "fallbackSource": "client-black-scholes",
        "riskFreeRate": None,
        "dividendYield": None,
        "total": total,
        "cboeMatched": 0,
        "computed": 0,  # always 0 here — UI computes model greeks
        "missing": 0,
        "cboeContracts": len(cboe_rows),
    }

    for q in quotes:
        occ = str(q.get("symbol", "")).upper()
        c = cboe_rows.get(occ)
        if c:
            for field in ("delta", "gamma", "theta", "vega", "rho"):
                val = _num(c.get(field))
                if val is not None:
                    q[field] = val
            if _has_delta_gamma(q):
                q["greeksSource"] = "cboe"
                q["greeksMissingReason"] = None
                stats["cboeMatched"] += 1
                continue

        # Leave 1st-order empty; UI will try Black-Scholes when IV/spot allow.
        q["greeksSource"] = None
        q["greeksMissingReason"] = "cboe_unmatched" if cboe_rows else ("cboe_disabled" if not CBOE_GREEKS else "cboe_unavailable")
        stats["missing"] += 1

    return stats


def _resolve_options(symbol):
    """
    Find a spelling of `symbol` that Yahoo actually serves options for. Tries the
    variants from _symbol_variants (dash/dot/slash/stripped) and returns the
    first (yfinance Ticker, expirations, matched_symbol) whose option list is
    non-empty. Returns (None, [], None) if NONE of the variants list options.
    A network error is left to bubble up to the caller (so it counts as an error,
    not "no options").
    """
    variants = _symbol_variants(symbol)
    for i, cand in enumerate(variants):
        t = yf.Ticker(cand)
        exps = list(t.options or [])
        if exps:
            if cand != variants[0]:
                _log(f"RESOLVE {symbol}: using Yahoo variant '{cand}'")
            return t, exps, cand
    return None, [], None


def fetch_ticker(symbol):
    """Fetch and normalize the full (capped) chain for one ticker.
    Returns the payload dict, or None if the ticker has no options / failed.
    Tries alternate symbol spellings (BRK-B / BRK.B / BRK/B / BRKB) so odd
    class-share separators don't cause a false 'no options'."""
    symbol = symbol.upper().strip()
    t, exps, matched = _resolve_options(symbol)
    if not exps:
        return None
    exps = exps[:MAX_EXPIRATIONS]

    quotes = []
    for exp in exps:
        try:
            ch = t.option_chain(exp)
        except Exception as e:
            _log_err(f"SKIP_EXPIRATION {symbol} {exp}: {e}")
            continue
        quotes.extend(_rows_from_frame(ch.calls, exp, "call"))
        quotes.extend(_rows_from_frame(ch.puts, exp, "put"))

    if not quotes:
        return None

    spot = _spot(t)
    greeks_meta = _apply_greeks_enrichment(symbol, matched, spot, quotes)

    return {
        "symbol": symbol,
        "updated": _now_iso(),
        "underlyingPrice": spot,
        "greeks": greeks_meta,
        "expirations": exps,
        "quotes": quotes,
    }


# ---- Freshness check --------------------------------------------------------

def _file_updated(path):
    """Return a cached file's stored `updated` ISO string, or mtime-based ISO.

    Used by is_fresh (weekend dead-zone) and to order the REFRESH phase
    oldest-first. Index.json no longer stores these timestamps (v13) — the
    filesystem mtime is the source of truth when the in-file field is absent.
    """
    try:
        with open(path) as f:
            val = str(json.load(f).get("updated", "") or "")
            if val:
                return val
    except Exception:
        pass
    try:
        return datetime.fromtimestamp(os.path.getmtime(path), tz=_market_tz()).isoformat()
    except Exception:
        return ""


def is_fresh(path):
    """
    Continuous cyclic update rule:
    We NEVER consider files 'fresh' (meaning we endlessly update oldest first),
    EXCEPT during the weekend dead zone (Friday 20:00 EST to Sunday 18:00 EST).
    During that dead zone, a single update is enough, so if a file was updated
    after Friday 20:00 EST, it is skipped until Sunday 18:00 EST.
    """
    if not os.path.exists(path):
        return False
        
    updated_str = _file_updated(path)
    if not updated_str:
        return False
        
    try:
        updated_dt = datetime.fromisoformat(updated_str)
    except Exception:
        return False
        
    now = datetime.now(_market_tz())
    if updated_dt.tzinfo is None:
        updated_dt = updated_dt.replace(tzinfo=timezone.utc).astimezone(_market_tz())
    else:
        updated_dt = updated_dt.astimezone(_market_tz())

    # Determine this week's Friday 20:00 to Sunday 18:00
    # Monday=0 ... Friday=4, Sunday=6
    fri_offset = 4 - now.weekday()
    fri_date = now.date() + timedelta(days=fri_offset)
    
    fri_dt = datetime.combine(fri_date, datetime.min.time()).replace(tzinfo=_market_tz())
    dz_start = fri_dt + timedelta(hours=20)
    dz_end = dz_start + timedelta(days=2, hours=-2)  # Sun 18:00
    
    if dz_start <= now < dz_end:
        # We are IN the weekend dead zone. Skip if updated after dead zone started.
        if updated_dt >= dz_start:
            return True
            
    # Outside the dead zone, EVERYTHING is stale (continuous cyclic updates).
    return False


# ---- "No options" skiplist --------------------------------------------------
# Tickers that returned NO option chain are recorded here so we don't waste the
# per-run budget re-fetching them every time. Each entry stores the date we last
# checked; after SKIP_RECHECK_DAYS we re-try (a ticker may start listing options
# later).
#
# v9/v10: the skiplist lives on data/options/index.json under `no_options` (same
# manifest as `files` and `names`). The static app surfaces this field in ticker
# suggestions as `(no options)`. A leftover scripts/no_options.json (pre-v9) is
# still accepted once for migration and then removed.


def _read_index_doc():
    """Return the parsed data/options/index.json object, or {} if missing/unreadable."""
    try:
        with open(INDEX_PATH) as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _sorted_no_options(skip):
    """Stable, sorted {SYMBOL: YYYY-MM-DD} map for the index.json skiplist."""
    return {k: skip[k] for k in sorted(skip)}


def load_skiplist():
    """Return {SYMBOL: 'YYYY-MM-DD last-checked'} of known no-option tickers.

    Prefers data/options/index.json → no_options. Falls back to the legacy
    scripts/no_options.json path so older checkouts migrate cleanly on the next
    successful save.
    """
    doc = _read_index_doc()
    d = doc.get("no_options")
    if isinstance(d, dict) and d:
        return dict(d)
    # One-shot migration from the pre-v9 path.
    try:
        with open(LEGACY_SKIP_PATH) as f:
            legacy = json.load(f)
            if isinstance(legacy, dict) and legacy:
                _log(f"skiplist: migrating {len(legacy)} entries from "
                     f"scripts/no_options.json → data/options/index.json")
                return dict(legacy)
    except Exception:
        pass
    return {}


def _normalize_files_list(raw):
    """Accept legacy {TICKER: updatedISO} maps or plain ticker lists → sorted list."""
    if isinstance(raw, dict):
        return sorted(str(k) for k in raw.keys() if k)
    if isinstance(raw, list):
        return sorted({str(x) for x in raw if x})
    return []

def save_skiplist(skip):
    """Persist the no-option skiplist into data/options/index.json (sorted for stable diffs).

    Preserves any existing `files` / `count` / `names` fields so a
    skiplist-only update does not wipe the per-ticker manifest. Removes the legacy
    scripts/no_options.json once the new location has been written successfully.
    """
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        doc = _read_index_doc()
        if not isinstance(doc.get("files"), dict):
            doc["files"] = {}
        doc["count"] = int(doc.get("count") or len(doc["files"]))
        # Drop legacy timestamp fields if present (no longer part of the manifest).
        doc.pop("generated", None)
        if isinstance(doc.get("files"), dict):
            doc["files"] = _normalize_files_list(doc.get("files"))
            doc["count"] = len(doc["files"])
        doc["no_options"] = _sorted_no_options(skip)
        with open(INDEX_PATH, "w") as f:
            json.dump(doc, f, indent=2)
            f.write("\n")
        if os.path.exists(LEGACY_SKIP_PATH):
            try:
                os.remove(LEGACY_SKIP_PATH)
                _log("skiplist: removed legacy scripts/no_options.json")
            except Exception as e:
                _log_err(f"skiplist: could not remove legacy scripts/no_options.json: {e}")
    except Exception as e:
        _log_err(f"skiplist: could not write data/options/index.json no_options: {e}")


def _skip_is_active(last_checked):
    """True if a skiplist entry is still within its re-check window (skip it)."""
    try:
        d = datetime.strptime(str(last_checked)[:10], "%Y-%m-%d").date()
    except Exception:
        return False
    age = (_today() - d).days
    return age < SKIP_RECHECK_DAYS


# ---- Main loop --------------------------------------------------------------

def _cached_symbols():
    """Set of ticker symbols that already have a data/options/{SYMBOL}.json file."""
    return {
        f[:-5] for f in os.listdir(DATA_DIR)
        if f.endswith(".json") and f != "index.json"
    }


def build_work_queue(universe):
    """
    Build the ordered list of symbols to fetch this run, in TWO PHASES:

      PHASE 1 — COVERAGE (missing first): every universe symbol WITHOUT a cached
        file yet, kept in universe order. When NASDAQ works this is market-cap
        order (Mega -> Micro); when NASDAQ is blocked it is the broad Cboe
        optionable-underlying order seeded by the mega-cap fallback list. This
        makes the run RESUME DOWN the list where prior runs stopped, so we work
        toward caching ALL tickers instead of re-looping the top-cap names.

      PHASE 2 — REFRESH (oldest first): only reached once nothing is missing.
        EXISTING files that are STALE per the working-day rules, ordered by their
        stored `updated` ASCENDING (oldest data first) so refreshes rotate evenly
        across the whole cache rather than always hitting the biggest names.

    Files that are still FRESH today are excluded from BOTH phases (skipped).
    Symbols on the active "no options" skiplist are also excluded (see
    load_skiplist / SKIP_RECHECK_DAYS) so we don't keep retrying dead tickers.
    Returns (queue, n_missing, n_stale, n_fresh_skipped).
    """
    cached = _cached_symbols()
    skip = load_skiplist()

    def blocked(sym):
        return sym in skip and _skip_is_active(skip[sym])

    # PHASE 1: missing universe symbols, in the order returned by load_universe.
    # Exclude ones we already know have no options (within the re-check window).
    missing = [s for s in universe if s not in cached and not blocked(s)]

    # PHASE 2: existing files that are stale (need refresh), oldest-updated first.
    #  We consider ALL cached files on disk (even ones no longer in the universe)
    #  so nothing goes permanently stale. Fresh files are skipped entirely.
    is_explicit = bool(os.environ.get("TICKERS") or os.environ.get("TICKER"))
    refresh_candidates = universe if is_explicit else cached
    
    stale = []
    fresh_skipped = 0
    for sym in refresh_candidates:
        path = os.path.join(DATA_DIR, f"{sym}.json")
        if is_fresh(path):
            fresh_skipped += 1
            continue
        # Don't add to stale if already in missing
        if sym in missing:
            continue
        stale.append((sym, _file_updated(path)))
        
    # Oldest `updated` first ("" sorts first -> unreadable/undated get priority).
    stale.sort(key=lambda t: t[1])
    stale_syms = [s for s, _ in stale]

    # If the user explicitly provided TICKERS/TICKER, do not respect the cache
    # beyond what's requested, so only process `missing + stale_syms` which
    # are already filtered to `universe`
    return missing + stale_syms, len(missing), len(stale_syms), fresh_skipped


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    universe = load_universe()

    queue, n_missing, n_stale, n_fresh = build_work_queue(universe)
    skip = load_skiplist()

    fetched = 0        # NEW fetches performed this run
    consecutive_fail = 0
    updated_files = []  # relative paths we wrote this run (reported at the end)
    no_option_syms = []  # symbols newly added to the skiplist this run

    _log(f"Smart fetch v11: budget={MAX_FETCHES} successful writes, universe={len(universe)}, "
         f"today={_today_iso()}, timezone={MARKET_TZ_NAME}")
    _log(f"queue: {n_missing} missing (coverage) + {n_stale} stale (refresh, "
         f"oldest-first); {n_fresh} fresh skipped; "
         f"{len(skip)} on no-options skiplist; total queued={len(queue)}")
    if n_missing == 0 and n_stale:
        _log("coverage complete — cycling oldest files for refresh")

    for position, sym in enumerate(queue, start=1):
        if fetched >= MAX_FETCHES:
            _log(f"STOP: reached MAX_FETCHES={MAX_FETCHES}; stopping (resume next run)")
            break

        path = os.path.join(DATA_DIR, f"{sym}.json")
        phase = "coverage" if position <= n_missing else "refresh"
        started = time.monotonic()
        _log(f"FETCH [{position}/{len(queue)}] {phase} {sym}: fetching option chain "
             f"(writes={fetched}/{MAX_FETCHES}, file=data/options/{sym}.json)")

        # Fetch (missing OR stale -> overwrite). The queue already excludes fresh
        # files, so no per-item freshness check is needed here. fetch_ticker
        # returns None ONLY when the ticker genuinely has NO option chain; a real
        # network/source error RAISES, so we can tell the two cases apart.
        errored = False
        try:
            payload = fetch_ticker(sym)
        except Exception as e:
            payload = None
            errored = True
            _log_err(f"ERROR [{position}/{len(queue)}] {phase} {sym}: {e}")

        elapsed = time.monotonic() - started
        if payload is None:
            if errored:
                # A source/network failure. A streak likely means we're being
                # rate-limited/blocked — bail out and resume next run. Do NOT
                # skiplist (the ticker might be fine; it was a transient error).
                consecutive_fail += 1
                _log(f"ERROR [{position}/{len(queue)}] {phase} {sym}: fetch failed "
                     f"after {elapsed:.1f}s (fail streak {consecutive_fail}/{RATE_LIMIT_HITS})")
                if consecutive_fail >= RATE_LIMIT_HITS:
                    _log(f"STOP: {RATE_LIMIT_HITS} consecutive errors — assuming "
                         f"rate-limited/blocked; will resume next run")
                    break
            else:
                # Genuinely no options: remember it so we don't refetch every run
                # (re-checked after SKIP_RECHECK_DAYS). Reset the error streak —
                # this is a normal, expected outcome, not a block.
                consecutive_fail = 0
                skip[sym] = _today_iso()
                no_option_syms.append(sym)
                _log(f"NO_OPTIONS [{position}/{len(queue)}] {phase} {sym}: checked in "
                     f"{elapsed:.1f}s; added to skiplist "
                     f"(re-check in {SKIP_RECHECK_DAYS}d)")
            continue

        consecutive_fail = 0
        # A ticker that used to be optionless now has data: drop it from skiplist.
        skip.pop(sym, None)
        with open(path, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        fetched += 1
        updated_files.append(os.path.relpath(path, os.path.dirname(DATA_DIR)))
        # _log(f"SLEEP {sym}: waiting REQUEST_SLEEP={REQUEST_SLEEP}s before next symbol")
        time.sleep(REQUEST_SLEEP)  # be polite to the data source

    _log(f"skiplist: saving {len(skip)} entries to data/options/index.json (no_options)")
    # write_index owns the single data/options/index.json write (files + names + no_options).
    # save_skiplist is kept as a thin helper for migration / standalone use, but
    # the normal end-of-run path goes through write_index so we never double-write
    # or race the two sections of the manifest against each other.
    _log("index: rebuilding data/options/index.json manifest if files/names/skiplist changed")
    index_changed = write_index(skip)
    if index_changed and os.path.exists(LEGACY_SKIP_PATH):
        try:
            os.remove(LEGACY_SKIP_PATH)
            _log("skiplist: removed legacy scripts/no_options.json")
        except Exception as e:
            _log_err(f"skiplist: could not remove legacy scripts/no_options.json: {e}")
    if index_changed:
        updated_files.append(os.path.relpath(
            os.path.join(DATA_DIR, "index.json"), os.path.dirname(DATA_DIR)))
        _log("index: wrote data/options/index.json")
    else:
        _log("index: unchanged; data/options/index.json was not rewritten")

    total = len(_cached_symbols())
    _log(f"DONE RUN: writes={fetched}, missing_left_estimate={max(0, n_missing - fetched)}, "
         f"no_options_added={len(no_option_syms)}, total_cached={total}")

    # ---- Report EXACTLY which files changed (so you know what to copy/replace) --
    print("\n=== UPDATED FILES (copy & replace these) ===", flush=True)
    if updated_files:
        for p in updated_files:
            print(f"  * {p}", flush=True)
        print(f"  ({len(updated_files)} file(s) written this run)", flush=True)
    else:
        print("  (none — everything was already fresh / skiplisted)", flush=True)



def write_index(skip=None):
    """
    Rebuild data/options/index.json as a ticker manifest from the files on disk.
    Shape (v13): { "files": [TICKER, ...], "count": N,
                   "names": { TICKER: "Company Name", ... },
                   "no_options": { TICKER: "YYYY-MM-DD", ... } }.

    No per-ticker timestamps and no global `generated` — those only produced
    git commits when a scheduled run refreshed nothing. Freshness for the
    fetcher uses each data/options/{TICKER}.json filesystem mtime (ordering) and the
    optional in-file `updated` field (weekend dead-zone rule in is_fresh).

    The no-options skiplist is stored on the same document (v9); pass `skip` to
    write the in-memory skiplist, otherwise the existing `no_options` field on
    disk is preserved. v10 also stores optional display names.

    To avoid churn, the file is only REWRITTEN when the ticker set, name map, or
    skiplist actually changed (or when migrating off the legacy timestamp shape).
    Returns True if index.json was (re)written this call, else False.
    """
    files = sorted(_cached_symbols())

    prev = _read_index_doc()
    if skip is None:
        raw = prev.get("no_options") if isinstance(prev, dict) else {}
        no_options = _sorted_no_options(raw) if isinstance(raw, dict) else {}
    else:
        no_options = _sorted_no_options(skip)

    prev_names_raw = prev.get("names") if isinstance(prev, dict) else {}
    prev_names = prev_names_raw if isinstance(prev_names_raw, dict) else {}
    wanted_name_symbols = set(files) | set(no_options.keys())
    names = {}
    for sym in sorted(wanted_name_symbols):
        # Prefer names discovered in THIS run; fall back to the previous manifest
        # so a no-op/offline run does not drop useful metadata.
        name = _clean_company_name(SYMBOL_NAMES.get(sym) or prev_names.get(sym))
        if name:
            names[sym] = name

    prev_files = _normalize_files_list(prev.get("files") if isinstance(prev, dict) else None)
    prev_names_sorted = dict(sorted(prev_names.items())) if isinstance(prev_names, dict) else {}
    prev_skip = _sorted_no_options(prev.get("no_options") or {}) if isinstance(prev, dict) else {}
    legacy = isinstance(prev, dict) and (
        "generated" in prev or isinstance(prev.get("files"), dict)
    )

    if (prev_files == files
            and prev_names_sorted == names
            and prev_skip == no_options
            and not legacy):
        return False

    payload = {
        "files": files,
        "count": len(files),
        "names": names,
        "no_options": no_options,
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(INDEX_PATH, "w") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
    return True


if __name__ == "__main__":
    main()
