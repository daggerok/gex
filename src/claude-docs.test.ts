import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Keeps the agentic setup honest: every repo path referenced from .claude/
// (rules, docs) must still exist, so renames/deletes can't silently leave
// stale references behind. See .claude/rules/project.md ("Keep the agentic
// setup in sync").

const ROOT = join(import.meta.dir, '..');
const CLAUDE_DIR = join(ROOT, '.claude');
const REPO_PREFIXES = ['src/', 'scripts/', '.claude/', 'data/', '.github/', 'docs/'];

function markdownFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        if (name === 'worktrees') return []; // git-ignored scratch space
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return markdownFiles(full);
        return full.endsWith('.md') ? [full] : [];
    });
}

function referencedPaths(markdown: string): string[] {
    const refs = new Set<string>();
    for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
        // strip a trailing ":123" or ":123-130" line reference
        const token = match[1].trim().replace(/:\d+(-\d+)?$/, '');
        if (/[\s*<>{}()$=]/.test(token)) continue; // globs, commands, code
        if (!REPO_PREFIXES.some((p) => token.startsWith(p))) continue;
        if (token.endsWith('/')) continue; // directory mention, checked below
        refs.add(token);
    }
    return [...refs];
}

describe('.claude agentic setup references', () => {
    const files = markdownFiles(CLAUDE_DIR);

    test('there are rules and docs to check', () => {
        expect(files.some((f) => f.includes('/rules/'))).toBe(true);
        expect(files.some((f) => f.includes('/docs/'))).toBe(true);
    });

    for (const file of files) {
        test(`every repo path referenced in ${file.slice(ROOT.length + 1)} exists`, () => {
            const missing = referencedPaths(readFileSync(file, 'utf8')).filter((p) => !existsSync(join(ROOT, p)));
            expect(missing).toEqual([]);
        });
    }

    test('every `paths:` glob target in rules frontmatter exists', () => {
        for (const file of files.filter((f) => f.includes('/rules/'))) {
            const front = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
            if (!front) continue;
            const globs = [...front[1].matchAll(/^\s*-\s+(\S+)\s*$/gm)].map((m) => m[1]);
            const missing = globs.filter((g) => !g.includes('*') && !existsSync(join(ROOT, g)));
            expect(missing).toEqual([]);
        }
    });
});
