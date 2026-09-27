# AGENT.md — правила агентной разработки для Options Desk

> **Двуязычно / Bilingual:** расширенные руководства в [`./docs`](./docs) (`*.en.md` / `*.ru.md`). Этот файл — канонический контракт (RU); EN-компаньоны: [`AGENT.en.md`](./AGENT.en.md), [`docs/README.en.md`](./docs/README.en.md), [`docs/DEVELOPMENT.en.md`](./docs/DEVELOPMENT.en.md), [`docs/ARENA.en.md`](./docs/ARENA.en.md).

Этот файл — основной контракт для AI-агентов, которые работают с репозиторием `options-desk`.

## Язык общения

- С пользователем отвечать **по-русски**.
- Код, имена переменных, commit messages, PR titles и технические идентификаторы можно писать по-английски, если это естественно для проекта.
- Если пользователь явно просит другой язык — следовать явной просьбе.

## Что это за проект

Options Desk — статическое React/TypeScript приложение для просмотра опционных цепочек (GitHub Pages + localhost).

Ключевые части:

- `src/main.tsx` — React app: **4 провайдера**, state/cache, UI, **единственный** Black-Scholes / higher-order greeks.
- `src/index.css` — Tailwind CSS v4, theme tokens, sticky desk/grid CSS.
- `scripts/options-data.py` — build-time CACHE generator: yfinance + **Cboe delayed 1st-order only** + `data/options/index.json`. **Без** model BS.
- `scripts/options-local-proxy.ts` — локальный Bun proxy: `/api/cboe`, `/api/nasdaq`, `/api/options` (Yahoo), `/api/search`.
- `scripts/options-cloudflare-proxy.js` — Cloudflare Worker с теми же endpoints (+ `/raw`).
- `data/options/*.json` — static cache цепочек (quotes + optional Cboe 1st-order).
- `data/options/index.json` — manifest: `files`, `count`, `names`, `no_options`.

Agent docs:

- `AGENT.md` — этот файл (главный контракт, RU).
- `AGENT.en.md` — полный английский перевод `AGENT.md`.
- `CLAUDE.md` — короткий adapter для Claude Code.
- `docs/ARENA.ru.md` / `docs/ARENA.en.md` — конфигурация для Arena.ai Agent Mode.
- `docs/AGENTS.ru.md` / `docs/AGENTS.en.md` — compatibility stub.
- `docs/Setup.ru.md` / `docs/Setup.en.md` — how-to по agentic setup в других проектах.
- `docs/.cursorrules` — правила для Cursor AI.
- `SCRATCHPAD.md` — временный файл для заметок агента (игнорируется в git).
- `docs/DEVELOPMENT.ru.md` / `docs/DEVELOPMENT.en.md` — подробный гид разработчика (Developer Guide).

## Текущая архитектура данных

### Провайдеры (только 4)

Короткие **uppercase** labels в UI. Порядок dropdown **фиксирован везде**:

```text
CACHE, CBOE, NASDAQ, YAHOO
```

| UI label | id | Режим | Proxy | Default selection |
|----------|-----|--------|-------|-------------------|
| **CACHE** | `static` | bulk | нет (`data/options/*.json`) | **GitHub Pages / hosted** |
| **CBOE** | `cboe` | bulk | `/api/cboe` | **localhost / LAN** |
| **NASDAQ** | `nasdaq` | bulk | `/api/nasdaq` | — |
| **YAHOO** | `yahoo` | lazy | `/api/options` | — |

- Default selection: `defaultProviderId()` → `cboe` на localhost/LAN, `static` на hosted.
- Порядок списка **не** переворачивать под host — меняется только selected default.
- Удалены из registry: `marketdata.app`, `DoltHub` (и более старые experiments).
- Неизвестный `providerId` в localStorage → host default (`freshDefaultSettings` / migration).

### Greeks — single source of truth (запрет дублирования)

| Слой | Делает | **Запрещено** |
|------|--------|----------------|
| `scripts/options-data.py` | yfinance + Cboe **1st-order** (Δ Γ Θ Vega ρ) | BS, λ, 2nd/3rd order |
| Live CBOE / YAHOO / NASDAQ | raw / provider fields | model math в proxy |
| **`src/main.tsx` runtime** | BS: missing 1st-order + **все** higher-order | второй параллельный BS в Python |

