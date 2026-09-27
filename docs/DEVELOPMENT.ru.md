# Development Guide — Options Desk

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
   bun install -E
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

1. **Запуск полного цикла обновления кэша:**
   ```bash
   uv run --with yfinance --with requests python scripts/options-data.py
   ```

2. **Точечное тестирование тикеров:**
   ```bash
   TICKERS=AAPL,MSFT MAX_FETCHES=2 uv run --with yfinance --with requests python scripts/options-data.py
   ```

## Архитектура greeks
- **1-й порядок:** Загружается из CBOE (в fetch-скрипте) или считается в UI.
- **2-й и 3-й порядок + λ:** Считаются **только** на стороне клиента в `src/main.tsx`.
- **Запрещено:** Добавлять расчет Black-Scholes в Python скрипты.

## Проверка перед PR
Перед отправкой изменений убедитесь, что:
1. Проект собирается: `bun run build`.
2. Python скрипты компилируются: `uv run python -m py_compile scripts/options-data.py`.
3. Cloudflare Worker валиден: `node --check scripts/options-cloudflare-proxy.js`.
4. В коде нет секретов и лишних отладочных логов.
