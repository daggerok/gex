# Setup.en.md — How to set up agentic AI development

> **Languages:** English (current) · [Русский](Setup.ru.md)

This document explains how to build a good AI-agent setup for a new project or an existing repository. It is written using the current Options Desk project as an example, but the approach can be transferred to other projects.

## 1. How Arena.ai Agent Mode works with `CLAUDE.md`

Short answer: **do not rely on Arena.ai automatically reading `CLAUDE.md` at the start of every new chat**.

Different agent runners behave differently:

- Claude Code usually looks specifically for `CLAUDE.md`.
- Some agents look for `AGENTS.md`.
- Some agents only read what the user explicitly asks them to read.
- Arena.ai Agent Mode can see repository files through tools, but if the task does not say “read the agent docs”, the agent may start with a normal file overview or may not open `CLAUDE.md` at all.

Practical rule:

> If agentic rules are critical, start every new task with: “First read `AGENT.md`, `CLAUDE.md` and `Setup.md`, then act according to them”.

That is why this repository has several files:

- `AGENT.md` — main contract, neutral for any agents.
- `CLAUDE.md` — adapter for Claude Code.
- `AGENTS.md` — compatibility for agents that expect the plural form.
- `Setup.md` — tutorial document: how to create a setup in new and existing projects.

## 2. Good methodology: Spec → Verifier → Environment

This scheme is taken from your prompt and adapted for real development.

### The Spec

Goal: do not write code until the task is understood.

The agent must:

1. Understand the business goal.
2. Ask questions if the task is ambiguous.
3. Split the work into small buckets.
4. Get a checkpoint for architectural decisions.

Example of a good question:

> “Model greeks (λ / 2nd / 3rd) only in the UI, while `options-data.py` keeps only Cboe 1st-order?”

Bad approach:

> “Okay, I’ll do everything now” — without clarifying where BS lives (UI vs Python), metadata schema, and UX defaults.

### The Verifier

Goal: decide in advance how we will prove the task is done.

For Options Desk the typical checks are:

```bash
bun run build
uv run python -m py_compile scripts/options-data.py
node --check scripts/options-cloudflare-proxy.js
git diff --check
```

For data-fetcher tasks:

```bash
TICKERS=XSW MAX_FETCHES=1 REQUEST_SLEEP=0 uv run python scripts/options-data.py
```

But a mass data refresh must not be committed without an explicit request.

### The Environment

Goal: fix the rules for working with files and the environment.

For Options Desk:

- start each task from a fresh `origin/master`;
- work in a feature branch;
- push a PR;
- do not commit `dist/`, `node_modules/`, `.parcel-cache`, `package-lock.json`, `.venv`, `__pycache__`;
- workflow files should be changed carefully, because a GitHub PAT needs the `workflow` scope.

## 3. Setup for a new project / clean repository

### Step 1. Create minimal agent files

Recommended set:

```text
AGENT.md      # main contract for any agents
CLAUDE.md     # adapter for Claude Code
AGENTS.md     # compatibility with other agent runners
Setup.md      # tutorial / how-to document
```

### Step 2. Describe the project in `AGENT.md`

Minimal structure:

```markdown
# AGENT.md

## Language
- Respond in Russian.

## What is this project
- Short description.
- Main files.
- Main commands.

## Methodology
- Spec → Verifier → Environment.

## Autopilot
- What the agent can do on its own.

## Ask first
- Where confirmation is needed.

## Never do
- Secrets, force push, workflows without permission, etc.

## Verification
- Build / test / lint commands.
```

### Step 3. Do not duplicate everything in `CLAUDE.md`

`CLAUDE.md` should point to `AGENT.md`:

```markdown
# CLAUDE.md

Main rules are in AGENT.md.
Claude-specific notes:
- read AGENT.md first;
- use Spec → Verifier → Environment;
- run checks before a PR.
```

This reduces the risk of the files drifting apart.

### Step 4. Fix verification commands

Even in a clean project there must be commands:

```bash
bun run build
npm test
npm run lint
```

or equivalents. If there are no tests yet, the agent docs should honestly say:

> “No tests yet; minimum is build + smoke test”.

### Step 5. Define boundaries

For a new project it is especially important to write in advance:

