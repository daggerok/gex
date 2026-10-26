#!/usr/bin/env bun
/**
 * `bun run status` (owner, 2026-10-26): one screen that says what of the local stack runs, in plain words.
 *
 *   App                  Parcel on APP_PORT or 1234: pid, command, URL
 *   Local proxy          PORT or 8787: pid, whether /health answers
 *   TradingView live     the proxy's GET /api/futures/status: live / starting (ES 3,200/5,560) / login needed /
 *                        rate limited / off, since when, roots, until when the auth token is valid
 *   CME OI check         the newest CME daily volume file next to the futures files (api/futures/cme/)
 *   tv:futures           a standalone watcher process (ps), and whether the TradingView session file exists (path only)
 *   pm2                  whether the pm2 process `app` (bun run start) exists and its status
 *   Data runner          launchd schedule, next run, last run, lock (scripts/data-local.ts, the same as data:status)
 *   Futures files        age of api/futures/*.json and whether they differ from git (a commit publishes them)
 *
 * Anything not running gets the exact command that starts it, and the last line sums up whether live data runs.
 * `--json` prints the same facts as JSON for scripts.
 *
 * READ ONLY: it starts and stops nothing (pm2 is asked only when its daemon already runs), writes nothing, and every probe
 * has a timeout, so the whole run stays under 2 s. It never prints a secret: the session file is reported by path and
 * presence only (never read), the proxy's status carries the token's expiry time, never the token.
 *
 * Colour only when stdout is a terminal (and NO_COLOR is unset); otherwise [ok] / [off] / [warn] / [--] markers.
 */

/// <reference types="bun" />
/// <reference types="node" />

import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { appPort, findHolders, type Holder, proxyPort } from "./check-ports";
import { agentLoaded, lockDecision, mainCheckout, nextRun, partialSlotsNy, pidAlive, readState, resolvePaths, type RunRecord } from "./data-local";
import { TV_ENV_PATH } from "./tv/env";

/** Every HTTP probe gives up after this long (the proxy answers in a few ms when it runs). */
export const HTTP_TIMEOUT_MS = 800;
/** Every external command (ps, lsof, git, pm2) gives up after this long. */
export const CMD_TIMEOUT_MS = 1500;

export type Level = "ok" | "off" | "warn" | "info";

/** One line of the screen: a marker, a name, a state, details below it, and the command that fixes it. */
export interface Row {
    level: Level;
    label: string;
    state: string;
    details: string[];
    fix?: string;
}

export interface ProcInfo {
    pid: number;
    command: string;
}

/** The fields of GET /api/futures/status (scripts/tv/live.ts statusJson); nothing else is kept. */
export interface EngineStatus {
    engine: boolean;
    state: string;
    message: string | null;
    until: number | null;
    since: number | null;
    progress: string | null;
    subscribed: Record<string, [number, number]> | null;
    roots: string[];
    tokenValidUntil: number | null;
}

export interface Pm2App {
    status: string;
    pid: number | null;
    restarts: number;
    since: number | null;
}

export interface FuturesFile {
    root: string;
    modified: number;
    updated: string | null;
    /** git status of the file: "modified", "untracked" or null (same as git) */
    git: "modified" | "untracked" | null;
}

/** Everything the probes found (also the --json output). */
export interface Probe {
    at: number;
    app: { port: number; url: string; holders: ProcInfo[]; answers: boolean };
    proxy: { port: number; url: string; holders: ProcInfo[]; health: boolean; checkout: string | null };
    engine: EngineStatus | null;
    cme: { file: string; day: string; modified: number } | null;
    watchers: ProcInfo[];
    session: { path: string; present: boolean };
    pm2: { daemon: boolean; app: Pm2App | null; error: string | null };
    runner: {
        installed: boolean;
        loaded: boolean;
        plist: string;
        next: number | null;
        last: Partial<Record<string, RunRecord>>;
        lock: { state: "free" | "held" | "stale"; pid: number | null; job: string | null; since: string | null };
    };
    futures: { dir: string; files: FuturesFile[]; gitKnown: boolean };
}

// ---- Parsing (pure) ---------------------------------------------------------------------------

