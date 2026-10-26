#!/usr/bin/env bun
/**
 * Local data runner (owner, 2026-10-26): the frequent data work runs on the owner's Mac, GitHub keeps only rare schedules.
 *
 * WHY: the hourly refresh of GitHub Actions fires 2 or 3 of its 9 weekday slots, late; the laptop runs every slot (launchd
 * also runs a slot missed during sleep once after wake), and its pushes keep the repository active, so GitHub never disables
 * the remaining schedules (60 days without activity). All fetch logic stays in scripts/options-data.ts; this module only
 * schedules it, commits the same files the workflows commit and pushes them.
 *
 * WHERE IT RUNS: a dedicated worktree on origin/main (default `<parent of the checkout>/.worktrees/<repo>/data-runner`, a
 * detached HEAD), never the owner's checkout. Every run resets it to origin/main first (only when it holds no unpushed commit).
 *
 * COMMANDS (package.json `data:*`, `bun scripts/data-local.ts help`):
 *   setup                 first time and repair: checks bun, git, gh and the network, creates or repairs the runner worktree,
 *                         writes and loads the launchd agent, runs a dry check of the partial job, prints the status
 *   status                schedule, next and last run per job, last pushed data commit, lock, log size
 *   logs [-n N]           follow the log (with -n N: print the last N lines and stop)
 *   run <job> [--dry-run] run a job now in the foreground (jobs: partial, weekly, backup [tickers], deps)
 *   pause | resume        unload or load the launchd agent, the plist stays
 *   uninstall             unload the agent and delete its plist
 *   advanced: install, unlock, runner, migrate (each also part of setup or of a run); --no-load and --dry-run never touch launchd
 *
 * JOBS (the same work as the workflows):
 *   partial  update-partial-data.yml: the default tickers; from 16:30 New York time a FINAL run that writes and commits the
 *            day zip (api/history) and api/latest.json; every run then asks GitHub for a Pages deploy (the deploy refreshes
 *            the default tickers itself, the hourly JSON is never committed). Scheduled by launchd at the old New York slots
 *   weekly   update-data.yml: defaults + api/All.txt + ROTATE_STALE=500, commits api/, starts the Pages deploy. Manual here
 *            (GitHub runs it on Saturday)
 *   backup   backtest-backup.yml: one backup zip of the given tickers (default the preset), commits api/history. Manual here
 *   deps     npm-check-updates.yml: lists the newer dependency versions, changes nothing. Manual here
 *
 * SAFETY: one run at a time (lock file with the pid; a lock whose pid is dead is removed by the next run), a run skips
 * quietly when offline, a rejected push is retried once after a rebase on origin/main (the fresh data wins), a second
 * failure marks the run failed in the status and leaves the commit in the runner (the next run stops and says so).
 *
 * STATE (owner, 2026-10-26): log, state and lock live in `gex-data-state/` next to the main checkout, outside every repo:
 * if the checkout is `<workspace>/gex`, then `<workspace>/gex-data-state` (`../gex-data-state` from the gex folder), with
 * `gex-data.log`, `state.json` and `run.lock` inside. It is resolved from the main checkout (`git rev-parse --git-common-dir`),
 * never from the runner worktree, which is reset every run. `data:status` prints the resolved absolute path. `data:setup`
 * moves the files of the first version (~/Library/Logs/gex-data.log, ~/Library/Application Support/gex-data/) there once.
 *
 * ENV: GEX_DATA_RUNNER (worktree path), GEX_DATA_HOME (lock and state, default `../gex-data-state` next to the checkout),
 * GEX_DATA_LOG (default `<GEX_DATA_HOME>/gex-data.log`), GEX_DATA_PLIST (default ~/Library/LaunchAgents/<label>.plist),
 * GEX_DATA_LABEL (default com.daggerok.gex-data), HISTORY_KEEP_DAYS / HISTORY_KEEP_BACKUP_DAYS (passed to the fetcher).
 */

/// <reference types="bun" />
/// <reference types="node" />

