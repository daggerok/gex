#!/usr/bin/env bun
/// <reference types="node" />
/// <reference types="bun" />
/**
 * =============================================================================
 * GEX - squash of the data commits at the tip of main (Bun TypeScript)
 * =============================================================================
 *
 * The intensive mode of update-partial-data.yml commits the refreshed data on every run (every few minutes of a trading
 * day). This script keeps the history readable: it counts the DATA commits that sit one after another at the tip of the
 * branch (subject starts with `chore(data):`) and, when there are enough of them, replaces that whole run by ONE commit
 * with the same tree. Nothing else is rewritten: the run stops at the first commit that is not a data commit, so a code
 * commit never changes its hash, and the files are byte for byte the same before and after.
 *
 * WHEN IT SQUASHES
 *   - the run has SQUASH_AFTER commits or more (default 60), at any time of the day
 *   - FINAL=true (a run after the market close) and the run has at least 2 commits
 *
 * HOW (safe by construction)
 *   1. stop unless the local HEAD is the tip of origin/<branch> (`git ls-remote`; somebody pushed meanwhile: the next run squashes)
 *   2. `git fetch` the last commits of the branch WITHOUT their files (--filter=tree:0), so a shallow CI clone is enough
 *   3. `git commit-tree HEAD^{tree} -p <commit below the run>`: a new commit with today's tree
 *   4. `git push --force-with-lease=<branch>:<tip seen in 1>`: the push is refused when the branch moved after step 1,
 *      so a merge that lands in between is never lost
 *
 * This REWRITES the history of the branch. Every clone has to follow it, see README "After a squash of main".
 *
 * USAGE
 *   bun scripts/data-squash.ts                 # squash when the rule says so
 *   DRY_RUN=1 bun scripts/data-squash.ts       # print the decision, push nothing
 *
 * TUNABLES (env; in CI they come from the repository variables of the same names)
 *   SQUASH_AFTER   default 60   data commits at the tip that start a squash; 0 = never squash (also not on a final run)
 *   FINAL          default off  true = squash any run of 2 or more (the workflow passes its final flag)
 *   SQUASH_BRANCH  default GITHUB_REF_NAME, else main
 *   SQUASH_REMOTE  default origin
 *   DRY_RUN        default 0
 * =============================================================================
 */
import { spawnSync } from "node:child_process";

/** Subjects of the commits this script may fold together (the data workflows and the local runner write only these). */
export const DATA_SUBJECT_PREFIX = "chore(data):";

export function isDataSubject(subject: string): boolean {
    return subject.trimStart().startsWith(DATA_SUBJECT_PREFIX);
}

/** How many data commits sit one after another at the tip (`subjects` newest first). */
export function tipRun(subjects: readonly string[]): number {
    let n = 0;
    while (n < subjects.length && isDataSubject(subjects[n])) n++;
    return n;
}

export interface SquashRule {
    /** data commits at the tip */
    run: number;
    /** SQUASH_AFTER, 0 = off */
    after: number;
    /** a run after the market close */
    final: boolean;
}

export function squashDecision(r: SquashRule): { squash: boolean; why: string } {
    if (r.after <= 0) return { squash: false, why: "SQUASH_AFTER=0, squashing is off" };
    if (r.run < 2) return { squash: false, why: `${r.run} data commit(s) at the tip, nothing to squash` };
    if (r.run >= r.after) return { squash: true, why: `${r.run} data commits at the tip, the limit is ${r.after}` };
    if (r.final) return { squash: true, why: `final run of the day, ${r.run} data commits at the tip` };
    return { squash: false, why: `${r.run} data commits at the tip, below the limit of ${r.after}` };
}

/** SQUASH_AFTER: a whole number >= 0; blank = 60. Anything else is an error, never a silent default. */
export function parseSquashAfter(raw: string | undefined): number {
    const text = (raw ?? "").trim();
    if (text === "") return 60;
    if (!/^\d+$/.test(text)) throw new Error(`SQUASH_AFTER must be a whole number >= 0 (0 = off), got '${raw}'`);
    return Number(text);
}

export function isOn(raw: string | undefined): boolean {
    return ["1", "true", "yes", "on"].includes((raw ?? "").trim().toLowerCase());
}

export function squashMessage(count: number): string {
    return `${DATA_SUBJECT_PREFIX} squash ${count} data commits [skip ci]`;
}

/** Commits fetched to look for the run: enough for the limit and for a run that grew past it while squashes failed. */
export function scanDepth(after: number): number {
    return Math.max(after * 3, 200);
}

export interface SquashOptions {
    cwd: string;
    after: number;
    final: boolean;
    branch: string;
    remote: string;
    dryRun: boolean;
    log: (line: string) => void;
}