Реализация UI: `blackScholesGreeks` → `enrichQuoteWithModelGreeks` → `enrichQuotesWithModelGreeks` / `enrichChainResult` → `putBulk` / `loadExpiration`.

Per-quote:

- 1st-order: `delta`, `gamma`, `theta`, `vega`, `rho`
- leverage: `lambda`
- 2nd: `vanna`, `vomma`, `charm`
- 3rd: `speed`, `zomma`, `color`
- meta: `greeksSource`, `greeksMissingReason`; chain-level `greeks` summary

Правила:

- Provider 1st-order **не перезаписывать** model-значениями; UI только **досчитывает** missing + higher-order.
- `greeksSource: "cboe"` — provider; `"black-scholes"` — полная модель в UI; `null` + reason — gap.
- NASDAQ без IV → model greeks empty (`missing_iv`).
- Legacy `data/options/*.json` могут ещё содержать precomputed higher-order — UI skip recompute, если они уже есть.
- BS assumptions (client only): `r=0.045`, `q=0.0`; theta/day; vega per 1 vol-pt.
- Колонки λ / Vanna / … в Settings **disabled by default**.
- Missing cell = пусто; `0.0` = реальное значение.

## Методология: Spec → Verifier → Environment

### 1. Spec

- Понять бизнес-цель, не только текст задачи.
- При неоднозначности — конкретные вопросы пользователю.
- Маленькие isolated buckets; архитектурные развилки — checkpoint.

### 2. Verifier (до кодинга)

```bash
bun run build
uv run python -m py_compile scripts/options-data.py
node --check scripts/options-cloudflare-proxy.js
git diff --check
```

- **Разработка и Тест (local):**
  `bun run stop ; bun run kill ; bun run ps ; bun run start ; sleep 3 ; bun run logs`
- **Data fetcher smoke test:**
  `TICKERS=PEP,KO MAX_FETCHES=3 NASDAQ_TIMEOUT=5 uv run --with yfinance --with requests python scripts/options-data.py`
- **UI:** build минимум; в PR — ручной сценарий (provider + Settings columns).

### 3. Environment

- Новые задачи — от актуального `origin/master`, feature branch + PR.
- Основные инструменты: **Bun** (JS/TS) и **uv** (Python).
- Не смешивать mass data-refresh с UI/docs, если не просили.
- Не коммитить `dist/`, `node_modules/`, `.parcel-cache`, `package-lock.json`, `.venv`, `__pycache__`.
- Workflow (`.github/workflows/*`) — только с `workflow` scope token / явным OK.

## Автопилот / спросить сначала / никогда

### Автопилот

- stale comments/docs в затронутых файлах;
- build/lint/smoke;
- feature branch + push + PR;
- type-safe metadata под уже согласованную фичу;
- sync README/agent docs с фактическим кодом.

### Спросить сначала

- схема `data/options/*.json`, ломающая старые файлы;
- mass regenerate/commit `data/options/*.json`;
- `.github/workflows/*`;
- **менять fixed provider order** (`CACHE, CBOE, NASDAQ, YAHOO`) или host defaults;
- добавлять 5-й provider / платный API;
- снова вводить model greeks в Python (нарушает single source of truth);
- удалять крупные historical changelog sections;
- менять UX defaults без явной просьбы.

### Никогда

- Secrets/tokens в коммитах, README, PR, логах.
- Build/cache artifacts в git.
- Force push в чужие ветки без явной команды.
- Workflow без `workflow` scope.
- Утверждать 100% complete free/delayed data.
- **Дублировать business logic** в двух местах (особенно Black-Scholes: UI only).
- **Искать/list/grep по всей `data/`** (~тысячи файлов). Допустимо:
  - известный тикер → `data/AAPL.json`;
  - `data/options/index.json`;
  - явная просьба по конкретному файлу;
  - иначе — спросить.

## Комментарии и agentic headers

- Полезные архитектурные комментарии сохранять.
- Stale — править или удалять.
- Changelog в `main.tsx` / `options-data.py` должен совпадать с поведением.
- Не писать комментарии «на всякий случай».

## PR checklist

```bash
bun run build
uv run python -m py_compile scripts/options-data.py
node --check scripts/options-cloudflare-proxy.js
git diff --check
```

В PR body: что / как проверено / ограничения / обновлялись ли data files.

Если трогали greeks: явно подтвердить, что model math **не** появился в `options-data.py`.