import { spawn, spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export const NY_TZ = "America/New_York";
export type Job = "partial" | "weekly" | "backup" | "deps";
export const JOBS: Job[] = ["partial", "weekly", "backup", "deps"];
export type Env = Record<string, string | undefined>;

// ---- Slots and time zones (pure) -------------------------------------------------------------

/** A launchd calendar slot: weekday 0 = Sunday .. 6 = Saturday, hour and minute of the wall clock. */
export interface Slot {
    weekday: number;
    hour: number;
    minute: number;
}

/**
 * The New York slots of the partial job, the old hourly GitHub schedule: Monday to Friday 8:45, 9:45 ... 16:45 (before the
 * open, then every hour) and 17:15, 18:15, 19:15 after the close (final runs).
 */
export function partialSlotsNy(): Slot[] {
    const out: Slot[] = [];
    for (let weekday = 1; weekday <= 5; weekday++) {
        for (let hour = 8; hour <= 16; hour++) out.push({ weekday, hour, minute: 45 });
        for (let hour = 17; hour <= 19; hour++) out.push({ weekday, hour, minute: 15 });
    }
    return out;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Wall clock of `date` in `tz`. */
export function wallClock(date: Date, tz: string): { year: number; month: number; day: number; weekday: number; hour: number; minute: number } {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return {
        year: Number(get("year")),
        month: Number(get("month")),
        day: Number(get("day")),
        weekday: WEEKDAYS.indexOf(get("weekday")),
        hour: Number(get("hour")) % 24,
        minute: Number(get("minute")),
    };
}

/** Minutes `tz` is ahead of UTC at `date` (New York: -240 in summer, -300 in winter). */
export function tzOffsetMinutes(date: Date, tz: string): number {
    const w = wallClock(date, tz);
    const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
    return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/** The instant of a wall clock time in `tz` (two passes settle the offset around a DST switch). */
export function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    let t = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
    t = guess - tzOffsetMinutes(new Date(t), tz) * 60000;
    return new Date(t);
}

/** The next instant (strictly after `now`) of a New York slot. */
export function nextNyInstant(slot: Slot, now: Date): Date {
    const ny = wallClock(now, NY_TZ);
    for (let add = 0; add <= 7; add++) {
        const base = new Date(Date.UTC(ny.year, ny.month - 1, ny.day + add));
        if (base.getUTCDay() !== slot.weekday) continue;
        const at = zonedInstant(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), slot.hour, slot.minute, NY_TZ);
        if (at.getTime() > now.getTime()) return at;
    }
    const base = new Date(Date.UTC(ny.year, ny.month - 1, ny.day + 7));
    return zonedInstant(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), slot.hour, slot.minute, NY_TZ);
}

/**
 * The local wall clock slot launchd needs for a New York slot (launchd reads StartCalendarInterval in the Mac's own time zone).
 * Identity when the Mac is on New York time. In another zone it is right for the DST state at `ref`; in the weeks when the two
 * zones switch on different dates it is an hour off, and the partial job's own New York window guard catches that (setup
 * again after a switch rewrites the plist).
 */
export function nySlotToLocal(slot: Slot, localTz: string, ref: Date): Slot {
    if (localTz === NY_TZ) return { ...slot };
    const w = wallClock(nextNyInstant(slot, ref), localTz);
    return { weekday: w.weekday, hour: w.hour, minute: w.minute };
}

/** Next run of the earliest slot after `now`. */
export function nextRun(slots: Slot[], now: Date): Date | null {
    let best: Date | null = null;
    for (const s of slots) {
        const t = nextNyInstant(s, now);
        if (!best || t.getTime() < best.getTime()) best = t;
    }
    return best;
}

/**
 * The partial job's New York window (the same rule as the workflow's "Market window" step): a scheduled run on a weekday
 * from 8:40 to 23:59 runs, one from 16:30 is final (writes and commits the day zip). A manual run always runs.
 */
export function partialWindow(ny: { weekday: number; hour: number; minute: number }, scheduled: boolean): { run: boolean; final: boolean; why: string } {
    const mins = ny.hour * 60 + ny.minute;
    const final = mins >= 16 * 60 + 30;
    if (!scheduled) return { run: true, final, why: "manual run" };
    if (ny.weekday === 0 || ny.weekday === 6) return { run: false, final, why: "weekend in New York" };
    if (mins < 8 * 60 + 40) return { run: false, final, why: "before 8:40 New York time" };
    return { run: true, final, why: "inside the market window" };
}

// ---- launchd plist (pure) --------------------------------------------------------------------

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface PlistSpec {
    label: string;
    programArguments: string[];
    workingDirectory: string;
    env: Record<string, string>;
    slots: Slot[];
    logPath: string;
}

/** The launchd agent: StartCalendarInterval with one dict per slot (local time), stdout and stderr to the log, no RunAtLoad. */
export function buildPlist(p: PlistSpec): string {
    const lines: string[] = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
        `<plist version="1.0">`,
        `<dict>`,
        `  <key>Label</key>`,
        `  <string>${xml(p.label)}</string>`,
        `  <key>ProgramArguments</key>`,
        `  <array>`,
    ];
    for (const a of p.programArguments) lines.push(`    <string>${xml(a)}</string>`);
    lines.push(`  </array>`, `  <key>WorkingDirectory</key>`, `  <string>${xml(p.workingDirectory)}</string>`);
    lines.push(`  <key>EnvironmentVariables</key>`, `  <dict>`);
    Object.keys(p.env)
        .sort()
        .forEach((k) => lines.push(`    <key>${xml(k)}</key>`, `    <string>${xml(p.env[k])}</string>`));
    lines.push(`  </dict>`, `  <key>StartCalendarInterval</key>`, `  <array>`);
    for (const s of p.slots) {
        lines.push(
            `    <dict><key>Weekday</key><integer>${s.weekday}</integer><key>Hour</key><integer>${s.hour}</integer><key>Minute</key><integer>${s.minute}</integer></dict>`,
        );
    }
    lines.push(
        `  </array>`,
        `  <key>RunAtLoad</key>`,
        `  <false/>`,
        `  <key>StandardOutPath</key>`,
        `  <string>${xml(p.logPath)}</string>`,
        `  <key>StandardErrorPath</key>`,
        `  <string>${xml(p.logPath)}</string>`,
        `</dict>`,
        `</plist>`,
        ``,
    );
    return lines.join("\n");
}

