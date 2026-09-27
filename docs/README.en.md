# Options Desk — English Documentation

> **Languages:** English (current) · [Русский](README.ru.md) · root [`README.md`](../README.md)

A single-page **options board**: enter a ticker, get expirations, select one or more dates, and view the classic **Calls | Strike | Puts** chain with bid / mid / ask, IV, volume, open interest and greeks where the provider supplies them. The app is a static React + TypeScript + Tailwind CSS v4 site built by Parcel and deployable to GitHub Pages.

---

*Agentic developer note: This is an Agentic AI-developed project. Agents must always start by reading [AGENT.md](../AGENT.md) as the main entry point and contract. Keep these READMEs synchronized with `src/main.tsx`, `src/index.css`, `scripts/*`, and `.github/workflows/*`. Prefer correcting/removing stale comments over preserving inaccurate ones.*

---

## Agentic Setup

This repository is optimized for AI-agentic development. Core agent files stay in the repository root; extended guides live in [`../docs`](../docs).

- [AGENT.md](../AGENT.md): Main agent contract and rules (EN: [AGENT.en.md](../AGENT.en.md)).
- [CLAUDE.md](../CLAUDE.md): Adapter for Claude Code.
- [.cursorrules](./.cursorrules): Rules for Cursor AI.
- Arena.ai adapter: [English](./ARENA.en.md) or [Russian](./ARENA.ru.md).
- Agentic-setup tutorial: [English](./Setup.en.md) or [Russian](./Setup.ru.md).
- Developer guide: [English](./DEVELOPMENT.en.md) or [Russian](./DEVELOPMENT.ru.md).

We use **Bun** for JavaScript/TypeScript and **uv** for Python. **Important:** Always use `bun` instead of `npm`.

---

## Table of contents

