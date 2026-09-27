# AGENT.en.md — Agentic Development Rules for Options Desk

> **Bilingual / Двуязычно:** extended guides are in [`./docs`](./docs) (`*.en.md` / `*.ru.md`). The root [`AGENT.md`](./AGENT.md) is the canonical RU contract; EN companions: [`AGENT.en.md`](./AGENT.en.md) (this file), [`docs/README.en.md`](./docs/README.en.md), [`docs/DEVELOPMENT.en.md`](./docs/DEVELOPMENT.en.md), [`docs/ARENA.en.md`](./docs/ARENA.en.md).

This file is the main contract for AI agents working with the `options-desk` repository.

## Communication Language

- Respond to the user in **Russian** (unless explicitly requested otherwise).
- Code, variable names, commit messages, PR titles, and technical identifiers may be written in English where natural for the project.
- If the user explicitly requests another language, follow their explicit request.

## Project Overview

Options Desk is a static React/TypeScript application for viewing options chains (GitHub Pages + localhost).

Key parts:

- `src/main.tsx` — React app: **4 providers**, state/cache, UI, **single** Black-Scholes / higher-order greeks implementation.
- `src/index.css` — Tailwind CSS v4, theme tokens, sticky desk/grid CSS.
- `scripts/options-data.py` — build-time CACHE generator: yfinance + **Cboe delayed 1st-order only** + `data/options/index.json`. **No** model BS.
- `scripts/options-local-proxy.ts` — local Bun proxy: `/api/cboe`, `/api/nasdaq`, `/api/options` (Yahoo), `/api/search`.
- `scripts/options-cloudflare-proxy.js` — Cloudflare Worker with identical endpoints (+ `/raw`).
- `data/options/*.json` — static cache of chains (quotes + optional Cboe 1st-order).
- `data/options/index.json` — manifest: `files`, `count`, `names`, `no_options`.

Agent docs:

- `AGENT.md` — canonical root contract (RU).
- `AGENT.en.md` — full English translation of `AGENT.md` (this file).
- `CLAUDE.md` — concise adapter for Claude Code.
- `docs/ARENA.ru.md` / `docs/ARENA.en.md` — configuration for Arena.ai Agent Mode.
- `docs/AGENTS.ru.md` / `docs/AGENTS.en.md` — compatibility stub.
- `docs/Setup.ru.md` / `docs/Setup.en.md` — how-to guide for agentic setup across other projects.
- `docs/.cursorrules` — rules for Cursor AI.
- `SCRATCHPAD.md` — temporary scratchpad file for agent notes (ignored by git).
- `docs/DEVELOPMENT.ru.md` / `docs/DEVELOPMENT.en.md` — detailed Developer Guide.

## Current Data Architecture

### Providers (Exactly 4)

Short **uppercase** labels in the UI. Dropdown order is **fixed everywhere**:

```text
CACHE, CBOE, NASDAQ, YAHOO
```

| UI label | id | Mode | Proxy | Default selection |
|----------|-----|------|-------|-------------------|
| **CACHE** | `static` | bulk | none (`data/options/*.json`) | **GitHub Pages / hosted** |
| **CBOE** | `cboe` | bulk | `/api/cboe` | **localhost / LAN** |
| **NASDAQ** | `nasdaq` | bulk | `/api/nasdaq` | — |
| **YAHOO** | `yahoo` | lazy | `/api/options` | — |

- Default selection: `defaultProviderId()` → `cboe` on localhost/LAN, `static` on hosted environments.
- The list order must **not** be reordered depending on host — only the selected default changes.
- Removed from registry: `marketdata.app`, `DoltHub` (and older experiments).
- Unknown `providerId` in localStorage falls back to host default (`freshDefaultSettings` / migration).

### Greeks — Single Source of Truth (No Duplication)

| Layer | Responsible for | **Strictly Forbidden** |
|-------|-----------------|------------------------|
| `scripts/options-data.py` | yfinance + Cboe **1st-order** (Δ Γ Θ Vega ρ) | BS, λ, 2nd/3rd order |
| Live CBOE / YAHOO / NASDAQ | raw / provider fields | model math inside proxy |
| **`src/main.tsx` runtime** | BS: missing 1st-order + **all** higher-order | second parallel BS in Python |

UI implementation: `blackScholesGreeks` → `enrichQuoteWithModelGreeks` → `enrichQuotesWithModelGreeks` / `enrichChainResult` → `putBulk` / `loadExpiration`.

