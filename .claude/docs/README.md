# .claude/docs - on-demand reference

These files are NOT loaded into context automatically. Read the one you need

| File | Read it when |
|---|---|
| `gex-levels.md` | you need the exact formula or source for any key level (Call Wall, Put Wall, Range High, Range Low, Gamma Flip, Max Pain, P/C ratio, Absolute Gamma), or you are asked "how did we calculate X" |
| `architecture.md` | you need the file layout, data flow, provider routing, caching, or the VIX / index-option handling |
| `maintenance.md` | you change anything and need to know what in `.claude/` to update, the context budget, or the sourcing standard |
| `spec-gex-app.md`, `spec-index-options.md`, `spec-vix-futures.md` | you need original requirements, research evidence, data-source facts, or a section number cited in a code comment ("plan section 7.4", "research plan 5.5") |
| `decisions.md` | you want to know why something is the way it is, what was tried and removed, or you are about to change a level's algorithm |

Always-loaded rules live next to this folder in `.claude/rules/`. The old `.plans/` folder was folded into the `spec-*.md` files, each has its own limitations section
