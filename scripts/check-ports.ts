#!/usr/bin/env bun
/**
 * Port pre-check for the run scripts (package.json `app`, `proxy`, `all`, `start`).
 *
 * WHY: Parcel quietly moves to another port when 1234 is taken and pm2 reports success even when the app dies at once,
 * so a second `bun run all` (or a proxy left running from another checkout) used to start half of the stack. This
 * check runs BEFORE anything starts: when any port of the target is taken it prints which port, the pid and the command
 * of the process holding it (lsof + ps) and exits with 1, so `all` never starts one part without the other.
 *
 * RUN:  bun scripts/check-ports.ts app      the app (Parcel), APP_PORT or 1234
 *       bun scripts/check-ports.ts proxy    the local proxy, PORT or 8787 (the same variable the proxy reads)
 *       bun scripts/check-ports.ts all      both, one check before either starts
 *
 * The app gets its port only from APP_PORT (package.json passes `--port ${APP_PORT:-1234}` to Parcel), so a PORT meant
 * for the proxy never moves the app as well (Parcel alone would also read PORT).
 */

/// <reference types="bun" />
/// <reference types="node" />

import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

export const DEFAULT_APP_PORT = 1234;
export const DEFAULT_PROXY_PORT = 8787;

export type Target = "app" | "proxy" | "all";
export type Env = Record<string, string | undefined>;

export interface PortSpec {
    /** what listens there: "app" (Parcel) or "proxy" (scripts/options-local-proxy.ts) */
    name: "app" | "proxy";
    port: number;
    /** env variable that overrides the port */
    envVar: "APP_PORT" | "PORT";
}

export interface Holder {
    pid: number;
    command: string;
}

function parsePort(raw: string | undefined, fallback: number, envVar: string): number {
    const text = (raw ?? "").trim();
    if (!text) return fallback;
    const port = Number(text);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${envVar}=${text} is not a port (1-65535)`);
    return port;
}

/** The proxy's port: PORT, else 8787 (scripts/options-local-proxy.ts reads it through this function). */
export function proxyPort(env: Env): number {
    return parsePort(env.PORT, DEFAULT_PROXY_PORT, "PORT");
}

/** The app's port: APP_PORT, else 1234 (package.json `serve` passes the same value to Parcel). */
export function appPort(env: Env): number {
    return parsePort(env.APP_PORT, DEFAULT_APP_PORT, "APP_PORT");
}

export function portsFor(target: Target, env: Env): PortSpec[] {
    const app: PortSpec = { name: "app", port: appPort(env), envVar: "APP_PORT" };
    const proxy: PortSpec = { name: "proxy", port: proxyPort(env), envVar: "PORT" };
    if (target === "app") return [app];
    if (target === "proxy") return [proxy];
    return [app, proxy];
}

/** True when a test server can listen on the port at that host (undefined = all interfaces). Only EADDRINUSE counts as taken. */
function canListen(port: number, host: string | undefined): Promise<boolean> {
    return new Promise((resolve) => {
        const server = createServer();
        server.once("error", (err: NodeJS.ErrnoException) => resolve(err.code !== "EADDRINUSE"));
        server.once("listening", () => server.close(() => resolve(true)));
        server.listen({ port, host, exclusive: true });
    });
}

/** Parses `lsof -Fp` output (one "p<pid>" line per process) into pids, without duplicates. */
export function parseLsofPids(output: string): number[] {
    const pids: number[] = [];
    output.split("\n").forEach((line) => {
        if (!line.startsWith("p")) return;
        const pid = Number(line.slice(1));
        if (Number.isInteger(pid) && pid > 0 && pids.indexOf(pid) < 0) pids.push(pid);
    });
    return pids;
}

/** Processes listening on the TCP port (lsof, then ps for the full command line). Empty when lsof is missing or finds none. */
export function findHolders(port: number): Holder[] {
    const lsof = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"], { encoding: "utf8" });
    if (lsof.error || typeof lsof.stdout !== "string") return [];
    return parseLsofPids(lsof.stdout).map((pid) => {
        const ps = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
        const command = typeof ps.stdout === "string" ? ps.stdout.trim() : "";
        return { pid, command: command || "(command unknown)" };
    });
}

/** Holders of the port, or null when it is free. A port is taken when lsof sees a listener or a test listen fails. */
export async function portStatus(port: number): Promise<Holder[] | null> {
    const holders = findHolders(port);
    if (holders.length > 0) return holders;
    const free = (await canListen(port, "127.0.0.1")) && (await canListen(port, undefined));
    return free ? null : [];
}

/** The error text for one taken port. */
export function formatTaken(spec: PortSpec, holders: Holder[]): string {
    const head = `Port ${spec.port} (${spec.name}) is already in use`;
    const by = holders.length === 0
        ? [`  held by a process lsof cannot show (another user, or lsof is missing)`]
        : holders.map((h) => `  pid ${h.pid}: ${h.command}`);
    const hint = `  stop that process, or start on another port: ${spec.envVar}=<port> bun run ${spec.name}`;
    return [head + ":", ...by, hint].join("\n");
}

/** Returns the error text (null when every port of the target is free). */
export async function checkPorts(target: Target, env: Env): Promise<string | null> {
    const specs = portsFor(target, env);
    if (specs.length === 2 && specs[0].port === specs[1].port) {
        return `The app and the proxy cannot share port ${specs[0].port}: set APP_PORT or PORT to different values`;
    }
    const errors: string[] = [];
    for (const spec of specs) {
        const holders = await portStatus(spec.port);
        if (holders) errors.push(formatTaken(spec, holders));
    }
    if (errors.length === 0) return null;
    return [...errors, `Nothing was started (bun run ${target}).`].join("\n");
}

function isTarget(x: string | undefined): x is Target {
    return x === "app" || x === "proxy" || x === "all";
}

async function main(): Promise<void> {
    const target = process.argv[2];
    if (!isTarget(target)) {
        console.error("usage: bun scripts/check-ports.ts app|proxy|all");
        process.exitCode = 2;
        return;
    }
    const error = await checkPorts(target, process.env);
    if (error) {
        console.error(error);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
    });
}
