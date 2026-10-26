# Automations

Everything that runs by itself or with one command: the GitHub Actions workflows, the data fetcher, the archive and backup scripts, the local run commands and the tests. Back to the [README](../README.md)

TradingView futures and live mode: see [PR #202](https://github.com/daggerok/gex/pull/202) (section added when it merges). The `tv:*` scripts of that branch run only on your computer with your session file `~/.config/gex/tradingview.env`, never in GitHub Actions (CI has no session)

## Contents

- [Workflows at a glance](#workflows-at-a-glance)
- [CI (`ci.yaml`)](#ci-ciyaml)
- [GitHub Pages (`github-pages.yml`)](#github-pages-github-pagesyml)
- [Update partial options data (`update-partial-data.yml`)](#update-partial-options-data-update-partial-datayml)
- [Update options data (`update-data.yml`)](#update-options-data-update-datayml)
- [Backtest backup (`backtest-backup.yml`)](#backtest-backup-backtest-backupyml)
- [Dependency Updates and npm-check-updates](#dependency-updates-and-npm-check-updates)
- [The data fetcher `scripts/options-data.ts`](#the-data-fetcher-scriptsoptions-datats)
- [Archive and backups (`api/history`)](#archive-and-backups-apihistory)
- [Data sizes and the Pages limit](#data-sizes-and-the-pages-limit)
- [Local run commands](#local-run-commands)
- [Tests](#tests)

## Workflows at a glance

Times are New York time (ET). Durations are wall-clock times of the last runs (`gh run list --workflow <file> --limit 10`, measured 2026-10-26)

| Workflow | Trigger | What it does | Commits | Deploys | Typical duration |
|---|---|---|---|---|---|
| `ci.yaml` (CI) | every pull request to `main`, manual | unit tests, fetcher bundle, both builds (job `build`), browser tests (job `e2e`) | nothing | nothing | 2.5 to 3.5 min |
| `github-pages.yml` (GitHub Pages) | every push to `main` except archive-only pushes, manual, started by `update-data.yml` and `dependency-updates.yml` | refreshes the 27 default tickers, builds with `/gex/`, deploys `dist/` | nothing | yes | 1 to 2 min |
| `update-partial-data.yml` (Update partial options data) | Mon-Fri 8:45, 9:45 ... 16:45 and 17:15, 18:15, 19:15 ET; manual | refreshes the 27 default tickers, builds and deploys the site itself | only the day zip and `api/latest.json` (final runs from 16:30 ET), a backtest backup when `BACKTEST_TICKERS` is set | yes (own `deploy` job) | 1 to 1.5 min, 8 s when the window guard skips |
| `update-data.yml` (Update options data) | Saturday 10:00 ET; manual | the default list plus `api/All.txt`, 500 stale other files (`ROTATE_STALE`), then `api/Indices.txt` | `api/` (options, charts, index) | starts `github-pages.yml` when it pushed | 9 to 14 min |
| `backtest-backup.yml` (Backtest backup) | manual only | optional fresh fetch, then one backup zip | the zip and `api/history/index.json` | no (archive-only pushes are not deployed) | not run yet |
| `dependency-updates.yml` (Dependency Updates) | manual only | `npm-check-updates -u`, install, tests, both builds, push to the branch | `package.json`, `bun.lock` | starts `github-pages.yml` when it pushed | not run yet |
| `npm-check-updates.yml` | manual only | the same bump as a dry check, nothing is pushed | nothing | nothing | not run yet |

Common to all: `ubuntu-latest`, Bun pinned to `1.4.x` (`oven-sh/setup-bun@v2`) so a new Bun release cannot break the unattended data runs. The three data workflows share the concurrency group `data-refresh` (a run waits for the other, none is cancelled); the two deploys share the group `pages`

### Schedules are best effort

GitHub drops many scheduled runs and starts others late. Observed in October 2026: the hourly workflow fired 2 or 3 of its 9 weekday slots, 40 minutes to almost 3 hours late (runs at 13:25, 16:37 and 19:28 ET on 2026-10-23), and the weekly run started at 12:50 and 13:12 ET instead of 10:00. That is why every run from 16:30 to 23:59 ET counts as final (the day archive is idempotent) and there are three after-close slots. The cron lines carry `timezone: America/New_York`, so daylight saving time needs no extra UTC slots

## CI (`ci.yaml`)

- **Trigger:** `pull_request` to `main` and `workflow_dispatch`. Pushes to `main` are not tested here, `github-pages.yml` builds them. Concurrency `ci-<ref>` cancels an older run of the same PR
- **Checkout:** the PR head commit (not GitHub's synthetic merge commit), depth 2
- **Job `build`:** `bun install -E` (Bun cache keyed by `package.json`), `bun run test` (unit tests, a failure stops the pipeline), `bun build --target=bun scripts/options-data.ts --outfile=/dev/null` (the fetcher still bundles), `bun run build`, `bun run build-github-pages`
- **Job `e2e`:** `bunx playwright install --with-deps chromium`, then `bun run test:e2e` (the app is built once, the browser checks run 4 at a time, see [Tests](#tests))
- **Permissions:** `contents: read`, no secrets
- **When it fails:** open the failed job; an e2e failure prints the output of the failing check only, rerun it locally with `bun run test:e2e <part of its file name>`. Two of the last ten runs failed (fixed in the PR, not flaky infrastructure)

## GitHub Pages (`github-pages.yml`)

- **Trigger:** push to `main`, except a push that only touches `api/history/**` or `api/latest.json` (archive zips and backups reach the site with the next deploy); `workflow_dispatch`; started by `update-data.yml` and `dependency-updates.yml` through the API, because a push made with `GITHUB_TOKEN` starts no other workflow
- **Steps:** checkout `main` (always the branch tip, so a deploy requested by a data run builds the data that run pushed), setup Bun, **Refresh the default tickers** (`bun scripts/options-data.ts` with `MAX_EXPIRATIONS=15 KEEP_EXPIRATIONS=1 CONCURRENCY=4 REQUEST_SLEEP=0.1`, `continue-on-error: true`), `bun install -E`, `bun run build-github-pages`, `actions/configure-pages`, `actions/upload-pages-artifact` of `./dist`, `actions/deploy-pages`
- **Why the refresh:** the hourly data is never committed, so the committed default-ticker files are older than the live site. Refreshing before every build means a code deploy never publishes older data than the last hourly run. A rate limit or Yahoo outage only fails that step, the committed files are deployed instead
- **Permissions:** `contents: read`, `pages: write`, `id-token: write`. Concurrency group `pages`, shared with the deploy job of `update-partial-data.yml`
- **When it fails:** the build or deploy step is the problem (the refresh step cannot fail the run). Rerun from the Actions tab or `gh workflow run github-pages.yml -R daggerok/gex`

## Update partial options data (`update-partial-data.yml`)

The hourly refresh of the default tickers during the trading day

- **Schedule:** `45 8-16 * * 1-5` and `15 17-19 * * 1-5` in `America/New_York`: 8:45 (before the open), 9:45 ... 16:45, then 17:15, 18:15, 19:15 after the close, 12 slots Monday to Friday. Market holidays are not skipped, a holiday run refreshes the last prices
- **Market window guard (first step):** a scheduled run that starts before 8:40 ET is skipped (`run=false`, the whole job takes about 8 s). There is no upper bound before midnight; a run GitHub starts after midnight is already the next day (or Saturday) and is skipped by the same check. A manual run always runs
- **Final run:** any run that starts at 16:30 ET or later (`final=true`). Several final runs a day are fine
- **Env:** `MAX_EXPIRATIONS=15` and `KEEP_EXPIRATIONS=1` (they only matter for tickers outside the default list; the defaults keep their expirations by rule, see [Default tickers and their expirations](#default-tickers-and-their-expirations)), `CONCURRENCY=4`, `REQUEST_SLEEP=0.1`, and in the fetch step `HISTORY=1` only on a final run, `HISTORY_KEEP_DAYS` and `HISTORY_KEEP_BACKUP_DAYS` from the repository variables of the same names (default 14)
- **Steps of job `update`:** window guard, checkout (depth 2), setup Bun, `bun scripts/options-data.ts` (no `TICKERS`: only the 27 defaults), an optional **Backtest backup** when the repository variable `BACKTEST_TICKERS` is set (`all` or a list such as `SPY NDX`, off by default: a backup of everything every hour adds tens of MB), `bun install -E && bun run build-github-pages`, upload the Pages artifact, **Commit the archive**
- **What is committed:** never the refreshed `api/options` and `api/charts` files (owner's decision: about 23 MB of JSON an hour would bloat git). Staged are `api/history` (the day zip and its index on a final run, a backup when one was made) and on a final run `api/latest.json`. Message `chore(data): archive the trading day [skip ci]`. When `main` moved during the run (a merge, the weekly refresh), the commit is replayed on the new tip with `git cherry-pick -X theirs`, up to 3 attempts 5 s apart
- **Job `deploy`:** runs when `update` decided to run and was not cancelled (also when the commit step failed, the site was already built), deploys the artifact with `actions/deploy-pages`, concurrency group `pages`
- **Duration:** about 30 s of fetching (27 tickers, every rule expiration, measured 2026-10-25), 1 to 1.5 min for the whole run including the deploy job
- **When it fails:** a fetch step failure means Yahoo or Cboe answered badly for every ticker (single failed tickers only print `failed` and keep their old file, the run stays green). A failed **Commit the archive** after 3 attempts leaves the day without a zip until the next final run of the same day; if none follows, that day has no archive (the sources only give the current chain, a missed day cannot be fetched later). Rerun by hand from 16:30 ET on the same day to get the archive: `gh workflow run update-partial-data.yml -R daggerok/gex`

## Update options data (`update-data.yml`)

The weekly full refresh of everything the published cache holds

- **Schedule:** `0 10 * * 6` in `America/New_York`, Saturday 10:00 ET: the market is closed and the hourly workflow does not run. Also `workflow_dispatch`
- **Job env:** `MAX_FETCHES=500` (writes per step for the fixed list), `MAX_EXPIRATIONS=50` (non-default tickers), `REQUEST_SLEEP=0.5`, and for a manual `all` run only `UNIVERSE_SIZE=5000`, `MIN_MARKET_CAP=9000000` (the workflow never passes `all`, so those two are unused)
- **Step 1, Fetch option chains:** `TICKERS=$(cat api/All.txt) ROTATE_STALE=500 bun scripts/options-data.ts`. The universe is the 27 defaults plus the tickers of `api/All.txt` (356 lines, 332 new after the aliases and duplicates, 359 symbols). Then the stale cache rotation (PR #216): the 500 cached tickers outside that list with the oldest `updated` stamp, with their own budget of 500 writes on top of `MAX_FETCHES`. The Cboe cash indices (SPX, XSP, NDX, RUT, DJX, VIX, OEX, VXN) are never picked by the rotation. With about 2,700 other cached files, every file is refreshed within about 6 weeks; until then a file keeps the data of the run that last wrote it (its `updated` field says when)
- **Step 2, Fetch index option chains:** `TICKERS=$(cat api/Indices.txt) MAX_EXPIRATIONS=15 MAX_FETCHES=10`. `api/Indices.txt` is SPX, XSP, NDX, DJX, RUT. SPX, NDX, DJX and RUT are also default tickers: step 1 already wrote them with the expiration rule (which ignores `MAX_EXPIRATIONS`), and on a Saturday they are still fresh here and skipped, so this step effectively refreshes XSP with 15 expirations. On a manual weekday run nothing is fresh, so it fetches all five again
- **Step 3, Commit updated data:** `git add api/`, commit `chore(data): refresh option chains [skip ci]`, push once. A failed push only prints a message (no retry), the run stays green
- **Step 4, Deploy the site:** only when step 3 pushed, `gh workflow run github-pages.yml`
- **Duration:** 9 to 14 min (6 runs so far)
- **When it fails:** a stopped run prints `[ stop     ] 3 consecutive errors, assuming rate-limited or blocked` (Yahoo or Cboe blocked the runner); what was written before the stop is committed. Rerun later by hand. A push that lost a race with another commit is lost too: rerun the workflow (fresh files are skipped only inside the weekend window, see [Freshness](#freshness-which-files-a-run-skips))

## Backtest backup (`backtest-backup.yml`)

- **Trigger:** `workflow_dispatch` only, inputs `tickers` (space or comma separated; empty = the preset, the 27 default tickers; `all` = every file of `api/options`) and `refresh` (fetch fresh data first; refused together with `all`, that would be the whole universe)
- **Steps:** input check, checkout, setup Bun, with `refresh` `bun scripts/options-data.ts` (with `TICKERS` = the input, or no `TICKERS` for the preset), `bun scripts/backtest-backup.ts $BACKUP_TICKERS | tee -a $GITHUB_STEP_SUMMARY` (with `pipefail`), commit `chore(data): backtest backup [skip ci]` and push with up to 3 rebase retries (`git rebase -X theirs`)
- **Result:** `api/history/<YYYY-MM>/<YYYY-MM-DD-HH-mm>.zip` (ET, to the minute, never overwritten; a taken minute moves forward) and `api/history/index.json`. Not deployed by itself (archive-only push), it reaches the site with the next deploy
- **Timeout:** 30 min. **Concurrency:** `data-refresh`
- **When it fails:** `not a ticker name` or `no file in api/options for: X` means a wrong input (nothing is written); fix the input and run again

## Dependency Updates and npm-check-updates

- **`dependency-updates.yml`:** manual, inputs `target_branch` (default `main`) and `commit_message` (default `chore(deps): update dependencies`). Runs `bunx npm-check-updates -u`, `bun install -E`, `bun run test`, `bun run build`, `bun run build-github-pages`; when anything changed, commits `package.json` and `bun.lock` and pushes straight to the target branch (a failed push only prints a message), then starts `github-pages.yml` for that branch. It does not run the browser tests
- **`npm-check-updates.yml`:** manual, the same bump followed by `bun install` (not `-E`), tests, build, `clean`, Pages build; nothing is committed. Use it to see whether the newest versions still pass before running `dependency-updates.yml`

## The data fetcher `scripts/options-data.ts`

One Bun script, no dependencies. It reads Yahoo (cookie and crumb, `v7/finance/options`, `v8/finance/chart`) and overlays the Cboe delayed greeks, open interest and volume (`cdn.cboe.com/api/global/delayed_quotes/options/<SYM>.json`) by OCC symbol. It writes:

| File | What |
|---|---|
| `api/options/<SYM>.json` | the chain of one ticker: `symbol`, `updated` (ISO time with offset), `date` (the trading day the data belongs to), `underlyingPrice`, `greeks` (Cboe overlay stats), `expirations`, `quotes` |
| `api/options/index.json` | `files` (cached tickers), `count`, `names` (company names), `no_options` (tickers checked without listed options, with the check date), `defaults` (the built-in default list). Rewritten only when one of them changed |
| `api/charts/<SYM>.json` | 1 year of daily bars for the Chart tab (`CHART_CACHE`), also for the Yahoo futures `ES=F NQ=F YM=F RTY=F MES=F MNQ=F MYM=F M2K=F` on every run (PR #214, candles only) |
| `api/latest.json` | `{ "version": 1, "date": "<trading day>" }`, the newest data day, written when any chain was written |
| `api/history/<YYYY-MM>/<day>.zip` and `api/history/index.json` | the day archive, only with `HISTORY=1` |

The run prints a `[ config   ]` block with every setting, `[ universe ]`, `[ queue    ]` (and `[ rotate   ]`), one line per ticker (`new`, `updated`, `unchanged`, `no-options`, `failed`), `[ done     ]`, the chart pass and the list of written files. New tickers are appended to `$GITHUB_STEP_SUMMARY` in CI. Every file is written atomically (`<file>.tmp`, then rename). The process exits with 1 only on an unexpected error; failed tickers keep their old file and do not fail the run

### What a run covers

- **Universe:** the default list (`DEFAULT_SYMBOLS`, or `DEFAULT_TICKERS` when set), then `TICKERS` added on top (never replacing the defaults). With the argument `all` the discovered universe follows: the NASDAQ screener by market cap merged with the Cboe optionable list (else Cboe alone, else a tiny built-in list), `UNIVERSE_SIZE` symbols, `MIN_MARKET_CAP` floor. Any other argument is an error
- **Queue:** SPY, SPX, QQQ, NDX first (unless fresh; with a fixed list only those in it), then missing files (universe order), then stale files oldest `updated` first, then with `ROTATE_STALE=N` the N rotation picks. Tickers on the no-options skiplist without a cached file are not retried for `SKIP_RECHECK_DAYS`, also when a fixed list (`TICKERS`) names them
- **Stops:** at `MAX_FETCHES` written files (plus N for the rotation), after `RATE_LIMIT_HITS` consecutive failures (the chart pass is then skipped too), or after `SOFT_DEADLINE_SECONDS`
- **Per ticker:** the expirations (by rule for a default ticker, else the nearest `MAX_EXPIRATIONS`), one Yahoo request per expiration, the spot from the last daily close, the Cboe overlay. A rate limit, an HTTP error (except 404), a timeout or a non-JSON answer fails the whole ticker (its old file stays); only an answer of the wrong shape skips one expiration. "No options" is recorded only when the chain is really empty
- **Chart pass:** after the options pass, priority symbols and the 8 futures first, then tickers without a chart file, then stale ones oldest first, at most `CHART_MAX_FETCHES`. With a fixed list (every workflow run) the list itself, then the `ROTATE_STALE` picks whose chain the run wrote, with their own budget on top of `CHART_MAX_FETCHES` (t20, same file format and pacing), so within the ~6 week rotation cycle every cached ticker gets candles. A `failed no chart data` line (Yahoo answered 404 or an empty body, often a delisted ticker) does not count toward `RATE_LIMIT_HITS`, only HTTP errors, timeouts and rate limits stop the pass

### Default tickers and their expirations

The 27 defaults, written once in `DEFAULT_SYMBOLS` and published as `defaults` in `api/options/index.json` (the app's ticker hint and backup preset read it there):

`SPX NDX DJX RUT IWM SPY QQQ DIA NVDA AAPL MSFT AMZN GOOGL TSM GOOG META AVGO LLY MU WMT AMD JPM V BRK-B XOM ASML JNJ`

A default ticker keeps its expirations by rule (`selectDefaultExpirations`, PR #196), not by `MAX_EXPIRATIONS`:

1. every listed expiration up to 42 calendar days out (the dailies)
2. weeklies up to 92 days: Fridays, or the Thursday before a Friday holiday
3. monthlies (the 3rd Friday, the Thursday before it when that Friday is a holiday) and quarter-ends (the last business day of March, June, September, December) up to 366 days
4. no LEAPS beyond a year

That is about 40 expirations for SPX, 20 for SPY and QQQ, 10 to 17 for a stock. `KEEP_EXPIRATIONS=1` never keeps for a default what the rule drops. `EXPIRATION_RULE=0` gives the defaults `MAX_EXPIRATIONS` too (a quick local run). The holiday calendar (`US_MARKET_HOLIDAYS`) covers 2025 to 2028 and must be extended for later years

### Freshness: which files a run skips

A file counts as fresh only inside the weekend window: from Friday 20:00 to Sunday 18:00 ET, a file written after Friday 20:00 is fresh and skipped (`isFreshAt`). Every other time every file is stale. In practice the Saturday weekly run does not refetch what an earlier step or a rerun that weekend already wrote, and every weekday run fetches everything it queues

### Environment variables and arguments

| Variable | Default | Meaning |
|---|---|---|
| argument `all` | off | append the discovered auto-universe after the defaults and `TICKERS`; any other argument is an error |
| `DEFAULT_TICKERS` | built-in list | replaces the default list for this run (space or comma separated); blank keeps the built-in list. `index.json` `defaults` always holds the built-in list |
| `TICKERS` (or `TICKER`) | none | tickers added on top of the default list |
| `MAX_FETCHES` | 500 | successful writes per run (the rotation brings its own budget) |
| `MAX_EXPIRATIONS` | 12 | expirations per non-default ticker (the nearest ones) |
| `EXPIRATION_RULE` | 1 | 0 = the defaults use `MAX_EXPIRATIONS` too |
| `KEEP_EXPIRATIONS` | 0 | 1 = keep the later expirations already in the file; they get the Cboe overlay (greeks, OI, volume) but keep their old bid, ask, last and IV |
| `ROTATE_STALE` | 0 | with a fixed list: also refresh the N oldest other cached tickers, own budget of N writes; off with `all` |
| `DRY_RUN` | 0 | 1 = print the work queue with its phases (priority, coverage, refresh, rotate) and stop; nothing is fetched or written |
| `CONCURRENCY` | 1 | parallel ticker workers (integer >= 1) |
| `REQUEST_SLEEP` | 0.6 | seconds each worker waits after a written file |
| `RATE_LIMIT_HITS` | 3 | consecutive failures that stop the run |
| `SOFT_DEADLINE_SECONDS` | 0 | stop starting new tickers after this many seconds (0 = off) |
| `SKIP_RECHECK_DAYS` | 30 | days before a no-options ticker is tried again |
| `CBOE_GREEKS` | 1 | 0 = no Cboe overlay |
| `CBOE_GREEKS_TIMEOUT` | 10 | seconds per Cboe request |
| `CBOE_MIN_INTERVAL` | 1 | minimum seconds between Cboe requests, shared by all workers |
| `CBOE_BACKOFF` | 30 | first pause after a Cboe 429 (doubles per retry, every worker waits) |
| `CBOE_RETRIES` | 3 | retries after a 429; then the ticker fails and keeps its old file |
| `CHART_CACHE` | 1 | 0 = no chart pass |
| `CHART_MAX_FETCHES` | 500 | chart files written per run; the rotation picks bring their own budget on top |
| `HISTORY` | 0 | 1 = write the default tickers into the day zip and rotate old zips |
| `HISTORY_KEEP_DAYS` | 14 | daily zips older than this many days are deleted (0 = keep all) |
| `HISTORY_KEEP_BACKUP_DAYS` | 14 | the same for backups (by the date in their name) |
| `UNIVERSE_SIZE` | 6000 | `all` only: symbols considered |
| `MIN_MARKET_CAP` | 9000000 | `all` only: USD floor for the NASDAQ screener rows |
| `NASDAQ_TIMEOUT` | 20 | `all` only: seconds before the NASDAQ screener counts as failed |
| `SYMBOL_ALIASES` | none | extra `SCREENER=YAHOO` pairs, comma separated (built in: `BRK.B`, `BRKB` -> `BRK-B` and a few more) |
| `TIMEZONE` | `America/New_York` | market time zone for "today", the trading day and freshness |
| `VERBOSE` | off | also print the old timestamped progress lines |

### Build your own cache locally

```bash
bun install -E
DRY_RUN=1 ./scripts/options-data.ts                     # see what would be fetched, writes nothing
./scripts/options-data.ts                               # the 27 default tickers, one at a time
CONCURRENCY=4 REQUEST_SLEEP=0.1 ./scripts/options-data.ts   # the same, like the hourly workflow
TICKERS="PLTR HOOD" ./scripts/options-data.ts           # the defaults plus these
DEFAULT_TICKERS="SPY" TICKERS= ./scripts/options-data.ts    # only SPY
EXPIRATION_RULE=0 MAX_EXPIRATIONS=5 ./scripts/options-data.ts   # quick: 5 expirations per ticker
./scripts/options-data.ts all                           # everything (hours, rate limits likely)
bun run app                                             # the app reads your fresh api/
```

Then open the app and choose Settings -> Data source -> Advanced -> **Always cache** if a local proxy is running, otherwise the app uses the cache by itself. The fetcher changes tracked files in `api/`: discard them before committing (`git checkout -- api`), the workflows publish the cache

## Archive and backups (`api/history`)

- **Day archive:** a final hourly run (`HISTORY=1`) writes the files of the default tickers into `api/history/<YYYY-MM>/<YYYY-MM-DD>.zip` (entries `<day>/<SYM>.json` plus `<day>/manifest.json`), the last state of that trading day. A ticker whose new file differs from its zip entry only in the `updated` stamp keeps the entry, so a later final run with unchanged data commits nothing. A damaged day zip is started afresh (the old one stays in git history) and the run goes on
- **Backups:** `bun run backtest:backup` (no arguments = the 27 defaults, a default without a file is left out; `all` = every file; `SPY NDX` = only those, a ticker without a file is an error). A byte-for-byte copy into `api/history/<YYYY-MM>/<YYYY-MM-DD-HH-mm>.zip`, never overwritten
- **Rotation:** on every final run, daily zips older than `HISTORY_KEEP_DAYS` (14) calendar days and backups older than `HISTORY_KEEP_BACKUP_DAYS` (14) are deleted, an emptied month folder too; `0` keeps forever. The repository variables of the same names override the 14
- **Index:** `api/history/index.json` lists every snapshot on disk and its tickers; it follows the disk, so cleaning up is deleting a zip or a month folder and committing
- **In the app:** the "As of" selector lists them; see [Usage](usage.md#backtest-as-of)

## Data sizes and the Pages limit

Measured on `main` 2026-10-26:

| Part | Size |
|---|---|
| `api/options` (3,060 ticker files) | 212 MB |
| `api/charts` (792 files) | 9.3 MB on disk, 8.6 MB of JSON, about 10.8 KB a file (one year of daily bars) |
| `api/history` (6 day zips) | 18 MB, 2.9 to 3.4 MB a day |
| `api/` in total | 240 MB |
| one chain file | 0.1 to 3 MB (SPY 2.7 MB, SPX 1.3 MB in the committed weekly state), about 7 times less zipped |

**Candles for every cached ticker:** since the chart pass covers the rotation, the 2,278 cached tickers without a chart file get one within about 6 weeks: 2,278 x 10.8 KB = about 25 MB more, so `api/charts` ends near 33 MB (3 % of the 1 GB limit). Each weekly run then rewrites about 870 chart files (the list plus 500 rotated), about 9 MB of JSON, which grows the git history (not the site) by a few MB a week. The weekly run gets about 5 minutes longer (500 more chart requests at `REQUEST_SLEEP=0.5`)

The site deploys all of `api/` with the app (`bun run build` copies it to `dist/api`). GitHub Pages publishes at most 1 GB per site, so about 750 MB are left. Watch the daily zips (about 3.4 MB a day with the 27 defaults, kept 14 days, so about 50 MB) and especially `BACKTEST_TICKERS=all` (tens of MB per hour, rotated after 14 days): with hourly backups of everything the limit is reached within days

## Local run commands

| Command | What it starts | Ports |
|---|---|---|
| `bun run all` | the app (Parcel dev server) and the local proxy, foreground, Ctrl+C stops both | 1234 and 8787 |
| `bun run app` | only the app (without a proxy it shows the cache) | 1234 |
| `bun run proxy` | only the local proxy | 8787 |
| `bun run start` | `all` in the background under pm2 (process name `app`); `bun run ps`, `logs`, `restart`, `stop` (`pm2 kill`) manage it | 1234 and 8787 |
| `bun run build` | production build to `dist/` plus a copy of `api/` | |
| `bun run build-github-pages` | the same with the `/gex/` public URL | |
| `bun run backtest:backup [TICKERS or all]` | one backup zip, see above | |

**Port pre-check (PR #224):** `app`, `proxy`, `all` and `start` first run `scripts/check-ports.ts`. When a port is taken it prints the port, the pid and command of the holder (`lsof` and `ps`) and a hint, exits with 1 and starts nothing (`all` and `start` check both ports before either starts, so half a stack never runs). `APP_PORT` moves the app (Parcel gets `--port ${APP_PORT:-1234}`), `PORT` moves the proxy; the same port for both is refused. A moved proxy also needs its URL in Settings -> Advanced

**The proxy** (`scripts/options-local-proxy.ts`) listens on `127.0.0.1` only (`HOST=0.0.0.0` opens it to the LAN on purpose; it relays your own Yahoo session and IP) and answers `/health`, `/api/options`, `/api/cboe`, `/api/chart`, `/api/nasdaq`, `/api/search`. **CORS allowlist (PR #207, `scripts/proxy-cors.ts`):** a browser page may use it only when served from `localhost` or `127.0.0.1` (http or https, any port) or from exactly `https://daggerok.github.io`; any other origin gets 403 and no CORS header. Requests without an `Origin` (curl) are served. Only allowed origins get `Access-Control-Allow-Private-Network: true` on Chrome's private network preflight

**How the app finds it (PR #210, #212):** see [Usage: data sources](usage.md#where-the-data-comes-from) and [Configuration](configuration.md#data-source)

## Tests

| Command | What runs | Where |
|---|---|---|
| `bun test` | every `*.test.ts` (unit tests: `src/`, `src/*/`, `scripts/`) | locally and CI job `build` |
| `bun run test:e2e` | every `src/*.e2e.ts` in headless Chromium (Playwright) | locally and CI job `e2e` |
| `bun run test:e2e board` | only the e2e checks whose file name contains `board` | locally |
| `bun build --target=bun scripts/options-data.ts --outfile=/dev/null` | the fetcher still bundles | locally and CI job `build` |

- **e2e runner (`src/e2e-run.ts`):** builds the app once into a temp folder, then runs each check in its own process with its own browser, copy of the build and port (`src/e2e-site.ts` serves it with the SPY and QQQ data), `min(4, CPU count)` at a time (`E2E_JOBS=1` for one at a time). Output of a check is printed when it ends, the exit code is 1 when any failed
- **Helpers:** `noProxy(page)` makes the default proxy port fail so the app uses the cache; `startFakeProxy()` stands in for the local proxy
- **Layout guard:** `src/layout.e2e.ts` checks at three window sizes that no tab scrolls the page, the footer sits at the bottom with no gap above it and looks the same on every tab
- **Setup once:** `bunx playwright install chromium`. Browser checks run with `--mute-audio`
- **Naming:** unit tests `*.test.ts`, browser tests `*.e2e.ts`, never the other way, so `bun test` never starts a browser