// ---- Paths and settings ----------------------------------------------------------------------

export interface Paths {
    label: string;
    plist: string;
    log: string;
    home: string;
    lock: string;
    state: string;
    runner: string;
    checkout: string;
}

/** The runner worktree next to the owner's checkout: <parent>/.worktrees/<repo>/data-runner. */
export function defaultRunnerPath(checkout: string): string {
    return join(dirname(checkout), ".worktrees", basename(checkout), "data-runner");
}

function git(cwd: string, args: string[], quiet = true): { ok: boolean; out: string; err: string } {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (!quiet && r.stderr) process.stderr.write(r.stderr);
    return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

/** The owner's main checkout (the folder holding the shared .git), from any worktree of the repo. */
export function mainCheckout(): string {
    const here = join(__dirname, "..");
    const common = git(here, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    return common.ok ? dirname(common.out) : here;
}

/** Log, state and lock next to the main checkout, outside every repo: <workspace>/gex -> <workspace>/gex-data-state. */
export const STATE_DIR = "gex-data-state";
export const LOG_NAME = "gex-data.log";

export function defaultStateDir(checkout: string): string {
    return join(dirname(checkout), STATE_DIR);
}

export function resolvePaths(env: Env, checkout: string): Paths {
    const label = env.GEX_DATA_LABEL || "com.daggerok.gex-data";
    const home = resolve(env.GEX_DATA_HOME || defaultStateDir(checkout));
    return {
        label,
        plist: env.GEX_DATA_PLIST || join(homedir(), "Library", "LaunchAgents", `${label}.plist`),
        log: resolve(env.GEX_DATA_LOG || join(home, LOG_NAME)),
        home,
        lock: join(home, "run.lock"),
        state: join(home, "state.json"),
        runner: env.GEX_DATA_RUNNER || defaultRunnerPath(checkout),
        checkout,
    };
}

// ---- Lock and state --------------------------------------------------------------------------

export interface LockInfo {
    pid: number;
    job: string;
    started: string;
}

export function pidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // EPERM: the process exists but belongs to someone else
        return (e as { code?: string }).code === "EPERM";
    }
}

/** What to do with an existing lock: take it (no lock or an unreadable one), remove a stale one (dead pid), or wait. */
export function lockDecision(text: string | null, alive: (pid: number) => boolean): { action: "take" | "stale" | "held"; info: LockInfo | null } {
    if (text === null) return { action: "take", info: null };
    let info: LockInfo | null = null;
    try {
        info = JSON.parse(text) as LockInfo;
    } catch {
        return { action: "stale", info: null };
    }
    if (!info || typeof info.pid !== "number") return { action: "stale", info: null };
    return { action: alive(info.pid) ? "held" : "stale", info };
}

function readText(path: string): string | null {
    try {
        return readFileSync(path, "utf8");
    } catch {
        return null;
    }
}

export type Result = "ok" | "failed" | "skipped";
export interface RunRecord {
    started: string;
    seconds: number;
    result: Result;
    why: string;
}
export type State = Partial<Record<Job, RunRecord>>;

export function readState(p: Paths): State {
    try {
        return JSON.parse(readFileSync(p.state, "utf8")) as State;
    } catch {
        return {};
    }
}

function writeState(p: Paths, job: Job, rec: RunRecord): void {
    const s = readState(p);
    s[job] = rec;
    mkdirSync(p.home, { recursive: true });
    writeFileSync(`${p.state}.tmp`, `${JSON.stringify(s, null, 2)}\n`);
    renameSync(`${p.state}.tmp`, p.state);
}

/** Removes a lock whose pid is dead. Returns what it found, for the messages. */
export function unlockStale(p: Paths): { removed: boolean; held: LockInfo | null } {
    const d = lockDecision(readText(p.lock), pidAlive);
    if (d.action === "stale") {
        try {
            unlinkSync(p.lock);
        } catch {
            /* already gone */
        }
        return { removed: true, held: null };
    }
    return { removed: false, held: d.action === "held" ? d.info : null };
}

// ---- Migration from the first version (PR #240 kept the files under ~/Library) -----------------

