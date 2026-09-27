# Development Guide — Options Desk

> **Languages:** English (current) · [Русский](DEVELOPMENT.ru.md)

This document describes the development, build, and test process for the project.

## Technology stack
- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide React, Recharts.
- **Bundler:** Parcel 2.
- **Runtime (JS/TS):** Bun (used for scripts, proxy, and package management).
- **Python:** uv (used for data fetch scripts).
- **Deployment:** GitHub Pages.

## Quick start (development)

1. **Install dependencies:**
   ```bash
   bun install -E
   ```

2. **Run in development mode:**
   To start the app together with the local proxy (pm2 under the hood):
   ```bash
   bun run start
   ```

3. **Development / rebuild cycle:**
   ```bash
   bun run stop ; bun run kill ; bun run ps ; bun run start ; sleep 3 ; bun run logs
   ```

## Working with data (Python)

We use `uv` to manage the Python environment.

1. **Run the full cache update cycle:**
   ```bash
   uv run --with yfinance --with requests python scripts/options-data.py
   ```

2. **Spot-check specific tickers:**
   ```bash
   TICKERS=AAPL,MSFT MAX_FETCHES=2 uv run --with yfinance --with requests python scripts/options-data.py
   ```

## Greeks architecture
- **1st order:** Loaded from CBOE (in the fetch script) or computed in the UI.
- **2nd and 3rd order + λ:** Computed **only** on the client side in `src/main.tsx`.
- **Forbidden:** Adding Black-Scholes calculations in Python scripts.

## Pre-PR checks
Before submitting changes, make sure that:
1. The project builds: `bun run build`.
2. Python scripts compile: `uv run python -m py_compile scripts/options-data.py`.
3. The Cloudflare Worker is valid: `node --check scripts/options-cloudflare-proxy.js`.
4. There are no secrets or leftover debug logs in the code.