Per-quote:

- 1st-order: `delta`, `gamma`, `theta`, `vega`, `rho`
- leverage: `lambda`
- 2nd-order: `vanna`, `vomma`, `charm`
- 3rd-order: `speed`, `zomma`, `color`
- meta: `greeksSource`, `greeksMissingReason`; chain-level `greeks` summary

Rules:

- Provider 1st-order greeks must **not** be overwritten by model values; the UI only **computes missing** 1st-order + higher-order greeks.
- `greeksSource: "cboe"` — provider; `"black-scholes"` — full model in UI; `null` + reason — gap/missing.
- NASDAQ without IV → model greeks empty (`missing_iv`).
- Legacy `data/options/*.json` files may still contain precomputed higher-order greeks — UI skips recomputing if they already exist.
- BS assumptions (client side only): `r=0.045`, `q=0.0`; theta/day; vega per 1 vol-pt.
- Settings columns for λ / Vanna / … are **disabled by default**.
- Missing cell = empty string; `0.0` = real numerical value.

## Methodology: Spec → Verifier → Environment

### 1. Spec

- Understand the business goal, not just the literal task wording.
- Ask specific clarifying questions to the user when facing ambiguity.
- Break work into small isolated buckets; verify at architectural checkpoints.

### 2. Verifier (Before Coding)

```bash
bun run build
uv run python -m py_compile scripts/options-data.py
node --check scripts/options-cloudflare-proxy.js
git diff --check
```

- **Development & Testing (local):**
  `bun run stop ; bun run kill ; bun run ps ; bun run start ; sleep 3 ; bun run logs`
- **Data fetcher smoke test:**
  `TICKERS=PEP,KO MAX_FETCHES=3 NASDAQ_TIMEOUT=5 uv run --with yfinance --with requests python scripts/options-data.py`
- **UI:** build at minimum; in PR — provide manual verification scenarios (provider + Settings columns).

### 3. Environment

- New tasks start from the latest `origin/master` via a feature branch + PR.
- Primary toolchain: **Bun** (JS/TS) and **uv** (Python).
- Do not mix mass data-refreshes with UI/docs changes unless requested.
- Do not commit `dist/`, `node_modules/`, `.parcel-cache`, `package-lock.json`, `.venv`, `__pycache__`.
- Workflow files (`.github/workflows/*`) — edit only with a `workflow` scope token / explicit confirmation.

## Autopilot / Ask First / Never

### Autopilot

- Stale comments/docs in touched files;
- Build/lint/smoke tests;
- Feature branch + push + PR;
- Type-safe metadata needed for already approved features;
- Synchronizing README/agent docs with actual code behavior.

### Ask First

- Changes to `data/options/*.json` schema that break legacy files;
- Mass regenerating/committing `data/options/*.json`;
- Editing `.github/workflows/*`;
- **Changing fixed provider order** (`CACHE, CBOE, NASDAQ, YAHOO`) or host defaults;
- Adding a 5th provider / paid API;
- Reintroducing model greeks into Python (violates single source of truth);
- Deleting major historical changelog sections;
- Changing UX defaults without explicit request.

### Never

- Secrets/tokens in commits, README, PRs, or logs.
- Build/cache artifacts in git.
- Force pushing to someone else's branch without explicit instruction.
- Workflows without `workflow` scope.
- Claiming 100% complete free/delayed data.
- **Duplicating business logic** in two places (especially Black-Scholes: UI only).
- **Scanning/listing/grepping across the entire `data/` directory** (~thousands of files). Allowed:
  - Known ticker → `data/AAPL.json`;
  - `data/options/index.json`;
  - Explicit request regarding a specific file;
  - Otherwise — ask first.

## Comments and Agentic Headers

- Preserve useful architectural comments.
- Update or remove stale comments/docs.
- Changelog headers inside `main.tsx` / `options-data.py` / `index.css` must stay synchronized with actual code behavior.
- Do not write defensive "just in case" boilerplate comments.

## PR Checklist

```bash
bun run build
uv run python -m py_compile scripts/options-data.py
node --check scripts/options-cloudflare-proxy.js
git diff --check
```

In the PR body: specify what changed / how it was verified / limitations / whether data files were updated.

If greeks were touched: explicitly confirm that model math **has not** appeared in `options-data.py`.