export interface SquashResult {
    squashed: boolean;
    count: number;
    why: string;
    commit?: string;
}

function git(cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

function must(cwd: string, args: string[]): string {
    const r = git(cwd, args);
    if (!r.ok) throw new Error(`git ${args.join(" ")} failed: ${r.err || r.out}`);
    return r.out;
}

export function squashTip(o: SquashOptions): SquashResult {
    if (o.after <= 0) {
        const d = squashDecision({ run: 0, after: o.after, final: o.final });
        return { squashed: false, count: 0, why: d.why };
    }
    const depth = scanDepth(o.after);
    const head = must(o.cwd, ["rev-parse", "HEAD"]);
    // ask the remote for its tip BEFORE fetching anything: when the branch moved there is nothing to do in this run
    const remoteTip = must(o.cwd, ["ls-remote", o.remote, `refs/heads/${o.branch}`]).split(/\s+/)[0] ?? "";
    if (remoteTip !== head) return { squashed: false, count: 0, why: `${o.remote}/${o.branch} moved to ${remoteTip.slice(0, 8)} (local HEAD ${head.slice(0, 8)}), the next run squashes` };
    // commits only (no trees, no files): the squash needs their subjects and ids, the tree it commits is HEAD's own
    const fetched = git(o.cwd, ["fetch", "-q", "--filter=tree:0", `--depth=${depth}`, o.remote, `+refs/heads/${o.branch}:refs/remotes/${o.remote}/${o.branch}`]);
    if (!fetched.ok) return { squashed: false, count: 0, why: `could not fetch the last ${depth} commits (${fetched.err.split("\n")[0]}), the next run squashes` };
    const tip = must(o.cwd, ["rev-parse", `refs/remotes/${o.remote}/${o.branch}`]);
    if (head !== tip) return { squashed: false, count: 0, why: `${o.remote}/${o.branch} moved to ${tip.slice(0, 8)} (local HEAD ${head.slice(0, 8)}), the next run squashes` };

    // "<hash> <subject>" lines, newest first, first parent only (main has no merge commits)
    const lines = must(o.cwd, ["log", "--first-parent", `-n${depth}`, "--format=%H %s", tip]).split("\n").filter(Boolean);
    const hashes = lines.map((l) => l.slice(0, l.indexOf(" ")));
    const subjects = lines.map((l) => l.slice(l.indexOf(" ") + 1));
    let run = tipRun(subjects);
    // the commit below the run must be known: a run that reaches the end of what was fetched keeps its oldest commit
    if (run >= lines.length) run = lines.length - 1;
    const decision = squashDecision({ run, after: o.after, final: o.final });
    if (!decision.squash) return { squashed: false, count: run, why: decision.why };

    const base = hashes[run];
    o.log(`squash: ${decision.why}; ${hashes[run - 1].slice(0, 8)}..${tip.slice(0, 8)} become one commit on ${base.slice(0, 8)}`);
    if (o.dryRun) return { squashed: false, count: run, why: "dry run, nothing pushed" };

    const commit = must(o.cwd, ["commit-tree", `${tip}^{tree}`, "-p", base, "-m", squashMessage(run)]);
    const push = git(o.cwd, ["push", "-q", `--force-with-lease=${o.branch}:${tip}`, o.remote, `${commit}:refs/heads/${o.branch}`]);
    if (!push.ok) return { squashed: false, count: run, why: `push refused (${o.remote}/${o.branch} moved meanwhile, nothing was rewritten): ${push.err.split("\n")[0]}` };
    // keep the clone on the new tip, a later step of the same job may commit again
    must(o.cwd, ["update-ref", `refs/remotes/${o.remote}/${o.branch}`, commit]);
    must(o.cwd, ["reset", "-q", "--soft", commit]);
    return { squashed: true, count: run, why: decision.why, commit };
}

if (require.main === module) {
    try {
        const env = process.env;
        const result = squashTip({
            cwd: process.cwd(),
            after: parseSquashAfter(env.SQUASH_AFTER),
            final: isOn(env.FINAL),
            branch: (env.SQUASH_BRANCH || env.GITHUB_REF_NAME || "main").trim(),
            remote: (env.SQUASH_REMOTE || "origin").trim(),
            dryRun: isOn(env.DRY_RUN),
            log: (line) => console.log(line),
        });
        console.log(result.squashed ? `squash: done, ${result.count} data commits are now ${result.commit?.slice(0, 8)}` : `squash: skipped, ${result.why}`);
    } catch (e) {
        console.error(`squash: ${(e as Error).message}`);
        process.exit(1);
    }
}
