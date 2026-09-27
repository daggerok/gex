# Options Desk — Русская документация

> **Языки:** [English](README.en.md) · Русский (текущий) · корневой [`README.md`](../README.md)

Одностраничная **опционная доска**: вводишь тикер, получаешь даты экспираций, выбираешь одну или несколько дат и смотришь цепочку **Calls | Strike | Puts** с bid / mid / ask, IV, объёмом, OI и греками там, где источник их отдаёт. Приложение статическое: React + TypeScript + Tailwind CSS v4, сборка Parcel, деплой на GitHub Pages.

---

*Примечание для агентов: Это проект, разрабатываемый с помощью Agentic AI. Агенты должны всегда начинать с чтения [AGENT.md](../AGENT.md) как основной точки входа и контракта. Держите эти README в синхронизации с `src/main.tsx`, `src/index.css`, `scripts/*` и `.github/workflows/*`. Исправляйте устаревшие комментарии.*

---

## Agentic Setup (Агентная разработка)

Репозиторий оптимизирован для работы с AI-агентами. Основные agent-файлы остаются в корне проекта; расширенные гайды — в [`../docs`](../docs).

- [AGENT.md](../AGENT.md): Основной контракт и правила (EN: [AGENT.en.md](../AGENT.en.md)).
- [CLAUDE.md](../CLAUDE.md): Адаптер для Claude Code.
- [.cursorrules](./.cursorrules): Правила для Cursor AI.
- Адаптер Arena.ai: [русский](./ARENA.ru.md) или [английский](./ARENA.en.md).
- Инструкция по настройке агентной среды: [русский](./Setup.ru.md) или [английский](./Setup.en.md).
- Гид разработчика: [русский](./DEVELOPMENT.ru.md) или [английский](./DEVELOPMENT.en.md).

Для работы используются **Bun** (JS/TS) и **uv** (Python). **Важно:** всегда используйте `bun` вместо `npm`.

---

## Оглавление

