# Setup.md — как настраивать agentic AI разработку

> **Языки:** [English](Setup.en.md) · Русский (текущий)

Этот документ объясняет, как сделать хороший AI-agent setup для нового проекта и для уже существующего репозитория. Он написан на примере текущего проекта Options Desk, но подход можно переносить в другие проекты.

## 1. Как Arena.ai Agent Mode работает с `CLAUDE.md`

Короткий ответ: **не стоит полагаться, что Arena.ai всегда автоматически прочитает `CLAUDE.md` в новом чате**.

Разные agent runners работают по-разному:

- Claude Code обычно специально смотрит на `CLAUDE.md`.
- Некоторые агенты смотрят на `AGENTS.md`.
- Некоторые агенты читают только то, что пользователь явно попросил прочитать.
- Arena.ai Agent Mode может видеть файлы репозитория через tools, но если в задаче не сказано “прочитай agent docs”, агент может начать с обычного обзора файлов или вообще не открыть `CLAUDE.md`.

Практическое правило:

> Если agentic правила критичны, в начале новой задачи напиши: “Сначала прочитай `AGENT.md`, `CLAUDE.md` и `Setup.md`, затем действуй по ним”.

Поэтому в этом репозитории есть несколько файлов:

- `AGENT.md` — основной контракт, нейтральный для любых агентов.
- `CLAUDE.md` — адаптер для Claude Code.
- `AGENTS.ru.md` / `AGENTS.en.md` — совместимость с агентами, которые ожидают plural form.
- `Setup.ru.md` / `Setup.en.md` — обучающий документ: как делать setup в новых и существующих проектах.

## 2. Хорошая методология: Spec → Verifier → Environment

Эта схема взята из твоего промпта и адаптирована под реальную разработку.

### The Spec

Цель: не писать код, пока не понятна задача.

Агент должен:

1. Понять бизнес-цель.
2. Задать вопросы, если задача неоднозначна.
3. Разбить работу на небольшие buckets.
4. Получить checkpoint для архитектурных решений.

Пример хорошего вопроса:

> “Model greeks (λ / 2nd / 3rd) только в UI, а options-data.py — лишь Cboe 1st-order?”

Плохой подход:

> “Ок, сейчас всё сделаю” — без уточнения, где живёт BS (UI vs Python), схемы metadata и UX defaults.

### The Verifier

Цель: заранее понять, как мы докажем, что задача сделана.

Для Options Desk типовые проверки:

```bash
bun run build
uv run python -m py_compile scripts/options-data.py
node --check scripts/options-cloudflare-proxy.js
git diff --check
```

Для data-fetcher задач:

```bash
TICKERS=XSW MAX_FETCHES=1 REQUEST_SLEEP=0 uv run python scripts/options-data.py
```

Но массовый data refresh нельзя коммитить без явной просьбы.

### The Environment

Цель: зафиксировать правила работы с файлами и окружением.

Для Options Desk:

- начинать новую задачу от свежего `origin/master`;
- работать в feature branch;
- пушить PR;
- не коммитить `dist/`, `node_modules/`, `.parcel-cache`, `package-lock.json`, `.venv`, `__pycache__`;
- workflow-файлы менять осторожно, потому что GitHub PAT должен иметь `workflow` scope.

## 3. Setup для нового проекта / чистого репозитория

### Шаг 1. Создай минимальные agent files

Рекомендуемый набор:

```text
AGENT.md      # основной контракт для любых агентов
CLAUDE.md     # адаптер для Claude Code
AGENTS.md     # совместимость с другими agent runners
Setup.md      # обучающий/how-to документ
```

### Шаг 2. В `AGENT.md` опиши проект

Минимальная структура:

```markdown
# AGENT.md

## Язык общения
- Отвечать по-русски.

## Что это за проект
- Краткое описание.
- Главные файлы.
- Главные команды.

## Методология
- Spec → Verifier → Environment.

## Автопилот
- Что агент может делать сам.

## Спросить сначала
- Где нужно подтверждение.

## Никогда не делать
- Secrets, force push, workflow без разрешения, etc.

## Проверки
- Команды build/test/lint.
```

### Шаг 3. В `CLAUDE.md` не дублируй всё

`CLAUDE.md` должен ссылаться на `AGENT.md`:

```markdown
# CLAUDE.md

Главные правила см. в AGENT.md.
Claude-specific notes:
- сначала читать AGENT.md;
- использовать Spec → Verifier → Environment;
- запускать проверки перед PR.
```

Так меньше риска, что файлы разъедутся.

### Шаг 4. Зафиксируй команды проверки

Даже в чистом проекте должны быть команды:

```bash
bun run build
npm test
npm run lint
```

или аналоги. Если тестов ещё нет, agent docs должны честно говорить:

> “Тестов пока нет; минимум — build + smoke test”.

### Шаг 5. Определи boundaries

Для нового проекта особенно важно заранее написать:

