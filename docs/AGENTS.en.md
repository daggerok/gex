# AGENTS.en.md

> **Languages:** English (current) · [Русский](AGENTS.ru.md) · **Main contract:** root [`AGENT.md`](../AGENT.md) (EN: [`AGENT.en.md`](../AGENT.en.md))

Compatibility stub: agents that look for `AGENTS.md` should read this file and then **[`AGENT.en.md`](../AGENT.en.md)** (or the canonical **[`AGENT.md`](../AGENT.md)**). Claude-specific: [`CLAUDE.md`](../CLAUDE.md). How-to setup: [`Setup.en.md`](./Setup.en.md) / [`Setup.ru.md`](./Setup.ru.md).

Short checklist:

1. Respond to the user in the language they use or follow the project language rule.
2. Spec → Verifier → Environment (details in `AGENT.md`).
3. New tasks start from the latest `origin/master`, work through a PR.
4. Providers are **only** `CACHE, CBOE, NASDAQ, YAHOO` (fixed order).
5. Default selection: localhost → **CBOE**, GitHub Pages → **CACHE** (do not change list order).
6. **Model / higher-order greeks — UI only** (`src/main.tsx`). `options-data.py` = Cboe 1st-order only. Do not duplicate BS in Python.
7. Do not commit `dist/`, `node_modules/`, `.parcel-cache`, `package-lock.json`, `.venv`, `__pycache__`.
8. Do not change workflows without permission + a token with `workflow` scope.
9. Do not scan the whole `data/` directory (thousands of files).
10. Before PR: `bun run build`, `uv run python -m py_compile scripts/options-data.py`, `node --check scripts/options-cloudflare-proxy.js`.
11. Stale comments / docs — fix them, do not carry them forward.
