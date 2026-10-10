# Development Guide — GEX

> **Языки:** [English](DEVELOPMENT.en.md) · Русский (текущий)

Этот документ описывает процесс разработки, сборки и тестирования проекта.

## Стек технологий
- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide React, Recharts.
- **Bundler:** Parcel 2.
- **Runtime (JS/TS):** Bun (используется для скриптов, прокси и управления пакетами).
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

## Работа с данными

Скрипты исполняемые и запускаются напрямую (shebang bun): `./scripts/options-data.ts` и `./scripts/options-local-proxy.ts`. У fetcher нет зависимостей, достаточно Bun.

1. **Запуск полного цикла обновления кэша:**
   ```bash
   ./scripts/options-data.ts
   ```

2. **Точечное тестирование тикеров:**
   ```bash
   TICKERS=AAPL,MSFT MAX_FETCHES=2 ./scripts/options-data.ts
   ```

3. **Параллельные воркеры:**
   ```bash
   CONCURRENCY=3 TICKERS=AAPL,MSFT,NVDA ./scripts/options-data.ts
   ```
   `CONCURRENCY` - целое число >= 1 (по умолчанию 1), каждый воркер ждет `REQUEST_SLEEP` после своей записи. Запросы к Cboe идут через один общий ограничитель (`CBOE_MIN_INTERVAL`, по умолчанию 1 с), при 429 все воркеры делают паузу (`CBOE_BACKOFF`, `CBOE_RETRIES`), поэтому больше воркеров не повышают частоту запросов к Cboe. `SOFT_DEADLINE_SECONDS` (по умолчанию 0, выключено) прекращает запуск новых тикеров через указанное число секунд. `VERBOSE=1` дополнительно печатает старые строки прогресса с временем. Запуск печатает блок `[ config   ]`, по строке статуса на тикер (`new`, `updated`, `unchanged`, `no-options`, `failed`) и итог `[ done     ]`

## Архитектура greeks
- **1-й порядок:** Загружается из CBOE (в fetch-скрипте) или считается в UI.
- **2-й и 3-й порядок + λ:** Считаются **только** на стороне клиента в `src/greeks.ts`.
- **Запрещено:** Добавлять расчет Black-Scholes в скрипт fetcher.

## Проверка перед PR
Перед отправкой изменений убедитесь, что:
1. Проект собирается: `bun run build`.
2. Fetcher собирается: `bun build --target=bun scripts/options-data.ts --outfile=/dev/null`.
3. Cloudflare Worker валиден: `node --check scripts/options-cloudflare-proxy.js`.
4. В коде нет секретов и лишних отладочных логов.
