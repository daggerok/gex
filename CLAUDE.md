# CLAUDE.md — adapter для Claude Code / Claude-совместимых агентов

> **Двуязычно / Bilingual:** [`docs/`](./docs) содержит `*.en.md` / `*.ru.md` руководства.
> **Главный контракт:** [`AGENT.md`](./AGENT.md). Этот файл — короткий adapter; при конфликте побеждает `AGENT.md`.

## Обязательное поведение

- Отвечай пользователю **по-русски**.
- Неоднозначные задачи: **Spec → Verifier → Environment** (см. `AGENT.md`).
- Не кодить «вслепую» без бизнес-контекста; крупные развилки — вопросы + checkpoint.
- После изменений — проверки и перечисление их в PR.
- Стартуя задачу: при критичных правилах явно опирайся на `AGENT.md` (Arena/другие runners могут не auto-load этот файл).

## Проект (факты)

- Stack: React + TypeScript + Tailwind v4 + Parcel/Bun.
- Providers (UI): **CACHE, CBOE, NASDAQ, YAHOO** — fixed order.
- Defaults: localhost/LAN → **CBOE**; GitHub Pages → **CACHE** (`defaultProviderId` in `src/main.tsx`).
- Proxy: `scripts/options-local-proxy.ts` / `scripts/options-cloudflare-proxy.js` (`/api/cboe`, `/api/nasdaq`, `/api/options`, `/api/search`).
- CACHE files: `data/options/*.json` + `data/options/index.json` via `scripts/options-data.py`.

## Anti-duplication (критично)

| Место | Greeks |
|-------|--------|
| `options-data.py` | Cboe delayed **1st-order only** |
| `src/main.tsx` | **Единственный** Black-Scholes + λ + 2nd/3rd |

**Никогда** не возвращать `_black_scholes_greeks` (и аналоги) в Python. Higher-order / model fallback — только `blackScholesGreeks` / `enrichQuotesWithModelGreeks`.

Не путать:

- Live **CBOE** provider vs build-time Cboe enrichment в fetcher.
- **CACHE** static JSON vs browser query cache (`localStorage`).
- `greeksSource: "cboe"` (provider) vs `"black-scholes"` (UI model).

Удалены из registry: marketdata, DoltHub (и старше).

## Проверки

```bash
bun run build
uv run python -m py_compile scripts/options-data.py
node --check scripts/options-cloudflare-proxy.js
git diff --check
```

Fetcher smoke (без mass commit): `TICKERS=AAPL MAX_FETCHES=1 REQUEST_SLEEP=0 uv run python scripts/options-data.py`.

## Файлы

- UI / providers / BS: `src/main.tsx`
- Styles: `src/index.css`
- Agent docs: `AGENT.md`, `CLAUDE.md`, `docs/AGENTS.ru.md`/`docs/AGENTS.en.md`, `docs/Setup.ru.md`/`docs/Setup.en.md`
- Не коммитить: `dist/`, `node_modules/`, `.parcel-cache`, `.venv`, `__pycache__`, `package-lock.json`