/** `ps -ax -o pid=,command=` -> processes. */
export function parsePs(output: string): ProcInfo[] {
    const out: ProcInfo[] = [];
    for (const line of output.split("\n")) {
        const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
        if (m) out.push({ pid: Number(m[1]), command: m[2] });
    }
    return out;
}

/** Standalone TradingView watchers (`bun run tv:futures`, `bun scripts/tv/futures.ts ...`), not the shell that runs them. */
export function findWatchers(procs: ProcInfo[]): ProcInfo[] {
    return procs.filter((p) => /scripts\/tv\/futures\.ts/.test(p.command) && !/^(\/bin\/)?(ba|z)?sh\b/.test(p.command));
}

/** The pm2 daemon runs ("PM2 v7.0.1: God Daemon (...)"). */
export function pm2DaemonRuns(procs: ProcInfo[]): boolean {
    return procs.some((p) => /PM2 v\S+: God Daemon/.test(p.command));
}

/** `lsof -a -p PID -d cwd -Fn` -> the working directory, null when lsof printed none. */
export function parseLsofCwd(output: string): string | null {
    const line = output.split("\n").find((l) => l.startsWith("n"));
    return line ? line.slice(1) : null;
}

/**
 * `pm2 jlist` -> the process `name`. pm2 may print a version warning before the JSON; only the JSON array is read and only
 * name, pid, status, restarts and uptime are kept (pm2_env also holds the environment, which never leaves this function).
 */