- [What you get](#what-you-get)
- [Quick start](#quick-start)
- [How to use](#how-to-use)
- [Data providers](#data-providers)
- [Ticker suggestions](#ticker-suggestions)
- [Static-cache greeks](#static-cache-greeks)
- [Deploy to GitHub Pages](#deploy-to-github-pages)
- [Proxy setup for GitHub Pages](#proxy-setup-for-github-pages)
- [Companion infrastructure](#companion-infrastructure)
- [Project structure](#project-structure)
- [Privacy & keys](#privacy--keys)
- [Troubleshooting](#troubleshooting)

---

## What you get

- **Two-step, quota-friendly loading:** nothing fetches on page open. Type/search a ticker → **Expirations**; select expiration(s) → **Load**.
- **Ticker suggestions:** searchable ticker/company combobox for every provider. Local static suggestions use `data/options/index.json` names and mark known valid tickers without options as **`(no options)`**.
- **Multiple expirations:** select one, many, or all expirations. Chains render stacked earliest-to-latest with sticky/piled expiration headers.
- **Desk UX:** ATM row highlight, sticky Calls/Strike/Puts headers, greeks columns enabled by default, user-selectable per-side/per-column desk settings, empty cells for missing data, themed scrollbars, collapse/expand controls, and automatic centering on the current strike after load/expand.
- **Theme UX:** compact current-theme icon with an animated dropdown for the other themes.
- **Internationalization (i18n):** English and Russian UI with a language switcher in the header and in Settings.
- **Provider setup badges:** No setup / Free key / Needs proxy, plus onboarding when a token is required.
- **Local browser state:** provider, theme, language, tokens, proxy URL, last ticker, desk columns, and query cache are stored only in `localStorage`.

## Quick start

This project uses **Bun** for installs/scripts and **Parcel** for the React/TypeScript build.

```bash
git clone https://github.com/daggerok/options-desk.git
cd options-desk
bun install -E
bun run serve
```

Open the localhost URL printed by Parcel. Add `?debug=true` to the URL for verbose console logging.

Production build:

```bash
bun run build
```

GitHub Pages build, with the correct `/options-desk/` public URL:

```bash
bun run build-github-pages
```

## How to use

1. Pick a provider in the top-bar **API** dropdown.
2. Type a ticker or company name. Pick a suggestion if useful.
3. Press **Expirations** to fetch expirations and spot metadata.
4. Select one or more expirations, or **All**.
5. Press **Load** to render the chain.

Dropdown order is always **CACHE, CBOE, NASDAQ, YAHOO**. Default selection only: `localhost` / private LAN → **CBOE**; GitHub Pages / hosted static → **CACHE**.

## Data providers

Only four sources. Short uppercase labels in the API dropdown.

| UI label | Setup | Coverage | Greeks | Notes |
|---|---|---|---|---|
| **CACHE** *(default on GitHub Pages)* | No setup | Cached tickers in `data/options/*.json` | CBOE/model-enriched as files refresh | Same-origin static JSON from GitHub Actions/yfinance + CBOE delayed 1st-order greeks. Model/higher-order greeks computed in the browser. No CORS, no keys. |
| **CBOE** *(default on localhost)* | Needs proxy | CBOE delayed options | Yes (provider + client BS higher-order) | Richest delayed feed (greeks/IV/OI/spot). Requires Proxy base URL (`/api/cboe`). |
| **NASDAQ** | Needs proxy | NASDAQ option-chain | No IV → no model greeks | Full chain in one call: bid/ask/last/volume/OI. Proxy `/api/nasdaq`. |
| **YAHOO** | Needs proxy | Yahoo symbol search / option chains | Client Black-Scholes from IV | Lazy per-expiration. Companion proxy handles crumb/cookies (`/api/options`). |

**Dropdown order (always):** `CACHE, CBOE, NASDAQ, YAHOO`.  
**Default selection only:** `localhost` / private LAN → **CBOE**; hosted static (e.g. GitHub Pages) → **CACHE**.

Removed from the live registry (changelog only): marketdata.app, DoltHub, Tradier, Alpaca, Polygon/Massive, Alpha Vantage, and other gated experiments.


## Ticker suggestions

- Static/local suggestions come from `data/options/index.json`:
  - `files` — tickers with cached option chains.
  - `names` — ticker → company/fund/index display name.
  - `no_options` — valid tickers where the latest data scan found no listed options; these show as **`(no options)`**.
- YAHOO, NASDAQ and CBOE suggestions use the companion proxy endpoint `/api/search?provider=...&q=...` for provider-native full-text symbol search.
- Provider search is a discovery helper: some provider-native symbol matches can still return no option chain when loaded; the app then shows the provider's no-data error.

## Static-cache greeks

**Single source of truth for model greeks: the browser** (`src/main.tsx`).

- `scripts/options-data.py` writes yfinance quotes and, when available, **Cboe delayed 1st-order** greeks (`delta`/`gamma`/`theta`/`vega`/`rho`, `greeksSource: "cboe"`).
- It does **not** compute λ / Vanna / Vomma / Charm / Speed / Zomma / Color or full Black-Scholes fallback — that would duplicate the UI.
- After any provider fetch (including **CACHE**), the app runs client-side Black-Scholes enrichment: fills missing 1st-order when IV+spot allow, and always fills higher-order when possible.
- Remaining gaps use `greeksMissingReason` (from fetcher or client).


## Deploy to GitHub Pages

1. Enable Pages in repo **Settings → Pages**.
2. Allow Actions to commit: **Settings → Actions → General → Workflow permissions → Read and write permissions**.
3. The scheduled **Update options data** workflow runs `scripts/options-data.py`, self-discovers an optionable universe, refreshes/grows `data/options/*.json`, updates `data/options/index.json`, and commits changes back to `master`.
4. The **GitHub Pages** workflow builds the app with `bun run build-github-pages` and deploys `dist/`.

You do **not** need to maintain a ticker list. For a one-off/manual data run, set `TICKERS="AAPL MSFT SPY"` when running `scripts/options-data.py`; the default scheduled workflow uses self-discovery.

## Proxy setup for GitHub Pages

**Important:** When using GitHub Pages (or any static host), proxy-backed providers (Yahoo, NASDAQ, CBOE) require a **locally running proxy** because the browser cannot directly access these APIs due to CORS restrictions.

### How it works

1. Your browser loads the app from GitHub Pages (e.g., `https://daggerok.github.io/options-desk/`)
2. When you select a proxy-backed provider, the app sends requests to the **Proxy base URL** (default: `http://localhost:8787`)
3. The proxy (running on your local machine) forwards requests to Yahoo/NASDAQ/CBOE and returns the response
4. This works because your browser can access `localhost` even when the page is served from GitHub Pages

### Running the local proxy

```bash
# Clone the repo (if not already done)
git clone https://github.com/daggerok/options-desk.git
cd options-desk

# Install dependencies
bun install -E

# Run the proxy server
bun ./scripts/options-local-proxy.ts
```

The proxy will start on `http://localhost:8787` by default.

### Configuring the app

1. Open the app in your browser
2. Click the **gear icon** (Settings) in the top-right corner
3. Find the **Proxy base URL** field
4. Set it to `http://localhost:8787` (or your custom port)
5. Now you can use Yahoo, NASDAQ, and CBOE providers

### Alternative: Cloudflare Worker

For a deployable proxy that doesn't require local setup:

1. Deploy `scripts/options-cloudflare-proxy.js` to Cloudflare Workers
2. Set the **Proxy base URL** to your Worker URL (e.g., `https://your-worker.your-subdomain.workers.dev`)

### Troubleshooting proxy issues

- **"Could not reach the proxy"**: Make sure the proxy is running (`bun ./scripts/options-local-proxy.ts`)
- **CORS errors**: The proxy must be running on `localhost` or deployed as a Cloudflare Worker
- **Port conflicts**: Change the port in `scripts/options-local-proxy.ts` or use the `PORT` environment variable

## Companion infrastructure

These files are optional infrastructure outside the core app source:

- `scripts/options-data.py` — smart yfinance fetcher. Builds/refreshes `data/options/*.json`, attaches Cboe delayed **1st-order** greeks only (model greeks are UI-only), and maintains `data/options/index.json` with `{ files, count, names, no_options }`.
- `.github/workflows/update-data.yml` — scheduled/manual data refresh workflow.
- `scripts/options-local-proxy.ts` — local **Bun** proxy serving:
  - `/api/options` — Yahoo optionChain with crumb/cookie handling.
  - `/api/nasdaq` — NASDAQ option-chain relay.
  - `/api/cboe` — CBOE delayed-options relay.
  - `/api/search?provider=yahoo|nasdaq|cboe&q=...` — provider-native suggestions.
- `scripts/options-cloudflare-proxy.js` — deployable Worker with the same provider endpoints plus `/raw?url=...` generic CORS passthrough.

## Project structure

```text
src/
  index.html                  # Parcel entry shell
  index.css                   # Tailwind v4, theme tokens, scrollbar/table-desk CSS
  main.tsx                    # React app, providers, UI, cache/state logic, i18n
data/
  index.json                  # { files, count, names, no_options }
  AAPL.json, SPY.json, ...    # one option-chain cache file per ticker, with greeks metadata when refreshed
scripts/
  options-data.py               # yfinance -> data/options/*.json + data/options/index.json
  options-local-proxy.ts              # local Bun proxy: Yahoo/NASDAQ/CBOE/search
  options-cloudflare-proxy.js        # Cloudflare Worker proxy: Yahoo/NASDAQ/CBOE/search/raw
.github/workflows/
  ci.yaml                     # build checks
  update-data.yml             # scheduled data refresh
  github-pages.yml            # Pages deployment
package.json                  # Bun/Parcel scripts
pyproject.toml                # Python deps for options-data.py
README.md                     # TOC pointing to docs/README.en.md and docs/README.ru.md
docs/
  README.en.md                # English documentation (this file)
  README.ru.md                # Russian documentation
  Setup.en.md / Setup.ru.md   # Agentic setup tutorial
  DEVELOPMENT.en.md / .ru.md  # Developer guide
  AGENTS.en.md / .ru.md       # Compatibility checklist
  ARENA.en.md / .ru.md        # Arena.ai adapter
  .cursorrules                # Cursor AI rules
```

## Privacy & keys

- Browser settings and tokens are stored in localStorage only.
- No application backend exists unless you run/deploy the optional proxy.
- On shared computers, clear keys/settings from the app settings or browser storage.
- For public deployments without a local proxy, use **CACHE**; for live data run the proxy (or Worker) and pick CBOE/YAHOO/NASDAQ.

## Troubleshooting

- **Nothing loads on open:** expected. Press **Expirations**, then **Load**.
- **Needs proxy / CORS errors:** start `bun ./scripts/options-local-proxy.ts` locally or set a Cloudflare Worker URL in Settings → Proxy base URL.
- **`Unexpected token '<'`:** a proxy/server returned HTML instead of JSON. Check proxy URL/provider.
- **CACHE says not cached:** the ticker is absent from `data/options/*.json`; use another provider or let the data workflow eventually cache it.
- **`(no options)` suggestion:** the ticker is valid in the local manifest, but the latest data scan found no listed options.
- **Proxy connection refused:** ensure the proxy is running with `bun ./scripts/options-local-proxy.ts` and the Proxy base URL is set correctly in Settings.

---

*Agentic developer note: keep this README synchronized with `src/main.tsx`, `src/index.css`, `scripts/*`, and `.github/workflows/*`. Prefer correcting/removing stale comments over preserving inaccurate ones.*
