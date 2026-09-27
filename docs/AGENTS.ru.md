# AGENTS.md

> **Языки:** [English](AGENTS.en.md) · Русский (текущий) · **Главный контракт:** корневой [`AGENT.md`](../AGENT.md) (EN: [`AGENT.en.md`](../AGENT.en.md))

Compatibility stub: агенты, которые ищут `AGENTS.md`, должны читать этот файл и затем **[`AGENT.md`](../AGENT.md)**. Claude-specific: [`CLAUDE.md`](../CLAUDE.md). How-to setup: [`Setup.ru.md`](./Setup.ru.md) / [`Setup.en.md`](./Setup.en.md).

Короткий checklist:

1. Отвечать пользователю **по-русски**.
2. Spec → Verifier → Environment (детали в `AGENT.md`).
3. Новые задачи — от актуального `origin/master`, работа через PR.
4. Провайдеры **только** `CACHE, CBOE, NASDAQ, YAHOO` (порядок фиксирован).
5. Default selection: localhost → **CBOE**, GitHub Pages → **CACHE** (порядок списка не менять).
6. **Model / higher-order greeks — только UI** (`src/main.tsx`). `options-data.py` = Cboe 1st-order only. Не дублировать BS в Python.
7. Не коммитить `dist/`, `node_modules/`, `.parcel-cache`, `package-lock.json`, `.venv`, `__pycache__`.
8. Не менять workflows без разрешения + token с `workflow` scope.
9. Не обходить/`grep -r` всю `data/` (тысячи файлов).
10. Перед PR: `bun run build`, `uv run python -m py_compile scripts/options-data.py`, `node --check scripts/options-cloudflare-proxy.js`.
11. Stale comments/docs — исправлять, не тащить.