/** Where the first version kept the log, state and lock. */
export function legacyPaths(userHome: string): { dir: string; log: string; state: string; lock: string } {
    const dir = join(userHome, "Library", "Application Support", "gex-data");
    return { dir, log: join(userHome, "Library", "Logs", LOG_NAME), state: join(dir, "state.json"), lock: join(dir, "run.lock") };
}

export interface MigrationPlan {
    moves: { from: string; to: string }[];
    /** Old files left in place because the new place already has one (the new one wins). */
    kept: { from: string; to: string }[];
}

/** Which old files move: each that exists, unless it is already the new path or the new path exists. The lock never moves. */
export function migrationPlan(p: Paths, legacy: ReturnType<typeof legacyPaths>, exists: (path: string) => boolean): MigrationPlan {
    const plan: MigrationPlan = { moves: [], kept: [] };
    for (const [from, to] of [
        [legacy.log, p.log],
        [legacy.state, p.state],
    ] as const) {
        if (from === to || !exists(from)) continue;
        (exists(to) ? plan.kept : plan.moves).push({ from, to });
    }
    return plan;
}

function moveFile(from: string, to: string): void {
    mkdirSync(dirname(to), { recursive: true });
    try {
        renameSync(from, to);
    } catch (e) {
        if ((e as { code?: string }).code !== "EXDEV") throw e;
        copyFileSync(from, to);
        unlinkSync(from);
    }
}

/** Moves the old files once (data:setup and `migrate`); refuses while an old run still holds the old lock. */
export function migrateLegacy(p: Paths, legacy: ReturnType<typeof legacyPaths>, log: (s: string) => void): boolean {
    const lock = lockDecision(readText(legacy.lock), pidAlive);
    if (lock.action === "held") {
        log(`migrate: a run of the old setup is going on (pid ${lock.info?.pid}); run bun run data:setup again when it ends`);
        return false;
    }
    const plan = migrationPlan(p, legacy, existsSync);
    for (const m of plan.moves) {
        moveFile(m.from, m.to);
        log(`migrate: moved ${m.from} -> ${m.to}`);
    }
    for (const k of plan.kept) log(`migrate: kept ${k.to}; the old ${k.from} stays, delete it by hand if you do not need it`);
    if (lock.action === "stale") unlinkSync(legacy.lock);
    try {
        if (existsSync(legacy.dir) && readdirSync(legacy.dir).length === 0) rmdirSync(legacy.dir);
    } catch {
        /* not empty or not ours: leave it */
    }
    return true;
}

// ---- Runner worktree -------------------------------------------------------------------------

/**
 * Creates or repairs the runner worktree and puts it on the newest origin/main. Throws with a readable message (and the next
 * step) when it holds commits that are not on origin/main: those are never thrown away.
 */
export function ensureRunner(p: Paths, log: (s: string) => void): void {
    if (!git(p.checkout, ["fetch", "-q", "origin", "main"]).ok) throw new Error(`git fetch origin main failed in ${p.checkout}; check the network and \`git -C ${p.checkout} remote -v\``);
    if (!existsSync(p.runner)) {
        mkdirSync(dirname(p.runner), { recursive: true });
        // -f: the path may still be registered from a worktree folder that was deleted by hand
        const r = git(p.checkout, ["worktree", "add", "-f", "--detach", p.runner, "origin/main"]);
        if (!r.ok) throw new Error(`could not create the runner worktree ${p.runner}: ${r.err}`);
        log(`runner: created ${p.runner} on origin/main`);
        return;
    }
    const top = git(p.runner, ["rev-parse", "--show-toplevel"]);
    if (!top.ok || top.out !== p.runner.replace(/\/$/, "")) {
        const repaired = git(p.checkout, ["worktree", "repair", p.runner]);
        if (!repaired.ok || !git(p.runner, ["rev-parse", "--show-toplevel"]).ok) {
            throw new Error(`${p.runner} exists but is not a worktree of ${p.checkout}. Move it away (it is not deleted for you) and run \`bun run data:setup\` again`);
        }
        log(`runner: repaired the worktree link of ${p.runner}`);
    }
    git(p.runner, ["fetch", "-q", "origin", "main"]);
    const ahead = git(p.runner, ["rev-list", "--count", "origin/main..HEAD"]);
    if (ahead.ok && Number(ahead.out) > 0) {
        const list = git(p.runner, ["log", "--oneline", "origin/main..HEAD"]).out;
        throw new Error(
            `the runner holds ${ahead.out} commit(s) that are not on origin/main (a push failed earlier):\n${list}\n` +
                `push them: git -C ${p.runner} push origin HEAD:main  (or drop them: git -C ${p.runner} reset --hard origin/main), then run again`,
        );
    }
    // only data the runner itself wrote can be here: put it back on origin/main
    git(p.runner, ["reset", "-q", "--hard", "origin/main"]);
    git(p.runner, ["clean", "-fdq", "--", "api"]);
}

// ---- Jobs -----------------------------------------------------------------------------------