- можно ли агенту менять зависимости;
- можно ли менять CI/CD;
- можно ли добавлять external services;
- можно ли менять data schema;
- где хранятся secrets;
- какие файлы нельзя трогать без разрешения.

### Шаг 6. Добавь PR checklist

Пример:

```markdown
## PR checklist
- [ ] Код маленьким scope.
- [ ] Build проходит.
- [ ] Tests/lint проходят.
- [ ] Нет secrets.
- [ ] README/agent docs обновлены, если поведение поменялось.
```

## 4. Setup для существующего проекта / репозитория

Для существующего проекта нельзя сразу писать идеальные правила “с нуля”. Сначала нужен аудит.

### Шаг 1. Инвентаризация

Агент должен изучить:

```bash
find . -maxdepth 3 -type f
cat package.json
cat pyproject.toml
ls .github/workflows
```

И определить:

- реальные build/test команды;
- реальные entrypoints;
- где живёт бизнес-логика;
- какие docs устарели;
- какие generated files нельзя трогать;
- какие CI ограничения есть.

### Шаг 2. Найти stale comments

Искать:

```bash
grep -RInE 'TODO|FIXME|old|deprecated|Vite|webpack|no_options|provider|proxy' .
```

Но исправлять не механически. Нужно понимать, что реально устарело.

### Шаг 3. Создать agent docs на основе фактов

Не писать generic “best practices”. Нужно описать конкретно этот repo:

- реальные команды;
- реальные провайдеры;
- реальные data schemas;
- реальные ограничения токена/CI;
- реальные правила PR.

### Шаг 4. Разделить “исправления” и “улучшения”

Для существующего проекта важно не смешивать:

- bug fix;
- docs sync;
- refactor;
- feature;
- mass data refresh.

Лучше отдельные PR, если изменения разного типа.

### Шаг 5. Согласовать опасные зоны

В существующем проекте агент должен спрашивать перед:

- изменением `.github/workflows/*`;
- массовым изменением `data/options/*.json`;
- изменением public schema;
- удалением исторических changelog sections;
- сменой default provider/theme/UX;
- добавлением новых external dependencies.

## 5. Как понять, что agentic setup хороший

Хороший setup отвечает на вопросы:

1. Что это за проект?
2. Какие файлы главные?
3. Как проверить изменения?
4. Что агент может делать сам?
5. Где нужен checkpoint пользователя?
6. Что запрещено?
7. Как работать с secrets?
8. Как пушить PR?
9. Какие known pitfalls есть?
10. Как поддерживать docs актуальными?

Если файл содержит только общие фразы вроде “write clean code”, он почти бесполезен.

## 6. Хороший стартовый промпт для нового проекта

```text
Сначала прочитай AGENT.md / CLAUDE.md, если они есть.
Если их нет — помоги создать agentic setup.
Работаем по Spec → Verifier → Environment.
Не пиши код, пока не задашь вопросы и не согласуешь план.
Отвечай по-русски.
```

## 7. Хороший стартовый промпт для существующего проекта

```text
Сначала сделай аудит репозитория.
Найди реальные build/test команды, entrypoints, data schemas, CI limitations.
Проверь AGENT.md / CLAUDE.md / README на stale comments.
Составь список проблем и задай мне вопросы по scope.
Код не меняй, пока я не подтвержу список.
Отвечай по-русски.
```

## 8. Как это применено в Options Desk

В этом репозитории setup сделан так:

- `AGENT.md` — главный контракт для любого AI агента (провайдеры, greeks, never/autopilot).
- `CLAUDE.md` — короткий adapter для Claude Code (ссылается на `AGENT.md`).
- `AGENTS.ru.md` / `AGENTS.en.md` — compatibility checklist.
- `Setup.ru.md` / `Setup.en.md` — этот учебник (переносимый how-to).

Правила специально учитывают Options Desk:

- static React/TypeScript + Parcel/Bun;
- **ровно 4 провайдера**, fixed dropdown order `CACHE, CBOE, NASDAQ, YAHOO`;
- default selection only: localhost → CBOE, GitHub Pages → CACHE;
- yfinance + Cboe **1st-order** в `options-data.py` для CACHE;
- **single source of truth** для model/higher-order greeks — `src/main.tsx` (не дублировать в Python);
- companion proxy (Bun / Cloudflare Worker) для CBOE/NASDAQ/YAHOO;
- GitHub Pages deploy + scheduled data refresh workflow;
- PAT limitation with `workflow` scope;
- запрет mass `data/` walk и mass data commit без явной просьбы.

Пример хорошего checkpoint-вопроса для этого repo:

> «Higher-order greeks считать только в UI, а в options-data.py оставить Cboe 1st-order — верно?»

Главная идея: agent docs — рабочий контракт, а не ритуальные файлы. При смене архитектуры (провайдеры, greeks ownership) **сначала** обновляют `AGENT.md` / `CLAUDE.md` / `AGENTS.md`, потом код — или в том же PR, но docs не оставляют stale.
