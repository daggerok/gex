# Workflow

- Direct push to `main` is fine for low-risk agreed changes, use a PR when review is needed. Squash merges only
- Conventional Commits with a scope, e.g. `fix(gex): ...`
- Exploratory work goes to a background agent in an isolated worktree that writes `.claude/docs/spec-<topic>.md` (linked from `.claude/docs/README.md`), opens a PR and does NOT merge, the orchestrating session reviews and merges
- Agents commit incrementally and squash before the PR, use Sonnet unless asked otherwise
- Before touching git state with someone else's uncommitted changes: `git stash push -u`, work, `git stash pop`
- Subagent prompts must be self-contained, restate the relevant rules