export interface JobPlan {
    /** Command and arguments, run in the runner. */
    command: string[];
    env: Record<string, string>;
    /** Paths to stage after the run (none = commit nothing). */
    commit: string[];
    message: string;
    /** Ask GitHub for a Pages deploy after the run (only when not a dry run). */
    deploy: "always" | "pushed" | "never";
}

/** What a job runs, mirroring its workflow. Pure, for tests. */
export function planJob(job: Job, o: { final: boolean; dryRun: boolean; tickers: string[]; allTxt: string; env: Env }): JobPlan {
    const keep = (k: string) => o.env[k] || "14";
    const dry: Record<string, string> = o.dryRun ? { DRY_RUN: "1" } : {};
    if (job === "partial") {
        return {
            command: ["bun", "scripts/options-data.ts"],
            env: {
                MAX_EXPIRATIONS: "15",
                KEEP_EXPIRATIONS: "1",
                CONCURRENCY: "4",
                REQUEST_SLEEP: "0.1",
                HISTORY: o.final ? "1" : "0",
                HISTORY_KEEP_DAYS: keep("HISTORY_KEEP_DAYS"),
                HISTORY_KEEP_BACKUP_DAYS: keep("HISTORY_KEEP_BACKUP_DAYS"),
                ...dry,
            },
            commit: o.final ? ["api/history", "api/latest.json"] : [],
            message: "chore(data): archive the trading day [skip ci]",
            deploy: "always",
        };
    }
    if (job === "weekly") {
        return {
            command: ["bun", "scripts/options-data.ts"],
            env: { TICKERS: o.allTxt.split(/\s+/).filter(Boolean).join(" "), ROTATE_STALE: "500", MAX_FETCHES: "500", MAX_EXPIRATIONS: "50", REQUEST_SLEEP: "0.5", ...dry },
            commit: ["api"],
            message: "chore(data): refresh option chains [skip ci]",
            deploy: "pushed",
        };
    }
    if (job === "backup") {
        return {
            command: o.dryRun ? ["echo", "dry run: would run bun scripts/backtest-backup.ts", ...o.tickers] : ["bun", "scripts/backtest-backup.ts", ...o.tickers],
            env: {},
            commit: ["api/history"],
            message: "chore(data): backtest backup [skip ci]",
            deploy: "never",
        };
    }
    return { command: ["bunx", "npm-check-updates"], env: {}, commit: [], message: "", deploy: "never" };
}

async function online(): Promise<boolean> {
    try {
        await Promise.all([lookup("github.com"), lookup("query2.finance.yahoo.com")]);
        return true;
    } catch {
        return false;
    }
}

function nowNy(): ReturnType<typeof wallClock> {
    return wallClock(new Date(), NY_TZ);
}

/** Runs a command in the runner with live output; also appends it to the log when not started by launchd. */
function runLive(cmd: string[], cwd: string, env: Record<string, string>, tee: string | null): Promise<number> {
    return new Promise((resolve) => {
        const child = spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
        const out = (chunk: Buffer, to: NodeJS.WriteStream) => {
            to.write(chunk);
            if (tee) appendFileSync(tee, chunk);
        };
        child.stdout.on("data", (c: Buffer) => out(c, process.stdout));
        child.stderr.on("data", (c: Buffer) => out(c, process.stderr));
        child.on("error", (e) => {
            process.stderr.write(`${e.message}\n`);
            resolve(127);
        });
        child.on("close", (code) => resolve(code ?? 1));
    });
}

/** Commit and push with one retry after a rebase on origin/main (-X theirs: the commit being replayed, the fresh data, wins). */
function commitAndPush(p: Paths, plan: JobPlan, log: (s: string) => void): { pushed: boolean; why: string } {
    const paths = plan.commit.filter((x) => existsSync(join(p.runner, x)));
    if (!paths.length) return { pushed: false, why: "nothing to commit" };
    git(p.runner, ["add", "--", ...paths]);
    if (git(p.runner, ["diff", "--staged", "--quiet"]).ok) return { pushed: false, why: "nothing changed" };
    const commit = git(p.runner, ["commit", "-q", "-m", plan.message]);
    if (!commit.ok) throw new Error(`git commit failed: ${commit.err}`);
    if (git(p.runner, ["push", "-q", "origin", "HEAD:main"]).ok) return { pushed: true, why: "pushed" };
    log("push rejected, rebasing on origin/main and retrying once");
    git(p.runner, ["fetch", "-q", "origin", "main"]);
    if (!git(p.runner, ["rebase", "-q", "-X", "theirs", "origin/main"]).ok) {
        git(p.runner, ["rebase", "--abort"]);
        throw new Error(`rebase on origin/main failed; the commit stays in ${p.runner}, the next run stops until it is pushed or dropped`);
    }
    const again = git(p.runner, ["push", "-q", "origin", "HEAD:main"]);
    if (!again.ok) throw new Error(`push failed twice (${again.err}); the commit stays in ${p.runner}, the next run stops until it is pushed or dropped`);
    return { pushed: true, why: "pushed after a rebase" };
}

