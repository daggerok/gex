# Development Guide — GEX

> **Языки:** [English](DEVELOPMENT.en.md) · Русский (текущий)

Этот документ описывает процесс разработки, сборки и тестирования проекта.

## Стек технологий
- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide React, Recharts.
- **Bundler:** Parcel 2.
- **Runtime (JS/TS):** Bun (используется для скриптов, прокси и управления пакетами).
- **Python:** uv (используется для fetch-скриптов данных).
- **Deployment:** GitHub Pages.

## Быстрый старт (Разработка)

1. **Установка зависимостей:**
   ```bash
   bun i -E
   ```

2. **Запуск в режиме разработки:**
   Для запуска приложения вместе с локальным прокси (pm2 под капотом):
   ```bash
   bun run start
   ```

3. **Цикл разработки и пересборки:**
   ```bash
   bun run stop ; bun run kill ; bun run ps ; bun run start ; sleep 3 ; bun run logs
   ```

## Работа с данными (Python)

Мы используем `uv` для управления окружением Python.

Скрипты исполняемые и запускаются напрямую: `./scripts/options-data.py` (shebang `uv run --script` с inline-зависимостями, флаги `--with` не нужны) и `./scripts/options-local-proxy.ts` (shebang bun).

1. **Запуск полного цикла обновления кэша:**
   ```bash
   ./scripts/options-data.py
   ```

2. **Точечное тестирование тикеров:**
   ```bash
   TICKERS=AAPL,MSFT MAX_FETCHES=2 ./scripts/options-data.py
   ```

3. **Bun-fetcher с параллельными воркерами** (`scripts/options-data.ts`, те же переменные окружения, что у Python-скрипта):
   ```bash
   CONCURRENCY=3 TICKERS=AAPL,MSFT,NVDA ./scripts/options-data.ts
   ```
   `CONCURRENCY` - целое число >= 1 (по умолчанию 1), каждый воркер ждет `REQUEST_SLEEP` после своей записи. `SOFT_DEADLINE_SECONDS` (по умолчанию 0, выключено) прекращает запуск новых тикеров через указанное число секунд. `VERBOSE=1` дополнительно печатает старые строки прогресса с временем. Запуск печатает блок `[ config   ]`, по строке статуса на тикер (`new`, `updated`, `unchanged`, `no-options`, `failed`) и итог `[ done     ]`

## Архитектура greeks
- **1-й порядок:** Загружается из CBOE (в fetch-скрипте) или считается в UI.
- **2-й и 3-й порядок + λ:** Считаются **только** на стороне клиента в `src/greeks.ts`.
- **Запрещено:** Добавлять расчет Black-Scholes в Python скрипты.

## Проверка перед PR
Перед отправкой изменений убедитесь, что:
1. Проект собирается: `bun run build`.
2. Python скрипты компилируются: `uv run python -m py_compile scripts/options-data.py`.
3. Cloudflare Worker валиден: `node --check scripts/options-cloudflare-proxy.js`.
4. В коде нет секретов и лишних отладочных логов.
