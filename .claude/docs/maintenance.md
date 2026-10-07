# Keeping the agentic setup current

Applies on EVERY change, not only algorithm changes

## What to update

- Behavior, algorithm or constant: the matching section of `gex-levels.md` or `architecture.md`, plus a dated entry in `decisions.md` with what changed and why
- Rename, move or delete of a file or symbol: every reference in `.claude/rules/`, `.claude/docs/`, code doc comments, `README.md` and `docs/`
- New rule that must always apply: `.claude/rules/` (keep it to one line, it costs context every session). Long explanation or history: `.claude/docs/`, linked from `README.md` here
- New or changed UI text: both `en` and `ru` in `src/i18n.tsx`

## Context budget

- `rules/*.md` without `paths:` load every session, so keep them short, rules only, no history or derivations
- `rules/*.md` with `paths:` load when matching files are read
- `docs/*.md` never load by themselves, put detail here

## Honesty about sources

Every GEX number is a model approximation, not measured dealer positioning. For each level state in its doc comment and in `gex-levels.md` either the source with a direct quote and where it came from, or that the rule is an original heuristic. Do not present an invented rule as an industry standard. The UI tooltips for Range High and Range Low already say so, keep them in sync with the rule

## Reference check

`src/claude-docs.test.ts` verifies that repo paths written in backticks inside `.claude/**/*.md` exist (a trailing `:123` line suffix is ignored) and that non-glob `paths:` entries in rule frontmatter exist. Run `bun test` after any rename
