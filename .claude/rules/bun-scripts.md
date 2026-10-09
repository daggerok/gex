---
paths:
  - scripts/**/*.ts
  - src/options-data.test.ts
  - src/data-paths.test.ts
---

# Bun scripts: keep the reference directives

- Every Bun-style `.ts` file (top-level `node:*` imports, `Bun.*`, `bun:test`, `process`, `import.meta.main` or `import.meta.dirname`) carries `/// <reference types="bun" />` and, when it uses `node:*` or `process`, `/// <reference types="node" />`, placed right before the file's own imports (after the header comment). Never delete, move or reorder them
- Why: the owner opens the repo in IntelliJ without a `tsconfig.json`, so it loads no `@types` on its own and flags the file with TS2591 (`Cannot find name 'node:fs'`, `'process'`) even though `@types/bun` and `@types/node` are installed. `bun test` and `bun run` do not care, which is how such errors go unnoticed. The same convention holds in the sibling repos (Stocks, ETFs hub and the ETF provider repos, see their `reference-types.md`)
- `@types/bun` and `@types/node` stay in `devDependencies`, never in `dependencies`. Scripts import only `node:` built-ins and use the global `fetch`, no npm packages
- Verify after editing a script: `../ETFs/.claude/tools/tc/check.sh . scripts/<file>.ts` (mirrors IntelliJ: no automatic `@types`, only the reference directives) prints nothing when clean
- Executable scripts keep the `#!/usr/bin/env bun` shebang and `chmod +x`
