#!/usr/bin/env bash
# Parity check of scripts/options-data.py against scripts/options-data.ts. Temporary: delete this folder
# together with options-data.py once the Python fetcher is retired. See .claude/docs/spec-ts-fetcher.md.
#
#   scripts/options-parity/run.sh live                 py then ts back to back on the real network
#   scripts/options-parity/run.sh record <scenario>    TS run on the real network, responses stored as fixtures
#   scripts/options-parity/run.sh replay <scenario>    TS and py (unmodified, yfinance on top of fixtures) on the same
#                                                      fixtures, then byte compare, request sequence compare, log compare
#   scenarios: explicit universe legacy errors weird
#
# Everything runs on scratch copies of data/options under $WORK (default $TMPDIR/options-parity), the repo data/ is
# never written. Needs bun and uv (yfinance + requests are pulled by `uv run`), or PY=<python with yfinance>.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WORK="${WORK:-${TMPDIR:-/tmp}/options-parity}"
mode="${1:-}"
name="${2:-explicit}"
py() { if [ -n "${PY:-}" ]; then "$PY" "$@"; else uv run --quiet --with yfinance --with requests python "$@"; fi; }

scenario_env() {
  case "$1" in
    explicit) export TICKERS="SPY AAPL BRK-B SPX QQQ ZZZZNOPE" MAX_FETCHES=10 MAX_EXPIRATIONS=15 REQUEST_SLEEP=0 ;;
    universe) export UNIVERSE_SIZE=12 MAX_FETCHES=5 MAX_EXPIRATIONS=6 REQUEST_SLEEP=0 REMOVE="NVDA MSFT AAPL" ;;
    legacy) export UNIVERSE_SIZE=5 MAX_FETCHES=6 MAX_EXPIRATIONS=4 REQUEST_SLEEP=0 SETUP="$HERE/setup-legacy.ts" ;;
    errors) export TICKERS="ERRD ERRA ERRB ERRC SPY" MAX_FETCHES=5 MAX_EXPIRATIONS=3 REQUEST_SLEEP=0 ;;
    weird) export TICKERS="WEIRDA WEIRDB" MAX_FETCHES=5 MAX_EXPIRATIONS=15 REQUEST_SLEEP=0 ;;
    *) echo "unknown scenario $1"; exit 2 ;;
  esac
}

seed() { # seed <dir>: scratch copy of the scripts and of data/options
  local d="$1"
  rm -rf "$d"
  for k in ts py; do
    mkdir -p "$d/$k/scripts" "$d/$k/data"
    cp -Rp "$REPO/data/options" "$d/$k/data/options"
    for t in ${REMOVE:-}; do rm -f "$d/$k/data/options/$t.json"; done
    cp "$REPO/scripts/options-data.py" "$REPO/scripts/options-data.ts" "$d/$k/scripts/"
    [ -n "${SETUP:-}" ] && bun "$SETUP" "$d/$k"
  done
}

if [ "$mode" = live ]; then
  d="$WORK/live"
  seed "$d"
  export TICKERS="${TICKERS:-SPY AAPL BRK-B SPX QQQ ZZZZNOPE}" MAX_FETCHES="${MAX_FETCHES:-10}" MAX_EXPIRATIONS="${MAX_EXPIRATIONS:-15}" REQUEST_SLEEP=0
  (cd "$d/py" && py scripts/options-data.py > "$d/py.log" 2>&1)
  (cd "$d/ts" && bun scripts/options-data.ts > "$d/ts.log" 2>&1)
  bun "$HERE/compare.ts" "$d/py/data/options" "$d/ts/data/options" | grep -v '^EXACT'
  exit "${PIPESTATUS[0]}"
fi

scenario_env "$name"
mkdir -p "$WORK/fixtures"
export FIXTURES="$WORK/fixtures/$name.json"
export SYNTH="$WORK/fixtures/synth.json"
bun "$HERE/make-synth.ts" "$SYNTH"
d="$WORK/run/$name"
seed "$d"

if [ "$mode" = record ]; then
  rm -f "$FIXTURES"
  (cd "$d/ts" && RECORD=1 REQLOG="$d/rec.reqlog" bun --preload "$HERE/net-preload.ts" scripts/options-data.ts > "$d/rec.log" 2>&1)
  echo "recorded $(grep -c . "$d/rec.reqlog") requests into $FIXTURES"
  exit 0
fi

[ "$mode" = replay ] || { echo "usage: run.sh live | record <scenario> | replay <scenario>"; exit 2; }
(cd "$d/ts" && REQLOG="$d/ts.reqlog" bun --preload "$HERE/net-preload.ts" scripts/options-data.ts > "$d/ts.log" 2>&1)
(cd "$d/py" && REQLOG="$d/py.reqlog" py "$HERE/net_harness.py" scripts/options-data.py > "$d/py.log" 2>&1)

echo "== request sequence ($(grep -c TZLOOKUP "$d/py.reqlog") yfinance tz lookups ignored)"
grep -v TZLOOKUP "$d/py.reqlog" > "$d/py.reqlog.f"
if diff "$d/py.reqlog.f" "$d/ts.reqlog" > "$d/reqdiff.txt"; then echo "IDENTICAL ($(grep -c . "$d/ts.reqlog") requests)"; else echo "DIFFERS"; head -20 "$d/reqdiff.txt"; fi

echo "== log lines (timestamps and durations masked)"
for k in py ts; do sed -E 's/^\[[^]]*\] //; s/[0-9]+\.[0-9]+s/Ns/g' "$d/$k.log" > "$d/$k.norm"; done
diff "$d/py.norm" "$d/ts.norm" | head -20

echo "== output files"
bun "$HERE/compare.ts" "$d/py/data/options" "$d/ts/data/options" | grep -v '^EXACT'
