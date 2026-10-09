// Network layer for the parity harness, loaded with: bun --preload net-preload.ts scripts/options-data.ts
//   RECORD=1  call the real network and store every response in FIXTURES (session calls are not stored)
//   default   serve FIXTURES, a request without a fixture throws and is logged as MISSING
//   SYNTH     optional JSON of synthetic fixtures consulted before the network while recording
//   REQLOG    append every normalized request key, compared against net_harness.py (same keys)
/// <reference types="bun" />
/// <reference types="node" />
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

type Fixture = { status: number; b64: string; enc: string };
const FIX = process.env.FIXTURES!;
const REQLOG = process.env.REQLOG;
const RECORD = process.env.RECORD === "1";
const store: Record<string, Fixture> = existsSync(FIX) && !RECORD ? JSON.parse(readFileSync(FIX, "utf8")) : {};
const synth: Record<string, Fixture> =
    process.env.SYNTH && existsSync(process.env.SYNTH) ? JSON.parse(readFileSync(process.env.SYNTH, "utf8")) : {};
const realFetch = globalThis.fetch;

/** scheme://host/path?sorted query without crumb, includePrePost lowercased (Python prints False). */
export function keyOf(urlStr: string): string {
    const u = new URL(urlStr);
    const pairs = [...u.searchParams.entries()]
        .filter(([k]) => k !== "crumb")
        .map(([k, v]) => `${k}=${k === "includePrePost" ? v.toLowerCase() : v}`)
        .sort();
    return `${u.protocol}//${u.host}${decodeURIComponent(u.pathname)}${pairs.length ? "?" + pairs.join("&") : ""}`;
}

const log = (line: string) => REQLOG && appendFileSync(REQLOG, line + "\n");

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const isSession = url.startsWith("https://fc.yahoo.com") || url.includes("/v1/test/getcrumb") || url.startsWith("https://finance.yahoo.com/");
    const key = keyOf(url);
    if (RECORD && synth[key]) {
        store[key] = synth[key];
        writeFileSync(FIX, JSON.stringify(store));
        log(key);
        return new Response(Buffer.from(synth[key].b64, "base64"), { status: synth[key].status });
    }
    if (RECORD) {
        const res = await realFetch(input, init);
        if (isSession) return res;
        const buf = Buffer.from(await res.clone().arrayBuffer());
        const csv = (res.headers.get("content-type") || "").startsWith("text/csv");
        store[key] = { status: res.status, b64: buf.toString("base64"), enc: csv ? "latin1" : "utf8" };
        writeFileSync(FIX, JSON.stringify(store));
        log(key);
        return res;
    }
    if (isSession) {
        const h = new Headers();
        if (url.startsWith("https://fc.yahoo.com")) h.append("set-cookie", "A3=fake; Path=/");
        const crumb = url.includes("getcrumb");
        return new Response(crumb ? "FAKECRUMB" : "", { status: crumb ? 200 : 404, headers: h });
    }
    log(key);
    const hit = store[key];
    if (!hit) {
        log("MISSING " + key);
        throw new Error("no fixture for " + key);
    }
    return new Response(Buffer.from(hit.b64, "base64"), {
        status: hit.status,
        headers: { "content-type": hit.enc === "latin1" ? "text/csv" : "application/json" },
    });
}) as typeof fetch;
