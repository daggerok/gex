# GEX - project rules (always loaded)

Static React 19 + TypeScript + Tailwind v4 app (Parcel, `bun test`, GitHub Pages). Tabs Desk, GEX, Chart share one loaded options chain

## Rules

- R1: all derived math (greeks, GEX, flip, walls, max pain) lives only in `src/greeks.ts`, `src/gex.ts`, `src/vix-pricing.ts`, never in Python or the proxies
- R2: exactly 4 providers in fixed order CACHE, CBOE, NASDAQ, YAHOO
- R3: ask before changing the schema of `data/options/*.json`
- R4: ask before touching `.github/workflows/*.yml`
- R5: never commit `dist/`, `node_modules/`, `.parcel-cache/`, `.venv/`, `__pycache__/`
- Levels are computed only in `useGexLevels` -> `computeGexLevels`, views never recompute
- Every UI string needs `en` and `ru` in `src/i18n.tsx`, level colors come only from `src/gex-colors.ts`
- Sourced vs unsourced: every level's doc comment and `gex-levels.md` must cite its source with a quote, or say it is an original heuristic. Never present an invented rule as a standard

## On every change

Update `.claude/` in the same change: the matching doc, a dated entry in `decisions.md`, and every reference to anything you renamed or moved. `src/claude-docs.test.ts` fails on dead paths. Details: `.claude/docs/maintenance.md`

## Before a PR

`bun test`, `bun run build`, `python3 -m py_compile scripts/options-data.py`, `node --check scripts/options-cloudflare-proxy.js`, `git diff --check`

## Docs (read on demand)

Start at `.claude/docs/README.md`: `gex-levels.md` (formulas and sources), `architecture.md`, `decisions.md` (history), `maintenance.md`, `spec-*.md` (original requirements and research, cited by code comments)