export function parsePm2List(output: string, name: string): { app: Pm2App | null; error: string | null } {
    const start = output.search(/^\[/m);
    if (start < 0) return { app: null, error: "pm2 jlist printed no list" };
    let list: unknown;
    try {
        list = JSON.parse(output.slice(start));
    } catch {
        return { app: null, error: "pm2 jlist printed no valid JSON" };
    }
    if (!Array.isArray(list)) return { app: null, error: "pm2 jlist printed no list" };
    type Entry = { name?: unknown; pid?: unknown; pm2_env?: { status?: unknown; restart_time?: unknown; pm_uptime?: unknown } };
    const e = (list as Entry[]).find((x) => x && x.name === name);
    if (!e) return { app: null, error: null };
    const env = e.pm2_env ?? {};
    return {
        app: {
            status: typeof env.status === "string" ? env.status : "unknown",
            pid: typeof e.pid === "number" && e.pid > 0 ? e.pid : null,
            restarts: typeof env.restart_time === "number" ? env.restart_time : 0,
            since: typeof env.pm_uptime === "number" ? env.pm_uptime : null,
        },
        error: null,
    };
}

/** `git status --porcelain -- api/futures` -> file name -> modified / untracked. */
export function parsePorcelain(output: string): Map<string, "modified" | "untracked"> {
    const out = new Map<string, "modified" | "untracked">();
    for (const line of output.split("\n")) {
        if (line.length < 4) continue;
        const code = line.slice(0, 2);
        const path = line.slice(3).trim();
        const name = path.slice(path.lastIndexOf("/") + 1);
        out.set(name, code === "??" ? "untracked" : "modified");
    }
    return out;
}

/** The fields of /api/futures/status that the screen uses; null when the answer is not that object. */
export function parseEngineStatus(json: unknown): EngineStatus | null {
    if (!json || typeof json !== "object") return null;
    const o = json as Record<string, unknown>;
    if (typeof o.state !== "string") return null;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    let subscribed: Record<string, [number, number]> | null = null;
    if (o.subscribed && typeof o.subscribed === "object") {
        subscribed = {};
        for (const [root, v] of Object.entries(o.subscribed as Record<string, unknown>)) {
            if (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number") subscribed[root] = [v[0], v[1]];
        }
    }
    return {
        engine: o.engine === true,
        state: o.state,
        message: typeof o.message === "string" ? o.message : null,
        until: num(o.until),
        since: num(o.since),
        progress: typeof o.progress === "string" ? o.progress : null,
        subscribed,
        roots: Array.isArray(o.roots) ? o.roots.filter((r): r is string => typeof r === "string") : [],
        tokenValidUntil: num(o.tokenValidUntil),
    };
}

/** The newest `daily_volume_YYYYMMDD.xlsx` of a folder listing -> file and trading day. */
export function newestCmeFile(names: string[]): { file: string; day: string } | null {
    const files = names.filter((f) => /^daily_volume_\d{8}\.xlsx$/.test(f)).sort();
    const file = files[files.length - 1];
    if (!file) return null;
    const ymd = file.slice(13, 21);
    return { file, day: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` };
}

// ---- Words (pure) -----------------------------------------------------------------------------

const n = (x: number) => x.toLocaleString("en-US");

/** "<1 min", "12 min", "3 h 5 min", "2 d 4 h". */
export function age(ms: number): string {
    const min = Math.floor(Math.max(ms, 0) / 60_000);
    if (min < 1) return "<1 min";
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 48) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
    const d = Math.floor(h / 24);
    return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** "14:02" today, "Tue Oct 27 09:45" on another day (local time). */
export function clock(ms: number, now: number, timeZone?: string): string {
    const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
    const hm = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
    if (day(ms) === day(now)) return hm;
    const d = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(ms);
    return `${d.replace(",", "")} ${hm}`;
}

/** A long command line cut in the middle, so the program and its arguments both stay visible. */
export function shortCommand(cmd: string, max = 72): string {
    if (cmd.length <= max) return cmd;
    const head = Math.floor((max - 3) / 3);
    return `${cmd.slice(0, head)}...${cmd.slice(cmd.length - (max - 3 - head))}`;
}

/** "ES 3,200/5,560, NQ 1,000/4,000" (options on the websocket / in the window). */
export function subscribedText(sub: Record<string, [number, number]> | null): string {
    if (!sub) return "";
    return Object.entries(sub).map(([root, [on, all]]) => `${root} ${n(on)}/${n(all)}`).join(", ");
}

const LOGIN_FIX = "log in to tradingview.com in Chrome (the proxy picks it up within 3 min), or run bun run tv:session";

/** The TradingView live mode's state in words: level, state, and the fix. */
export function engineWords(e: EngineStatus, now: number, tz?: string): { level: Level; state: string; fix?: string } {
    if (!e.engine) return { level: "off", state: "off (the proxy runs with GEX_TV=0)", fix: "restart the proxy without GEX_TV=0: bun run proxy" };
    const subs = subscribedText(e.subscribed);
    switch (e.state) {
        case "live":
            return { level: "ok", state: "live" };
        case "starting":
        case "reconnecting": {
            const what = [e.progress ? `reading ${e.progress}` : "", subs].filter(Boolean).join(", ");
            return { level: "warn", state: `${e.state}${what ? ` (${what})` : ""}` };
        }
        case "no-session":
        case "expired":
            return { level: "off", state: e.state === "expired" ? "login needed (session expired)" : "login needed (no session)", fix: LOGIN_FIX };
        case "rate-limited":
            return { level: "warn", state: `rate limited by TradingView${e.until ? `, retries at ${clock(e.until, now, tz)}` : ""}` };
        case "off":
            return { level: "off", state: "off", fix: "bun run proxy" };
        default:
            return { level: "off", state: `error${e.message ? `: ${e.message}` : ""}`, fix: "see the proxy output (bun run logs under pm2); it retries every 3 min" };
    }
}

/** The screen's rows, from the probe. */
export function buildRows(p: Probe, tz?: string): Row[] {
    const now = p.at;
    const rows: Row[] = [];
    const procLines = (hs: ProcInfo[]) => hs.map((h) => `pid ${h.pid}  ${shortCommand(h.command)}`);

    // App
    const appUp = p.app.holders.length > 0 || p.app.answers;
    rows.push(
        appUp
            ? { level: p.app.answers ? "ok" : "warn", label: "App", state: p.app.answers ? "running" : `port ${p.app.port} taken, no HTTP answer yet`, details: [...procLines(p.app.holders), p.app.url] }
            : { level: "off", label: "App", state: "not running", details: [`port ${p.app.port} is free`], fix: p.proxy.health ? "bun run app" : "bun run all (app and proxy) or bun run app" },
    );

    // Local proxy
    const proxyUp = p.proxy.holders.length > 0 || p.proxy.health;
    rows.push(
        p.proxy.health
            ? { level: "ok", label: "Local proxy", state: "running, /health answers", details: [...procLines(p.proxy.holders), p.proxy.url] }
            : proxyUp
              ? { level: "warn", label: "Local proxy", state: `port ${p.proxy.port} taken, /health does not answer`, details: procLines(p.proxy.holders), fix: "stop that process, then bun run proxy" }
              : { level: "off", label: "Local proxy", state: "not running", details: [`port ${p.proxy.port} is free`], fix: "bun run proxy" },
    );

    // TradingView live mode (inside the proxy)
    if (!p.proxy.health) {
        rows.push({ level: "off", label: "TradingView live", state: "off (runs inside the proxy)", details: [], fix: "bun run proxy" });
    } else if (!p.engine) {
        rows.push({ level: "warn", label: "TradingView live", state: "no answer from /api/futures/status", details: ["an older proxy? restart it: bun run proxy"] });
    } else {
        const e = p.engine;
        const w = engineWords(e, now, tz);
        const details: string[] = [];
        if (e.engine && e.since) details.push(`since ${clock(e.since, now, tz)} (${age(now - e.since)})`);
        if (e.roots.length) details.push(`roots ${e.roots.join(" ")}`);
        if (e.state === "live" && e.subscribed) details.push(`websocket ${subscribedText(e.subscribed)} options`);
        if (e.tokenValidUntil) details.push(`token valid until ${clock(e.tokenValidUntil, now, tz)}${e.tokenValidUntil < now ? " (expired)" : ""}`);
        if (e.message && e.state !== "live" && !e.progress && !w.state.includes(e.message)) details.push(e.message);
        rows.push({ level: w.level, label: "TradingView live", state: w.state, details, fix: w.fix });
    }

    // CME OI cross-check file
    rows.push(
        p.cme
            ? { level: "ok", label: "CME OI check", state: `file of ${p.cme.day}`, details: [`${p.cme.file}, downloaded ${clock(p.cme.modified, now, tz)}`] }
            : { level: "info", label: "CME OI check", state: "no file yet", details: ["the proxy downloads it when it starts and when a futures ticker opens"], fix: p.proxy.health ? undefined : "bun run proxy" },
    );

    // Standalone tv:futures watcher and the session file
    if (p.watchers.length) {
        const both = p.proxy.health && p.engine?.engine;
        rows.push({
            level: both ? "warn" : "ok",
            label: "tv:futures",
            state: both ? "running next to the proxy's live mode (two websockets on one session)" : "running (standalone watcher)",
            details: procLines(p.watchers),
            fix: both ? "stop it (Ctrl+C in its terminal, or kill <pid>): the proxy writes the files itself" : undefined,
        });
    } else {
        rows.push({ level: "info", label: "tv:futures", state: "not running (the proxy's live mode does its work)", details: [], fix: p.proxy.health ? undefined : "bun run tv:futures (files only, without the proxy)" });
    }
    rows.push(
        p.session.present
            ? { level: "ok", label: "TradingView session", state: "file present", details: [p.session.path] }
            : { level: "warn", label: "TradingView session", state: "file missing", details: [p.session.path, "the proxy imports it from Chrome by itself"], fix: "bun run tv:session" },
    );

    // pm2
    if (!p.pm2.daemon) {
        rows.push({ level: "info", label: "pm2", state: "not running", details: [], fix: appUp || proxyUp ? undefined : "bun run start (app and proxy in the background)" });
    } else if (p.pm2.error) {
        rows.push({ level: "warn", label: "pm2", state: `daemon runs, ${p.pm2.error}`, details: [], fix: "bun run ps" });
    } else if (!p.pm2.app) {
        rows.push({ level: "info", label: "pm2", state: "daemon runs, no process 'app'", details: [], fix: appUp || proxyUp ? undefined : "bun run start" });
    } else {
        const a = p.pm2.app;
        const online = a.status === "online";
        const details = [`${a.pid ? `pid ${a.pid}, ` : ""}${a.restarts} restart(s)${online && a.since ? `, up since ${clock(a.since, now, tz)}` : ""}`];
        rows.push({ level: online ? "ok" : "warn", label: "pm2", state: `process 'app' ${a.status}`, details, fix: online ? undefined : "bun run restart (bun run logs shows why)" });
    }

    // Local data runner
    const r = p.runner;
    const runnerDetails: string[] = [];
    if (r.loaded && r.next) runnerDetails.push(`next partial run ${clock(r.next, now, tz)}`);
    for (const [job, rec] of Object.entries(r.last)) {
        if (rec) runnerDetails.push(`last ${job} ${clock(Date.parse(rec.started), now, tz)}, ${rec.result}${rec.why ? `: ${rec.why}` : ""}`);
    }
    if (r.lock.state === "held") runnerDetails.push(`running now: pid ${r.lock.pid} (${r.lock.job} since ${r.lock.since})`);
    if (r.lock.state === "stale") runnerDetails.push("stale lock (the next run removes it)");
    const lastFailed = Object.values(r.last).some((x) => x?.result === "failed");
    rows.push(
        !r.installed
            ? { level: "off", label: "Data runner", state: "schedule not installed", details: runnerDetails, fix: "bun run data:setup" }
            : !r.loaded
              ? { level: "warn", label: "Data runner", state: "schedule installed but paused", details: runnerDetails, fix: "bun run data:resume" }
              : { level: lastFailed ? "warn" : "ok", label: "Data runner", state: lastFailed ? "scheduled, a last run failed" : "scheduled", details: runnerDetails, fix: lastFailed ? "bun run data:logs -n 200" : undefined },
    );

    // Futures files
    const f = p.futures;
    if (!f.files.length) {
        rows.push({ level: "info", label: "Futures files", state: "none", details: [f.dir], fix: "bun run proxy (or bun run tv:futures --once)" });
    } else {
        const changed = f.files.filter((x) => x.git);
        // the data's own time ("updated" in the file) when it has one, else when the file was written
        const dataTime = (x: FuturesFile) => (x.updated && Number.isFinite(Date.parse(x.updated)) ? Date.parse(x.updated) : x.modified);
        const details = f.files.map((x) => `${x.root.padEnd(4)} data of ${clock(dataTime(x), now, tz)} (${age(now - dataTime(x))} old)${x.git ? `, ${x.git}: differs from git` : ""}`);
        details.push(
            !f.gitKnown ? "git status unknown" : changed.length ? `a commit would publish ${changed.map((x) => x.root).join(" ")}` : "same as git (nothing to publish)",
        );
        const newest = Math.max(...f.files.map(dataTime));
        rows.push({ level: "info", label: "Futures files", state: `newest data ${age(now - newest)} old`, details: [...details, f.dir] });
    }
    return rows;
}

/** The last line: whether live data runs, and the one command that fixes it when not. */
export function summary(p: Probe, tz?: string): { level: Level; text: string; live: boolean } {
    if (!p.proxy.health) {
        if (p.proxy.holders.length) return { level: "warn", text: `Live data is off: port ${p.proxy.port} is taken by another process (pid ${p.proxy.holders[0].pid})`, live: false };
        const appUp = p.app.holders.length > 0 || p.app.answers;
        return { level: "off", text: `Live data is off: run ${appUp ? "bun run proxy" : "bun run all"}`, live: false };
    }
    if (!p.engine) return { level: "warn", text: "Live data: the proxy runs, its TradingView status does not answer (restart it: bun run proxy)", live: false };
    const w = engineWords(p.engine, p.at, tz);
    if (w.level !== "ok") {
        if (p.engine.state === "starting" || p.engine.state === "reconnecting") return { level: "warn", text: `Live data is ${w.state}`, live: false };
        return { level: w.level, text: `Live data is not running: TradingView ${w.state}${w.fix ? ` -> ${w.fix}` : ""}`, live: false };
    }
    const appUp = p.app.holders.length > 0 || p.app.answers;
    if (!appUp) return { level: "ok", text: "Live data is running; the app is off: run bun run app (or use the published site with the local proxy)", live: true };
    return { level: "ok", text: "Everything for live data is running", live: true };
}

const COLORS: Record<Level, string> = { ok: "\x1b[32m", off: "\x1b[31m", warn: "\x1b[33m", info: "\x1b[90m" };
const MARK: Record<Level, string> = { ok: "[ok]", off: "[off]", warn: "[warn]", info: "[--]" };
const RESET = "\x1b[0m";
const LABEL_WIDTH = 20;

/** The screen. `color`: ANSI dots (a terminal), else [ok] / [off] / [warn] / [--] markers. */
export function formatReport(rows: Row[], sum: { level: Level; text: string }, opts: { color: boolean; title: string }): string {
    const markWidth = opts.color ? 1 : 6;
    const mark = (l: Level) => (opts.color ? `${COLORS[l]}●${RESET}` : MARK[l].padEnd(markWidth));
    const dim = (s: string) => (opts.color ? `\x1b[2m${s}${RESET}` : s);
    const bold = (s: string) => (opts.color ? `\x1b[1m${s}${RESET}` : s);
    const indent = " ".repeat(markWidth + 1 + LABEL_WIDTH + 1);
    const lines = [bold(opts.title), ""];
    for (const r of rows) {
        lines.push(`${mark(r.level)} ${r.label.padEnd(LABEL_WIDTH)} ${r.state}`);
        for (const d of r.details) lines.push(`${indent}${dim(d)}`);
        if (r.fix) lines.push(`${indent}-> ${opts.color ? `${COLORS.warn}${r.fix}${RESET}` : r.fix}`);
    }
    lines.push("", `${mark(sum.level)} ${bold(sum.text)}`);
    return lines.join("\n");
}

// ---- Probes (read only, with timeouts) ---------------------------------------------------------

/** Runs a command with a timeout; stdout (also of a non-zero exit, like lsof finding nothing), null when it could not run. */
function run(cmd: string, args: string[], cwd?: string): Promise<string | null> {
    return new Promise((resolve) => {
        execFile(cmd, args, { cwd, encoding: "utf8", timeout: CMD_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
            if (err && (err.killed || typeof err.code !== "number")) return resolve(null);
            resolve(stdout);
        });
    });
}

async function getJson(url: string): Promise<unknown> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

async function answers(url: string): Promise<boolean> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
        await res.arrayBuffer().catch(() => undefined);
        return res.status > 0;
    } catch {
        return false;
    }
}

/** The `"updated"` of a futures file from its first bytes (the files are MBs, only the head is read). */
function updatedOf(path: string): string | null {
    try {
        const fd = openSync(path, "r");
        const buf = Buffer.alloc(512);
        const len = readSync(fd, buf, 0, buf.length, 0);
        closeSync(fd);
        const m = /"updated"\s*:\s*"([^"]+)"/.exec(buf.subarray(0, len).toString("utf8"));
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

export async function probe(env: Record<string, string | undefined> = process.env): Promise<Probe> {
    const at = Date.now();
    const repo = join(__dirname, "..");
    const aPort = appPort(env);
    const pPort = proxyPort(env);
    // the async probes first, so they run while the quick synchronous ones below do
    const appAnswer = answers(`http://127.0.0.1:${aPort}/`);
    const health = getJson(`http://127.0.0.1:${pPort}/health`);
    const engineJson = getJson(`http://127.0.0.1:${pPort}/api/futures/status`);
    const psOut = run("ps", ["-ax", "-o", "pid=,command="]);

    const appHolders: Holder[] = findHolders(aPort);
    const proxyHolders: Holder[] = findHolders(pPort);
    const proxyCwd = proxyHolders.length ? run("lsof", ["-a", "-p", String(proxyHolders[0].pid), "-d", "cwd", "-Fn"]).then((o) => (o ? parseLsofCwd(o) : null)) : Promise.resolve(null);

    // the data runner (data:status without its dry run)
    const paths = resolvePaths(env, mainCheckout());
    const installed = existsSync(paths.plist);
    const loaded = installed && agentLoaded(paths);
    const next = nextRun(partialSlotsNy(), new Date(at));
    let lockText: string | null = null;
    try {
        lockText = existsSync(paths.lock) ? readFileSync(paths.lock, "utf8") : null;
    } catch {
        lockText = null;
    }
    const lock = lockDecision(lockText, pidAlive);

    const procs = parsePs((await psOut) ?? "");
    const daemon = pm2DaemonRuns(procs);
    const pm2Bin = join(repo, "node_modules", "pm2", "bin", "pm2");
    // pm2 is asked only when its daemon already runs: `pm2 jlist` would start one
    const pm2Out = daemon && existsSync(pm2Bin) ? run(process.execPath, [pm2Bin, "jlist"]) : Promise.resolve(null);

    // the futures files of the checkout the proxy runs in (else this one)
    const cwd = await proxyCwd;
    const dataRoot = cwd && existsSync(join(cwd, "api", "futures")) ? cwd : repo;
    const futuresDir = join(dataRoot, "api", "futures");
    const gitOut = run("git", ["status", "--porcelain", "--", "api/futures"], dataRoot);
    let names: string[] = [];
    try {
        names = readdirSync(futuresDir);
    } catch {
        names = [];
    }
    let cmeNames: string[] = [];
    try {
        cmeNames = readdirSync(join(futuresDir, "cme"));
    } catch {
        cmeNames = [];
    }
    const cmeFile = newestCmeFile(cmeNames);
    const gitText = await gitOut;
    const git = parsePorcelain(gitText ?? "");
    const files: FuturesFile[] = names
        .filter((f) => /^[A-Z0-9]+\.json$/.test(f))
        .sort()
        .map((f) => ({ root: f.slice(0, -5), modified: statSync(join(futuresDir, f)).mtimeMs, updated: updatedOf(join(futuresDir, f)), git: git.get(f) ?? null }));

    const pm2Text = await pm2Out;
    const pm2 = !daemon ? { app: null, error: null } : pm2Text === null ? { app: null, error: "pm2 jlist did not answer" } : parsePm2List(pm2Text, "app");
    const healthJson = await health;

    return {
        at,
        app: { port: aPort, url: `http://localhost:${aPort}`, holders: appHolders, answers: await appAnswer },
        proxy: { port: pPort, url: `http://localhost:${pPort}`, holders: proxyHolders, health: !!healthJson && (healthJson as { ok?: unknown }).ok === true, checkout: cwd },
        engine: parseEngineStatus(await engineJson),
        cme: cmeFile ? { ...cmeFile, modified: statSync(join(futuresDir, "cme", cmeFile.file)).mtimeMs } : null,
        watchers: findWatchers(procs),
        session: { path: TV_ENV_PATH, present: existsSync(TV_ENV_PATH) },
        pm2: { daemon, ...pm2 },
        runner: {
            installed,
            loaded,
            plist: paths.plist,
            next: next ? next.getTime() : null,
            last: readState(paths),
            lock: { state: lock.action === "take" ? "free" : lock.action, pid: lock.info?.pid ?? null, job: lock.info?.job ?? null, since: lock.info?.started ?? null },
        },
        futures: { dir: futuresDir, files, gitKnown: gitText !== null },
    };
}

async function main(argv: string[]): Promise<void> {
    if (argv.includes("--help") || argv.includes("-h")) {
        console.log("usage: bun run status [--json]   what of the local stack runs (app, proxy, TradingView, pm2, data runner); starts nothing");
        return;
    }
    const p = await probe();
    const sum = summary(p);
    if (argv.includes("--json")) {
        console.log(JSON.stringify({ ...p, summary: { level: sum.level, text: sum.text }, liveData: sum.live }, null, 2));
        return;
    }
    const color = !!process.stdout.isTTY && !process.env.NO_COLOR;
    const title = `gex status  ${new Date(p.at).toString().slice(0, 21)}`;
    console.log(formatReport(buildRows(p), sum, { color, title }));
}

// `require.main === module` and `.catch` instead of `import.meta.main` and a top-level await (ts-ide-errors.md)
if (require.main === module) {
    main(process.argv.slice(2)).catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
    });
}