function requestDeploy(p: Paths, log: (s: string) => void): void {
    const r = spawnSync("gh", ["workflow", "run", "github-pages.yml", "--ref", "main"], { cwd: p.runner, encoding: "utf8" });
    if (r.status === 0) log("pages: deploy requested (github-pages.yml refreshes the default tickers and publishes)");
    else log(`pages: WARNING the deploy request failed (${(r.stderr || r.error?.message || "").trim()}); check \`gh auth status\``);
}

export async function runJob(p: Paths, job: Job, opts: { dryRun: boolean; scheduled: boolean; tickers: string[] }): Promise<Result> {
    const started = new Date();
    const tee = opts.scheduled ? null : p.log;
    const say = (s: string) => {
        const line = `[ ${new Date().toISOString()} ] ${job}: ${s}\n`;
        process.stdout.write(line);
        if (tee) {
            mkdirSync(dirname(tee), { recursive: true });
            appendFileSync(tee, line);
        }
    };
    const finish = (result: Result, why: string): Result => {
        say(`${result} - ${why}`);
        writeState(p, job, { started: started.toISOString(), seconds: Math.round((Date.now() - started.getTime()) / 1000), result, why });
        return result;
    };
    const window = partialWindow(nowNy(), opts.scheduled);
    if (job === "partial" && !window.run) return finish("skipped", window.why);

    mkdirSync(p.home, { recursive: true });
    const stale = unlockStale(p);
    if (stale.removed) say("removed a stale lock (its process is gone)");
    if (stale.held) return finish("skipped", `locked by pid ${stale.held.pid} (${stale.held.job} since ${stale.held.started})`);
    writeFileSync(p.lock, JSON.stringify({ pid: process.pid, job, started: started.toISOString() }));
    try {
        if (!(await online())) return finish("skipped", "offline");
        ensureRunner(p, say);
        const allTxt = readText(join(p.runner, "api", "All.txt")) ?? "";
        const plan = planJob(job, { final: window.final, dryRun: opts.dryRun, tickers: opts.tickers, allTxt, env: process.env });
        say(`start${opts.dryRun ? " (dry run)" : ""}${job === "partial" ? (window.final ? " final run" : " intraday run") : ""}: ${plan.command.join(" ")}`);
        const code = await runLive(plan.command, p.runner, plan.env, tee);
        if (code !== 0) return finish("failed", `${plan.command.join(" ")} exited with ${code}`);
        if (opts.dryRun) return finish("ok", "dry run, nothing committed or pushed");
        const pushed = commitAndPush(p, plan, say);
        if (plan.deploy === "always" || (plan.deploy === "pushed" && pushed.pushed)) requestDeploy(p, say);
        git(p.runner, ["reset", "-q", "--hard", "origin/main"]);
        git(p.runner, ["clean", "-fdq", "--", "api"]);
        return finish("ok", pushed.why);
    } catch (e) {
        return finish("failed", e instanceof Error ? e.message : String(e));
    } finally {
        try {
            const held = lockDecision(readText(p.lock), pidAlive);
            if (held.info?.pid === process.pid) unlinkSync(p.lock);
        } catch {
            /* lock already gone */
        }
    }
}

// ---- launchd ---------------------------------------------------------------------------------