- [Что это умеет](#что-это-умеет)
- [Быстрый старт](#быстрый-старт)
- [Как пользоваться](#как-пользоваться)
- [Провайдеры данных](#провайдеры-данных)
- [Подсказки тикеров](#подсказки-тикеров)
- [Greeks в static cache](#greeks-в-static-cache)
- [Публикация на GitHub Pages](#публикация-на-github-pages)
- [Настройка прокси для GitHub Pages](#настройка-прокси-для-github-pages)
- [Вспомогательная инфраструктура](#вспомогательная-инфраструктура)
- [Структура проекта](#структура-проекта)
- [Приватность и ключи](#приватность-и-ключи)
- [Решение проблем](#решение-проблем)

---

## Что это умеет

- **Двухшаговая загрузка без лишних запросов:** при открытии ничего не грузится. Тикер → **Expirations**; экспирации → **Load**.
- **Подсказки тикеров:** поиск по тикеру/названию для всех провайдеров. Локальные подсказки берут названия из `data/options/index.json`; тикеры из `no_options` помечаются **`(no options)`**.
- **Несколько экспираций:** можно выбрать одну, несколько или все. Цепочки показываются стопкой от ранней к поздней со sticky-заголовками.
- **Удобная доска:** подсветка ATM, sticky Calls/Strike/Puts, greeks-колонки включены по умолчанию, настройки колонок для каждой стороны (Calls/Puts) отдельно, missing data показывается пустой ячейкой, скроллбары в теме, сворачивание/разворачивание, автопрокрутка к текущему страйку после загрузки/разворачивания.
- **Theme UX:** компактная иконка текущей темы с animated dropdown для остальных тем.
- **Интернационализация (i18n):** интерфейс на английском и русском языках с переключателем языка в шапке и в настройках.
- **Бейджи настройки:** No setup / Free key / Needs proxy и подсказки, если нужен токен.
- **Локальное состояние:** провайдер, тема, язык, токены, URL прокси, последний тикер, колонки доски и кэш запросов хранятся только в `localStorage`.

## Быстрый старт

Проект использует **Bun** для установки/скриптов и **Parcel** для сборки React/TypeScript.

```bash
git clone https://github.com/daggerok/options-desk.git
cd options-desk
bun install -E
bun run serve
```

Открой localhost-адрес, который напечатает Parcel. Для подробных логов добавь `?debug=true`.

Продакшен-сборка:

```bash
bun run build
```

Сборка для GitHub Pages с правильным public URL `/options-desk/`:

```bash
bun run build-github-pages
```

## Как пользоваться

1. Выбери провайдера в списке **API**.
2. Введи тикер или название компании. При необходимости выбери подсказку.
3. Нажми **Expirations**, чтобы получить экспирации и спот.
4. Выбери одну или несколько дат, либо **All**.
5. Нажми **Load**, чтобы увидеть цепочку.

Порядок в dropdown всегда **CACHE, CBOE, NASDAQ, YAHOO**. Меняется только default: `localhost` / private LAN → **CBOE**; GitHub Pages / hosted static → **CACHE**.

## Провайдеры данных

Только четыре источника. Короткие uppercase labels в dropdown API.

| UI label | Настройка | Покрытие | Греки | Заметки |
|---|---|---|---|---|
| **CACHE** *(default на GitHub Pages)* | Без настройки | Тикеры из `data/options/*.json` | CBOE/model-enriched по мере refresh | Same-origin static JSON (GitHub Actions/yfinance + CBOE delayed 1st-order). Model/higher-order greeks считает браузер. Без CORS и ключей. |
| **CBOE** *(default на localhost)* | Нужен прокси | CBOE delayed options | Да (provider + client BS higher-order) | Самый богатый delayed-фид (greeks/IV/OI/spot). Нужен Proxy base URL (`/api/cboe`). |
| **NASDAQ** | Нужен прокси | NASDAQ option-chain | Нет IV → нет model greeks | Полная цепочка за один запрос: bid/ask/last/volume/OI. Прокси `/api/nasdaq`. |
| **YAHOO** | Нужен прокси | Yahoo symbol search / option chains | Client Black-Scholes из IV | Lazy по expiration. Прокси обрабатывает crumb/cookies (`/api/options`). |

**Порядок в dropdown (всегда):** `CACHE, CBOE, NASDAQ, YAHOO`.  
**Default selection:** `localhost` / private LAN → **CBOE**; hosted static (GitHub Pages) → **CACHE**.

Удалены из registry (только changelog): marketdata.app, DoltHub, Tradier, Alpaca, Polygon/Massive, Alpha Vantage и другие gated-эксперименты.


## Подсказки тикеров

- Локальные подсказки читаются из `data/options/index.json`:
  - `files` — тикеры с закэшированными цепочками.
  - `names` — тикер → название компании/фонда/индекса.
  - `no_options` — валидные тикеры, где последний скан не нашёл опционов; они показываются как **`(no options)`**.
- YAHOO, NASDAQ и CBOE используют endpoint прокси `/api/search?provider=...&q=...` для full-text поиска символов.
- Поиск провайдера — это discovery helper: некоторые найденные символы всё равно могут вернуть "нет опционов" при загрузке.

## Greeks в static cache

**Единый источник model greeks — браузер** (`src/main.tsx`).

- `scripts/options-data.py` пишет yfinance quotes и, если есть, **Cboe delayed 1st-order** (`delta`/`gamma`/`theta`/`vega`/`rho`, `greeksSource: "cboe"`).
- Скрипт **не** считает λ / Vanna / Vomma / Charm / Speed / Zomma / Color и не делает full Black-Scholes fallback — это дубль UI.
- После любого fetch (включая **CACHE**) приложение считает client-side Black-Scholes: missing 1st-order при наличии IV+spot и higher-order когда возможно.
- Пропуски — `greeksMissingReason` (fetcher или client).


## Публикация на GitHub Pages

1. Включи Pages: **Settings → Pages**.
2. Разреши Actions коммитить: **Settings → Actions → General → Workflow permissions → Read and write permissions**.
3. Workflow **Update options data** запускает `scripts/options-data.py`, сам находит universe тикеров, обновляет/расширяет `data/options/*.json`, обновляет `data/options/index.json` и коммитит изменения в `master`.
4. Workflow **GitHub Pages** собирает приложение через `bun run build-github-pages` и деплоит `dist/`.

Ручной список тикеров поддерживается только для разовых запусков: `TICKERS="AAPL MSFT SPY" python scripts/options-data.py`. Плановый workflow использует самообнаружение.

## Настройка прокси для GitHub Pages

**Важно:** При использовании GitHub Pages (или любого static host), провайдеры с прокси (Yahoo, NASDAQ, CBOE) требуют **локально запущенный прокси**, потому что браузер не может напрямую обращаться к этим API из-за CORS ограничений.

### Как это работает

1. Браузер загружает приложение с GitHub Pages (например, `https://daggerok.github.io/options-desk/`)
2. Когда выбираешь провайдера с прокси, приложение отправляет запросы на **Proxy base URL** (по умолчанию: `http://localhost:8787`)
3. Прокси (запущенный на твоей локальной машине) перенаправляет запросы на Yahoo/NASDAQ/CBOE и возвращает ответ
4. Это работает, потому что браузер может обращаться к `localhost` даже когда страница загружена с GitHub Pages

### Запуск локального прокси

```bash
# Клонируй репозиторий (если ещё не сделал)
git clone https://github.com/daggerok/options-desk.git
cd options-desk

# Установи зависимости
bun install -E

# Запусти прокси-сервер
bun ./scripts/options-local-proxy.ts
```

Прокси запустится на `http://localhost:8787` по умолчанию.

### Настройка приложения

1. Открой приложение в браузере
2. Нажми на **иконку шестерёнки** (Settings) в правом верхнем углу
3. Найди поле **Proxy base URL**
4. Установи `http://localhost:8787` (или свой кастомный порт)
5. Теперь можно использовать Yahoo, NASDAQ и CBOE провайдеров

### Альтернатива: Cloudflare Worker

Для деплоя прокси без локального запуска:

1. Деплой `scripts/options-cloudflare-proxy.js` на Cloudflare Workers
2. Установи **Proxy base URL** на URL твоего Worker (например, `https://your-worker.your-subdomain.workers.dev`)

### Решение проблем с прокси

- **"Could not reach the proxy"**: убедись, что прокси запущен (`bun ./scripts/options-local-proxy.ts`)
- **CORS errors**: прокси должен быть запущен на `localhost` или деплоен как Cloudflare Worker
- **Port conflicts**: измени порт в `scripts/options-local-proxy.ts` или используй переменную окружения `PORT`

## Вспомогательная инфраструктура

- `scripts/options-data.py` — умный yfinance-сборщик. Создаёт/обновляет `data/options/*.json`, вешает Cboe delayed **1st-order** greeks (model greeks только в UI) и ведёт `data/options/index.json` с `{ files, count, names, no_options }`.
- `.github/workflows/update-data.yml` — плановый/ручной refresh данных.
- `scripts/options-local-proxy.ts` — локальный **Bun**-прокси:
  - `/api/options` — Yahoo optionChain с crumb/cookies.
  - `/api/nasdaq` — relay NASDAQ option-chain.
  - `/api/cboe` — relay CBOE delayed-options.
  - `/api/search?provider=yahoo|nasdaq|cboe&q=...` — подсказки тикеров.
- `scripts/options-cloudflare-proxy.js` — Cloudflare Worker с теми же provider endpoints плюс `/raw?url=...`.

## Структура проекта

```text
src/
  index.html                  # Parcel entry shell
  index.css                   # Tailwind v4, тема, scrollbars/CSS для доски
  main.tsx                    # React app, providers, UI, кэш/состояние, i18n
data/
  index.json                  # { files, count, names, no_options }
  AAPL.json, SPY.json, ...    # один cache-файл цепочки на тикер, с greeks metadata после refresh
scripts/
  options-data.py               # yfinance -> data/options/*.json + data/options/index.json
  options-local-proxy.ts              # локальный Bun proxy: Yahoo/NASDAQ/CBOE/search
  options-cloudflare-proxy.js        # Cloudflare Worker: Yahoo/NASDAQ/CBOE/search/raw
.github/workflows/
  ci.yaml                     # build checks
  update-data.yml             # обновление данных по расписанию
  github-pages.yml            # деплой Pages
package.json                  # Bun/Parcel scripts
pyproject.toml                # Python deps для options-data.py
README.md                     # TOC со ссылками на docs/README.en.md и docs/README.ru.md
docs/
  README.en.md                # Английская документация
  README.ru.md                # Русская документация (этот файл)
  Setup.en.md / Setup.ru.md   # Учебник по agentic setup
  DEVELOPMENT.en.md / .ru.md  # Гайд разработчика
  AGENTS.en.md / .ru.md       # Compatibility checklist
  ARENA.en.md / .ru.md        # Адаптер Arena.ai
  .cursorrules                # Правила Cursor AI
```

## Приватность и ключи

- Настройки и токены в браузере хранятся только в `localStorage`.
- Backend отсутствует, если ты сам не запускаешь/деплоишь optional proxy.
- На общем компьютере очищай ключи/настройки через настройки приложения или storage браузера.
- Для публичного деплоя без локального прокси используй **CACHE**; для live-данных запусти proxy/Worker и выбери CBOE/YAHOO/NASDAQ.

## Решение проблем

- **При открытии ничего не грузится:** это нормально. Нажми **Expirations**, затем **Load**.
- **Needs proxy / CORS:** запусти `bun ./scripts/options-local-proxy.ts` локально или укажи Cloudflare Worker URL в Settings → Proxy base URL.
- **`Unexpected token '<'`:** прокси/сервер вернул HTML вместо JSON. Проверь URL прокси или провайдера.
- **CACHE говорит not cached:** тикера нет в `data/options/*.json`; используй другой провайдер или дождись, пока data workflow его закэширует.
- **Подсказка `(no options)`:** тикер валиден в локальном manifest, но последний скан не нашёл listed options.
- **Proxy connection refused:** убедись, что прокси запущен (`bun ./scripts/options-local-proxy.ts`) и Proxy base URL указан правильно в Settings.

---

*Agentic developer note: keep this README synchronized with `src/main.tsx`, `src/index.css`, `scripts/*`, and `.github/workflows/*`. Prefer correcting/removing stale comments over preserving inaccurate ones.*