- can the agent change dependencies;
- can the agent change CI/CD;
- can the agent add external services;
- can the agent change the data schema;
- where are secrets stored;
- which files cannot be touched without permission.

### Step 6. Add a PR checklist

Example:

```markdown
## PR checklist
- [ ] Small scope.
- [ ] Build passes.
- [ ] Tests / lint pass.
- [ ] No secrets.
- [ ] README / agent docs updated if behavior changed.
```

## 4. Setup for an existing project / repository

For an existing project you cannot immediately write ideal rules “from scratch”. An audit is needed first.

### Step 1. Inventory

The agent should study:

```bash
find . -maxdepth 3 -type f
cat package.json
cat pyproject.toml
ls .github/workflows
```

and determine:

- real build / test commands;
- real entrypoints;
- where the business logic lives;
- which docs are stale;
- which generated files must not be touched;
- which CI limitations exist.

### Step 2. Find stale comments

Search:

```bash
grep -RInE 'TODO|FIXME|old|deprecated|Vite|webpack|no_options|provider|proxy' .
```

But do not fix mechanically. You need to understand what is actually stale.

### Step 3. Create agent docs based on facts

Do not write generic “best practices”. Describe this specific repo:

- real commands;
- real providers;
- real data schemas;
- real token / CI limitations;
- real PR rules.

### Step 4. Separate “fixes” from “improvements”

For an existing project it is important not to mix:

- bug fix;
- docs sync;
- refactor;
- feature;
- mass data refresh.

Better to use separate PRs if the changes are of different types.

### Step 5. Agree on danger zones

In an existing project the agent should ask before:

- changing `.github/workflows/*`;
- mass-changing `data/options/*.json`;
- changing the public schema;
- removing historical changelog sections;
- changing default provider / theme / UX;
- adding new external dependencies.

## 5. How to know the agentic setup is good

A good setup answers the questions:

1. What is this project?
2. Which files are the main ones?
3. How do I verify changes?
4. What can the agent do on its own?
5. Where is a user checkpoint needed?
6. What is forbidden?
7. How are secrets handled?
8. How do I push a PR?
9. What are the known pitfalls?
10. How do I keep docs up to date?

If a file contains only generic phrases like “write clean code”, it is almost useless.

## 6. Good starting prompt for a new project

```text
First read AGENT.md / CLAUDE.md if they exist.
If they do not exist, help create an agentic setup.
Work by Spec → Verifier → Environment.
Do not write code until you have asked questions and agreed on a plan.
```

## 7. Good starting prompt for an existing project

```text
First audit the repository.
Find the real build/test commands, entrypoints, data schemas, CI limitations.
Check AGENT.md / CLAUDE.md / README for stale comments.
Make a list of issues and ask me questions about scope.
Do not change code until I confirm the list.
```

## 8. How this is applied in Options Desk

In this repository the setup is organized as follows:

- `AGENT.md` — main contract for any AI agent (providers, greeks, never/autopilot).
- `CLAUDE.md` — short adapter for Claude Code (points to `AGENT.md`).
- `AGENTS.md` — compatibility checklist.
- `Setup.md` — this tutorial (portable how-to).

The rules are specifically tailored for Options Desk:

- static React / TypeScript + Parcel / Bun;
- **exactly 4 providers**, fixed dropdown order `CACHE, CBOE, NASDAQ, YAHOO`;
- default selection only: localhost → CBOE, GitHub Pages → CACHE;
- yfinance + Cboe **1st-order** in `options-data.py` for CACHE;
- **single source of truth** for model / higher-order greeks — `src/main.tsx` (never duplicate in Python);
- companion proxy (Bun / Cloudflare Worker) for CBOE / NASDAQ / YAHOO;
- GitHub Pages deploy + scheduled data refresh workflow;
- PAT limitation with `workflow` scope;
- forbid mass `data/` walk and mass data commit without explicit request.

Example of a good checkpoint question for this repo:

> “Higher-order greeks should be calculated only in the UI, while `options-data.py` keeps Cboe 1st-order — correct?”

Main idea: agent docs are a working contract, not ritual files. When architecture changes (providers, greeks ownership), **first** update `AGENT.md` / `CLAUDE.md` / `AGENTS.md`, then the code — or in the same PR, but do not leave docs stale.