function which(cmd: string): string | null {
    const r = spawnSync("/usr/bin/which", [cmd], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
}

export function localTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function plistSpec(p: Paths): PlistSpec {
    const tools = [which("git"), which("gh")].filter((x): x is string => !!x).map((x) => dirname(x));
    const dirs = [dirname(process.execPath), ...tools];
    const path = Array.from(new Set([...dirs, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])).join(":");
    const tz = localTimeZone();
    const now = new Date();
    return {
        label: p.label,
        programArguments: [process.execPath, join(p.runner, "scripts", "data-local.ts"), "run", "partial", "--scheduled"],
        workingDirectory: p.runner,
        env: {
            PATH: path,
            GEX_DATA_RUNNER: p.runner,
            GEX_DATA_HOME: p.home,
            GEX_DATA_LOG: p.log,
        },
        slots: partialSlotsNy().map((s) => nySlotToLocal(s, tz, now)),
        logPath: p.log,
    };
}

function launchctl(args: string[], dry: boolean): boolean {
    if (dry) {
        console.log(`(dry run) launchctl ${args.join(" ")}`);
        return true;
    }
    const r = spawnSync("launchctl", args, { encoding: "utf8" });
    return r.status === 0;
}

const domain = () => `gui/${process.getuid ? process.getuid() : 501}`;

export function agentLoaded(p: Paths): boolean {
    return spawnSync("launchctl", ["print", `${domain()}/${p.label}`], { stdio: "ignore" }).status === 0;
}

function install(p: Paths, noLoad: boolean): boolean {
    mkdirSync(dirname(p.plist), { recursive: true });
    mkdirSync(dirname(p.log), { recursive: true });
    writeFileSync(p.plist, buildPlist(plistSpec(p)));
    const lint = spawnSync("plutil", ["-lint", p.plist], { encoding: "utf8" });
    console.log(`plist: ${p.plist} (${(lint.stdout || lint.stderr).trim()})`);
    if (lint.status !== 0) {
        console.log("next: the plist is invalid, report it; nothing was loaded");
        return false;
    }
    if (noLoad) {
        console.log("(--no-load) launchd not touched");
        return true;
    }
    if (agentLoaded(p)) launchctl(["bootout", `${domain()}/${p.label}`], false);
    if (!launchctl(["bootstrap", domain(), p.plist], false)) {
        console.log(`next: launchctl bootstrap failed; try \`launchctl bootstrap ${domain()} "${p.plist}"\` by hand and check Console.app`);
        return false;
    }
    console.log(`launchd: ${p.label} loaded`);
    return true;
}

// ---- Status, logs, help ----------------------------------------------------------------------

const fmt = (d: Date, tz: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(d);

function status(p: Paths): void {
    const tz = localTimeZone();
    const installed = existsSync(p.plist);
    const loaded = installed && agentLoaded(p);
    console.log(`schedule   ${installed ? (loaded ? "installed and running" : "installed but PAUSED (bun run data:resume)") : "not installed (bun run data:setup)"}`);
    console.log(`           plist ${p.plist}`);
    console.log(`runner     ${existsSync(p.runner) ? p.runner : `${p.runner} (missing, data:setup creates it)`}`);
    console.log(`state dir  ${p.home}${existsSync(p.home) ? "" : " (created by the first run)"}`);
    const old = migrationPlan(p, legacyPaths(homedir()), existsSync);
    if (old.moves.length) console.log(`           old files to move: ${old.moves.map((m) => m.from).join(", ")} (bun run data:setup moves them)`);
    const next = nextRun(partialSlotsNy(), new Date());
    const state = readState(p);
    console.log("jobs");
    JOBS.forEach((job) => {
        const when =
            job === "partial" && next
                ? `next ${fmt(next, NY_TZ)}${tz === NY_TZ ? "" : ` = ${fmt(next, tz)} local`}${loaded ? "" : " (if the schedule were running)"}`
                : job === "weekly"
                  ? "manual here (GitHub: Saturday 10:00 New York)"
                  : job === "backup"
                    ? "manual here (GitHub: Saturday 12:00 New York)"
                    : "manual here (GitHub check: Sunday 10:00 New York)";
        const r = state[job];
        const last = r ? `last ${fmt(new Date(r.started), tz)}, ${r.seconds}s, ${r.result}: ${r.why}` : "last: never";
        console.log(`  ${job.padEnd(8)} ${when}`);
        console.log(`  ${"".padEnd(8)} ${last}`);
    });
    const commitDir = existsSync(p.runner) ? p.runner : p.checkout;
    const c = git(commitDir, ["log", "-1", "--format=%h %ci %s", "origin/main", "--", "api/history", "api/latest.json", "api/options", "api/charts"]);
    console.log(`last data  ${c.ok && c.out ? c.out : "unknown"} (origin/main as of the last fetch)`);
    const lock = lockDecision(readText(p.lock), pidAlive);
    console.log(
        `lock       ${lock.action === "take" ? "free" : lock.action === "held" ? `held by pid ${lock.info?.pid} (${lock.info?.job} since ${lock.info?.started})` : "stale (removed by the next run)"}`,
    );
    let size = "no log yet";
    try {
        size = `${(statSync(p.log).size / 1024).toFixed(0)} KB`;
    } catch {
        /* no log */
    }
    console.log(`log        ${p.log} (${size}; bun run data:logs)`);
}

export const HELP = `gex local data runner (scripts/data-local.ts)

  bun run data:setup              first time and repair: checks, runner worktree, schedule, dry check, status
  bun run data:status             schedule, next and last run per job, last data commit, lock, log size
  bun run data:logs [-n 200]      follow the log (-n N: the last N lines)
  bun run data:run <job>          run a job now with live output: partial | weekly | backup [tickers] | deps  (--dry-run: fetch nothing, commit nothing)
  bun run data:pause              stop the schedule, keep it installed (data:resume starts it again)
  bun run data:resume             load the schedule again
  bun run data:uninstall          remove the schedule
  bun run data:help               this list
  bun run status                  the whole local stack on one screen (app, proxy, TradingView, pm2, this runner)

  advanced: bun scripts/data-local.ts install [--no-load] | unlock | runner | migrate   (setup does all four)
`;

async function main(argv: string[]): Promise<void> {
    const [cmd = "help", ...rest] = argv;
    const flags = rest.filter((a) => a.startsWith("--"));
    const args = rest.filter((a) => !a.startsWith("--"));
    const has = (f: string) => flags.includes(f);
    const p = resolvePaths(process.env, mainCheckout());
    const fail = (msg: string) => {
        console.error(`error: ${msg}`);
        process.exitCode = 1;
    };
    if (cmd === "help" || cmd === "--help") {
        console.log(HELP);
    } else if (cmd === "status") {
        status(p);
    } else if (cmd === "logs") {
        if (!existsSync(p.log)) return fail(`no log yet at ${p.log}; it appears after the first run (bun run data:run partial --dry-run)`);
        const n = rest.indexOf("-n") >= 0 ? rest[rest.indexOf("-n") + 1] : null;
        spawnSync("tail", n ? ["-n", n, p.log] : ["-n", "50", "-f", p.log], { stdio: "inherit" });
    } else if (cmd === "run") {
        const job = args[0] as Job;
        if (!JOBS.includes(job)) return fail(`unknown job '${args[0] ?? ""}'; one of ${JOBS.join(", ")} (bun run data:help)`);
        const r = await runJob(p, job, { dryRun: has("--dry-run"), scheduled: has("--scheduled"), tickers: args.slice(1) });
        if (r === "failed") {
            console.error(`next: see the lines above or bun run data:logs -n 200; bun run data:status shows the reason`);
            process.exitCode = 1;
        }
    } else if (cmd === "install") {
        if (!install(p, has("--no-load"))) process.exitCode = 1;
    } else if (cmd === "pause" || cmd === "resume" || cmd === "uninstall") {
        const dry = has("--dry-run");
        if (!existsSync(p.plist)) return fail(`no schedule at ${p.plist}; install it with bun run data:setup`);
        if (cmd === "resume") {
            if (!dry && agentLoaded(p)) return console.log("already running");
            if (!launchctl(["bootstrap", domain(), p.plist], dry)) return fail(`launchctl bootstrap failed; run bun run data:setup to rewrite and load the plist`);
            console.log("schedule running again");
        } else {
            if (dry || agentLoaded(p)) launchctl(["bootout", `${domain()}/${p.label}`], dry);
            if (cmd === "uninstall" && !dry) unlinkSync(p.plist);
            console.log(cmd === "pause" ? "schedule paused (bun run data:resume to start it again)" : `schedule removed${dry ? " (dry run, plist kept)" : ""}`);
        }
    } else if (cmd === "migrate") {
        if (!migrateLegacy(p, legacyPaths(homedir()), (s) => console.log(s))) process.exitCode = 1;
        else console.log(`state dir  ${p.home}`);
    } else if (cmd === "unlock") {
        const r = unlockStale(p);
        console.log(r.removed ? "removed a stale lock" : r.held ? `the lock is held by a live process (pid ${r.held.pid}, ${r.held.job}); not removed` : "no lock");
    } else if (cmd === "runner") {
        try {
            ensureRunner(p, (s) => console.log(s));
            console.log(`runner ready: ${p.runner} at ${git(p.runner, ["log", "-1", "--format=%h %s"]).out}`);
        } catch (e) {
            fail(e instanceof Error ? e.message : String(e));
        }
    } else if (cmd === "setup") {
        console.log(`bun        ${process.versions.bun ?? "?"} (${process.execPath})`);
        const g = spawnSync("git", ["--version"], { encoding: "utf8" });
        if (g.status !== 0) return fail("git not found; install the Xcode command line tools (xcode-select --install)");
        console.log(`git        ${g.stdout.trim()}`);
        const gh = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
        console.log(`gh         ${gh.status === 0 ? "logged in" : "NOT logged in or missing: the Pages deploy after a run needs it (brew install gh && gh auth login)"}`);
        if (!(await online())) return fail("offline: github.com or Yahoo cannot be resolved; run setup again when online");
        console.log("network    ok");
        try {
            ensureRunner(p, (s) => console.log(s));
        } catch (e) {
            return fail(e instanceof Error ? e.message : String(e));
        }
        console.log(`runner     ${p.runner}`);
        if (!migrateLegacy(p, legacyPaths(homedir()), (s) => console.log(s))) return fail("the old files were not moved (see above)");
        console.log(`state dir  ${p.home}`);
        if (!install(p, has("--no-load"))) return fail("the schedule was not installed (see above)");
        console.log("dry check of the partial job:");
        const r = await runJob(p, "partial", { dryRun: true, scheduled: false, tickers: [] });
        if (r !== "ok") return fail("the dry check failed (see above); the schedule is installed, fix the cause and run setup again");
        console.log("");
        status(p);
    } else {
        fail(`unknown command '${cmd}'`);
        console.log(HELP);
    }
}

// `require.main === module` and `.catch` instead of `import.meta.main` and a top-level await (ts-ide-errors.md)
if (require.main === module) {
    main(process.argv.slice(2)).catch((err: unknown) => {
        console.error(err);
        process.exitCode = 1;
    });
}
